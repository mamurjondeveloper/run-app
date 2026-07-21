import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';

export const LOCATION_TASK_NAME = 'runapp-background-location';
export const ACTIVE_RUN_POINTS_KEY = 'runapp_active_run_points';
export const ACTIVE_RUN_ID_KEY = 'runapp_active_run_id';
export const ACTIVE_RUN_STARTED_AT_KEY = 'runapp_active_run_started_at';

export interface RunPoint {
  lat: number;
  lng: number;
  ts: number;
  speedKmh?: number;
}

export async function readRunPoints(): Promise<RunPoint[]> {
  const raw = await AsyncStorage.getItem(ACTIVE_RUN_POINTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function clearRunBuffer(): Promise<void> {
  await AsyncStorage.multiRemove([
    ACTIVE_RUN_POINTS_KEY,
    ACTIVE_RUN_ID_KEY,
    ACTIVE_RUN_STARTED_AT_KEY,
  ]);
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
    const existing = await readRunPoints();
    const newPoints: RunPoint[] = locations.map((loc) => ({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      ts: loc.timestamp,
      speedKmh:
        loc.coords.speed != null && loc.coords.speed >= 0
          ? Math.round(loc.coords.speed * 3.6 * 10) / 10
          : undefined,
    }));
    await AsyncStorage.setItem(
      ACTIVE_RUN_POINTS_KEY,
      JSON.stringify([...existing, ...newPoints]),
    );
  } catch (e) {
    console.error('Failed to persist location points:', e);
  }
});

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

export interface RunStats {
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

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
