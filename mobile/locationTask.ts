import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';

export const LOCATION_TASK_NAME = 'runapp-background-location';
export const ACTIVE_RUN_ID_KEY = 'runapp_active_run_id';
export const ACTIVE_RUN_STARTED_AT_KEY = 'runapp_active_run_started_at';

// A run in progress used to be stored as a single ever-growing AsyncStorage
// value: every background location update (roughly every 4s) read the
// WHOLE existing point history, JSON.parsed it, appended the new point(s),
// then JSON.stringified and wrote back the WHOLE array. Total work across a
// run therefore grew quadratically with run length (O(n^2)) - for a long
// run this became the single biggest CPU/battery cost in the app.
//
// Points are now stored in fixed-size chunks instead: each write only
// touches the current (mostly-empty) chunk, so a single update's cost is
// bounded by CHUNK_SIZE regardless of how long the run has been going.
// A small in-memory cache (below) additionally means repeated calls within
// the same run - the background task every ~4s, the foreground live-stats
// poll every 2s - don't even need to touch AsyncStorage to read the current
// state; only writes hit it.
const CHUNK_SIZE = 50;
const CHUNK_META_KEY = 'runapp_active_run_chunk_meta';
const chunkKey = (index: number) => `runapp_active_run_points_chunk_${index}`;

// A run started on a previous build of the app may still have its points
// under this single flat key - read once as a fallback so an in-progress
// run isn't silently lost across an app update.
const LEGACY_POINTS_KEY = 'runapp_active_run_points';

export interface RunPoint {
  lat: number;
  lng: number;
  ts: number;
  speedKmh?: number;
}

