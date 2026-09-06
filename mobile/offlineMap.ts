// SDK 57's expo-file-system ships a new object-oriented File/Directory API
// by default; the `/legacy` subpath keeps the simpler documentDirectory +
// *Async function API this file is written against.
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Leaflet's map tiles (LeafletMap.tsx / LiveLeafletMap.tsx) come from
// tile.openstreetmap.org over the network - the map itself (Leaflet's own
// JS/CSS) is bundled locally, but with no signal the imagery is just blank
// grey squares. This downloads a set of PNG tiles for an area around a
// point into app storage once, while online, so the same tile URLs can be
// served from disk afterward with no connectivity at all.
//
// IMPORTANT - OpenStreetMap's tile usage policy: tile.openstreetmap.org is
// a free, donation-funded server for everyone, and its usage policy asks
// apps not to bulk-download tiles for offline caching at any real scale
// (https://operations.osmfoundation.org/policies/tiles/) - heavy automated
// traffic risks the app's requests (and everyone else's, since it's a
// shared hostname) getting rate-limited or blocked outright. What's here
// is deliberately modest (a several-km radius, four zoom levels, low
// concurrency, a real User-Agent) to stay a reasonable personal
// convenience rather than a bulk scraper. If this app ever has many active
// users doing this regularly, that adds up on a shared free resource - the
// honest long-term fix is a paid/API-keyed tile provider (MapTiler, Stadia
// Maps, Mapbox all explicitly support offline caching), not raw OSM tiles
// at scale.
// documentDirectory is only null on web (unsupported there anyway) - on
// iOS/Android it's always a real file:// path.
const TILE_DIR = `${FileSystem.documentDirectory ?? ''}map-tiles/`;
const META_KEY = 'runapp_offline_map_meta';
const MIN_ZOOM = 13;
const MAX_ZOOM = 16;
export const DEFAULT_RADIUS_KM = 5;
// Identifies real traffic per OSM's tile usage policy, and low enough
// concurrency that this reads as one considerate app, not a scraper.
const USER_AGENT = 'RunApp/1.0 (offline map cache; contact via app store listing)';
const CONCURRENCY = 2;

export interface OfflineMapMeta {
  lat: number;
  lng: number;
  radiusKm: number;
  tileCount: number;
  savedAt: number;
}

function lon2x(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tileList(lat: number, lng: number, radiusKm: number): { z: number; x: number; y: number }[] {
  const tiles: { z: number; x: number; y: number }[] = [];
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    const xMin = lon2x(lng - dLng, z);
    const xMax = lon2x(lng + dLng, z);
    // Latitude and slippy-map tile Y run opposite directions (Y grows
    // southward), so the north edge (greater lat) gives the smaller Y.
    const yMin = lat2y(lat + dLat, z);
    const yMax = lat2y(lat - dLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** Roughly how many tiles (and therefore how long/how much data) a given radius costs - shown to the user before they commit to a download. */
export function estimateTileCount(lat: number, radiusKm: number = DEFAULT_RADIUS_KM): number {
  return tileList(lat, 0, radiusKm).length;
}

export async function getOfflineMapMeta(): Promise<OfflineMapMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function deleteOfflineMap(): Promise<void> {
  await FileSystem.deleteAsync(TILE_DIR, { idempotent: true }).catch(() => {});
  await AsyncStorage.removeItem(META_KEY);
}

/** file:// directory the injected Leaflet HTML reads tiles from - see LeafletMap.tsx/LiveLeafletMap.tsx. */
export function getLocalTileBaseDir(): string {
  return TILE_DIR;
}

export async function downloadAreaTiles(
  lat: number,
  lng: number,
  onProgress?: (done: number, total: number) => void,
  radiusKm: number = DEFAULT_RADIUS_KM,
): Promise<OfflineMapMeta> {
  const tiles = tileList(lat, lng, radiusKm);
  await FileSystem.makeDirectoryAsync(TILE_DIR, { intermediates: true }).catch(() => {});

  let done = 0;
  let index = 0;
  const madeDirs = new Set<string>();

  async function worker() {
    while (index < tiles.length) {
      const i = index++;
      const { z, x, y } = tiles[i];
      const dir = `${TILE_DIR}${z}/${x}/`;
      const dest = `${dir}${y}.png`;
      const info = await FileSystem.getInfoAsync(dest);
      if (!info.exists) {
        if (!madeDirs.has(dir)) {
          madeDirs.add(dir);
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        }
        const subdomain = 'abc'[(x + y) % 3];
        const url = `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
        try {
          await FileSystem.downloadAsync(url, dest, { headers: { 'User-Agent': USER_AGENT } });
        } catch {
          // Skip a failed tile (a transient network hiccup, a rate-limit
          // reply, ...) rather than aborting the whole download - it just
          // stays blank offline like any tile that was never cached.
        }
      }
      done += 1;
      onProgress?.(done, tiles.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const meta: OfflineMapMeta = { lat, lng, radiusKm, tileCount: tiles.length, savedAt: Date.now() };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  return meta;
}
