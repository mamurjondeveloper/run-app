import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LeafletMapProps {
  path: MapPoint[];
  height?: number;
  color?: string;
}

// Self-contained Leaflet map loaded from CDN inside a WebView — avoids
// needing react-native-maps + a Google Maps API key just to draw a line on
// a map, and keeps the visual style consistent with the web app's map.
export default function LeafletMap({ path, height = 260, color = '#22c55e' }: LeafletMapProps) {
  const html = useMemo(() => {
    if (path.length === 0) return '';
    const coords = path.map((p) => [p.lat, p.lng]);
    const center = coords[0];

    return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>html,body,#map{height:100%;margin:0;padding:0;background:#18181b;}</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const coords = ${JSON.stringify(coords)};
    const map = L.map('map', { zoomControl: false, attributionControl: false }).setView(${JSON.stringify(center)}, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    const line = L.polyline(coords, { color: '${color}', weight: 4 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    L.circleMarker(coords[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).addTo(map);
    L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map);
  </script>
</body>
</html>`;
  }, [path, color]);

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
    backgroundColor: '#18181b',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