export interface RunStats {
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

function haversineMeters(a: RunPoint, b: RunPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Full recompute from a raw point list - still needed for a one-time pass
// (hydrating from disk, or reviewing a finished run's whole path) but no
// longer called on every live-stats tick (see getLiveRunStats below).
export function computeRunStats(points: RunPoint[]): RunStats {
  let distanceMeters = 0;
  let maxSpeedKmh = 0;

  for (let i = 1; i < points.length; i++) {
    const segment = haversineMeters(points[i - 1], points[i]);
    // Ignore GPS noise jumps that would be physically impossible for a runner
    if (segment < 200) {
      distanceMeters += segment;
    }
  }
  for (const p of points) {
    if (p.speedKmh && p.speedKmh > maxSpeedKmh) maxSpeedKmh = p.speedKmh;
  }

  const durationSec =
    points.length >= 2 ? Math.max(0, Math.round((points[points.length - 1].ts - points[0].ts) / 1000)) : 0;
  const avgSpeedKmh = durationSec > 0 ? distanceMeters / 1000 / (durationSec / 3600) : 0;

  return {
    distanceMeters: Math.round(distanceMeters),
    durationSec,
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh: Math.round(maxSpeedKmh * 10) / 10,
  };
}

interface RunCache {
  allPoints: RunPoint[];
  // Running totals, updated incrementally as points are appended instead of
  // being recomputed from scratch over the whole run every time a caller
  // wants current stats.
  distanceMeters: number;
  maxSpeedKmh: number;
  // Chunk bookkeeping: `closedChunks` chunks (0..closedChunks-1) are full
  // and never touched again; `openChunk` holds the points already written
  // under chunkKey(closedChunks), the one chunk still being appended to.
  closedChunks: number;
  openChunk: RunPoint[];
}

let cache: RunCache | null = null;
let hydrating: Promise<RunCache> | null = null;

async function hydrateFromStorage(): Promise<RunCache> {
  const metaRaw = await AsyncStorage.getItem(CHUNK_META_KEY);
  if (metaRaw) {
    const meta: { totalChunks: number } = JSON.parse(metaRaw);
    const raws = await Promise.all(
      Array.from({ length: meta.totalChunks }, (_, i) => AsyncStorage.getItem(chunkKey(i))),
    );
    const allPoints: RunPoint[] = [];
    for (const raw of raws) {
      if (raw) allPoints.push(...(JSON.parse(raw) as RunPoint[]));
    }
    const closedChunks = Math.max(0, meta.totalChunks - 1);
    const stats = computeRunStats(allPoints);
    return {
      allPoints,
      distanceMeters: stats.distanceMeters,
      maxSpeedKmh: stats.maxSpeedKmh,
      closedChunks,
      openChunk: allPoints.slice(closedChunks * CHUNK_SIZE),
    };
  }

  // No chunked data yet - check the legacy single-key format from a run
  // that was already in progress when the app updated to this version.
  const legacyRaw = await AsyncStorage.getItem(LEGACY_POINTS_KEY);
  const legacyPoints: RunPoint[] = legacyRaw ? JSON.parse(legacyRaw) : [];
  const stats = computeRunStats(legacyPoints);
  const migrated: RunCache = {
    allPoints: legacyPoints,
    distanceMeters: stats.distanceMeters,
    maxSpeedKmh: stats.maxSpeedKmh,
    closedChunks: 0,
    // Must be a separate array, not the same reference as allPoints above -
    // appendPoints() pushes each new point onto both allPoints AND
    // openChunk, so sharing one array here would push every point twice.
    openChunk: [...legacyPoints],
  };
  if (legacyPoints.length > 0) {
    await AsyncStorage.removeItem(LEGACY_POINTS_KEY);
    await persist(migrated);
  }
  return migrated;
}

async function hydrate(): Promise<RunCache> {
  if (cache) return cache;
  if (!hydrating) hydrating = hydrateFromStorage();
  cache = await hydrating;
  hydrating = null;
  return cache;
}

// Writes only the chunk(s) touched since the last persist - at most one
// full chunk plus the (partial) open chunk - instead of the run's whole
// history.
async function persist(c: RunCache): Promise<void> {
  const writes: Promise<void>[] = [];
  while (c.openChunk.length >= CHUNK_SIZE) {
    const full = c.openChunk.slice(0, CHUNK_SIZE);
    c.openChunk = c.openChunk.slice(CHUNK_SIZE);
    writes.push(AsyncStorage.setItem(chunkKey(c.closedChunks), JSON.stringify(full)));
    c.closedChunks += 1;
  }
  writes.push(AsyncStorage.setItem(chunkKey(c.closedChunks), JSON.stringify(c.openChunk)));
  writes.push(AsyncStorage.setItem(CHUNK_META_KEY, JSON.stringify({ totalChunks: c.closedChunks + 1 })));
  await Promise.all(writes);
}

async function appendPoints(newPoints: RunPoint[]): Promise<void> {
  if (newPoints.length === 0) return;
  const c = await hydrate();
  for (const p of newPoints) {
    if (c.allPoints.length > 0) {
      const segment = haversineMeters(c.allPoints[c.allPoints.length - 1], p);
      if (segment < 200) c.distanceMeters += segment;
    }
    if (p.speedKmh && p.speedKmh > c.maxSpeedKmh) c.maxSpeedKmh = p.speedKmh;
    c.allPoints.push(p);
    c.openChunk.push(p);
  }
  await persist(c);
}

// Returns every point recorded so far for the run in progress. A fresh copy
// is returned each call (not the live cached array) so React state updates
// that pass this straight to setState are correctly seen as new values.
export async function readRunPoints(): Promise<RunPoint[]> {
  const c = await hydrate();
  return [...c.allPoints];
}

// Cheap (O(1)) current stats for the run in progress, built from the
// running totals kept in-memory rather than re-walking every point. Only
// meaningful after readRunPoints()/hydrate() has run at least once in this
// JS session, which the live-stats poll always does first.
export function getLiveRunStats(): RunStats {
  if (!cache || cache.allPoints.length < 2) {
    return { distanceMeters: 0, durationSec: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 };
  }
  const pts = cache.allPoints;
  const durationSec = Math.max(0, Math.round((pts[pts.length - 1].ts - pts[0].ts) / 1000));
  const avgSpeedKmh = durationSec > 0 ? cache.distanceMeters / 1000 / (durationSec / 3600) : 0;
  return {
    distanceMeters: Math.round(cache.distanceMeters),
    durationSec,
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    maxSpeedKmh: Math.round(cache.maxSpeedKmh * 10) / 10,
  };
}

export async function clearRunBuffer(): Promise<void> {
  let totalChunks = cache ? cache.closedChunks + 1 : 0;
  if (!cache) {
    const metaRaw = await AsyncStorage.getItem(CHUNK_META_KEY);
    if (metaRaw) totalChunks = (JSON.parse(metaRaw) as { totalChunks: number }).totalChunks;
  }
  const keys = [ACTIVE_RUN_ID_KEY, ACTIVE_RUN_STARTED_AT_KEY, CHUNK_META_KEY, LEGACY_POINTS_KEY];
  for (let i = 0; i < totalChunks; i++) keys.push(chunkKey(i));
  await AsyncStorage.multiRemove(keys);
  cache = null;
}

// Must be defined at module scope (not inside a component) so the OS can
// launch this task and run the JS engine even if no screen is mounted.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error.message);
    return;
  }
  const { locations } = (data as { locations: LocationObject[] }) || { locations: [] };
  if (!locations || locations.length === 0) return;

  try {
    const newPoints: RunPoint[] = locations.map((loc) => ({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      ts: loc.timestamp,
      speedKmh:
        loc.coords.speed != null && loc.coords.speed >= 0
          ? Math.round(loc.coords.speed * 3.6 * 10) / 10
          : undefined,
    }));
    await appendPoints(newPoints);
  } catch (e) {
    console.error('Failed to persist location points:', e);
  }
});
