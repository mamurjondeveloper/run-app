import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { LEAFLET_JS, LEAFLET_CSS } from './leafletAssets';
import { OFFLINE_TILE_LAYER_JS } from './offlineTileLayer';
import { colors } from './theme';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LeafletMapProps {
  path: MapPoint[];
  height?: number;
  color?: string;
  /** Optional second route (e.g. the originally planned route) drawn as a dashed grey line under the main path. */
  secondaryPath?: MapPoint[];
  /** file:// directory of previously-downloaded tiles (see offlineMap.ts) - when set, the map prefers these over the network for any tile that was cached. */
  offlineTileDir?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A single bad GPS fix (confirmed on-device: the emulator's stale default
// location, recorded as one point before a real lock kicked in) sitting
// thousands of km from the rest of a run makes fitBounds() zoom out to fit
// BOTH, turning "a route through the park" into "a line across the globe."
// The median point is robust to exactly one outlier in a way an average
// isn't, so points far from it are dropped before the map ever sees them -
// visual-only, doesn't touch the stats already computed server-side.
const OUTLIER_RADIUS_KM = 20;
function dropGpsOutliers(points: MapPoint[]): MapPoint[] {
  if (points.length < 3) return points;
  const medLat = median(points.map((p) => p.lat));
  const medLng = median(points.map((p) => p.lng));
  const R = 6371;
  const filtered = points.filter((p) => {
    const dLat = ((p.lat - medLat) * Math.PI) / 180;
    const dLng = ((p.lng - medLng) * Math.PI) / 180;
    const lat1 = (medLat * Math.PI) / 180;
    const lat2 = (p.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
    return km <= OUTLIER_RADIUS_KM;
  });
  // If filtering would wipe out everything (e.g. a genuinely spread-out
  // route), trust the original data instead of showing a blank map.
  return filtered.length >= 2 ? filtered : points;
}

// Self-contained Leaflet map inside a WebView — avoids needing
// react-native-maps + a Google Maps API key just to draw a line on a map,
// and keeps the visual style consistent with the web app's map. Leaflet's
// own JS/CSS are inlined (see leafletAssets.ts) rather than loaded from
// unpkg.com at runtime: with a CDN <script src>, no internet reachability
// to that CDN meant `L` was never defined and the map area rendered
// completely blank with no error - confirmed on-device, not just
// theoretical. The OSM tile imagery itself normally still needs a network
// connection; if the area was downloaded ahead of time (see offlineMap.ts,
// wired in via `offlineTileDir`) it's served from disk instead, and for
// anywhere that wasn't downloaded, the polyline/markers/controls still
// render correctly over blank/grey tiles instead of the whole map
// disappearing.
export default function LeafletMap({ path, height = 260, color = colors.accent, secondaryPath, offlineTileDir }: LeafletMapProps) {
  const html = useMemo(() => {
    if (path.length === 0) return '';
    const cleanPath = dropGpsOutliers(path);
    const coords = cleanPath.map((p) => [p.lat, p.lng]);
    const center = coords[0];
    const secondaryCoords = secondaryPath && secondaryPath.length > 0 ? secondaryPath.map((p) => [p.lat, p.lng]) : null;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}</style>
  <style>html,body,#map{height:100%;margin:0;padding:0;background:${colors.bg1};}</style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>${OFFLINE_TILE_LAYER_JS}</script>
  <script>
    const coords = ${JSON.stringify(coords)};
    const secondaryCoords = ${JSON.stringify(secondaryCoords)};
    const map = L.map('map', { zoomControl: false, attributionControl: false }).setView(${JSON.stringify(center)}, 15);
    makeTileLayer(${JSON.stringify(offlineTileDir || null)}).addTo(map);
    if (secondaryCoords) {
      L.polyline(secondaryCoords, { color: '${colors.textDim}', weight: 3, dashArray: '6 8' }).addTo(map);
    }
    const line = L.polyline(coords, { color: '${color}', weight: 4 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    L.circleMarker(coords[0], { radius: 6, color: '${colors.accent}', fillColor: '${colors.accent}', fillOpacity: 1 }).addTo(map);
    L.circleMarker(coords[coords.length - 1], { radius: 6, color: '${colors.danger}', fillColor: '${colors.danger}', fillOpacity: 1 }).addTo(map);
  </script>
</body>
</html>`;
  }, [path, color, secondaryPath, offlineTileDir]);

  if (path.length === 0) return null;

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.bg1,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
