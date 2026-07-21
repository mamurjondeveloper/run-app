import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LiveLeafletMapProps {
  initialCenter: MapPoint;
  secondaryPath?: MapPoint[];
  color?: string;
  avatarUrl?: string | null;
}

export interface LiveLeafletMapHandle {
  addPoint: (p: MapPoint) => void;
}

// A live-tracking variant of LeafletMap.tsx: that component rebuilds its
// entire HTML string (and therefore reloads the WebView) whenever `path`
// changes, which is fine for a static route review but would reload/flicker
// several times a second during live tracking. This loads the map ONCE and
// pushes new points into the already-running Leaflet instance via
// injectJavaScript, matching the incremental-update + line-break-on-gap +
// follow-the-runner behavior built for the web app's live map.
const LiveLeafletMap = forwardRef<LiveLeafletMapHandle, LiveLeafletMapProps>(
  ({ initialCenter, secondaryPath, color = '#22c55e', avatarUrl }, ref) => {
    const webViewRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      addPoint: (p: MapPoint) => {
        webViewRef.current?.injectJavaScript(`window.addPoint && window.addPoint(${p.lat}, ${p.lng}); true;`);
      },
    }));

    const html = useMemo(() => {
      const secondaryCoords = secondaryPath && secondaryPath.length > 0 ? secondaryPath.map((p) => [p.lat, p.lng]) : null;
      const avatarHtml = avatarUrl
        ? `<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:3px solid #22c55e;box-shadow:0 0 0 3px rgba(34,197,94,0.25);"><img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`
        : null;

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
    const secondaryCoords = ${JSON.stringify(secondaryCoords)};
    const map = L.map('map', { zoomControl: false, attributionControl: false })
      .setView(${JSON.stringify([initialCenter.lat, initialCenter.lng])}, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    if (secondaryCoords) {
      L.polyline(secondaryCoords, { color: '#a1a1aa', weight: 3, dashArray: '6 8' }).addTo(map);
    }

    const pinIcon = (colorHex, glyph) => L.divIcon({
      className: '',
      html: '<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">'
        + '<path d="M14 0C6.268 0 0 6.268 0 14c0 9.8 14 24 14 24s14-14.2 14-24C28 6.268 21.732 0 14 0z" fill="' + colorHex + '"/>'
        + '<circle cx="14" cy="14" r="6.5" fill="#0b0b0f"/>'
        + '<text x="14" y="18.5" font-size="9" text-anchor="middle" fill="#fff">' + glyph + '</text></svg>',
      iconSize: [28, 38],
      iconAnchor: [14, 38],
    });
    const avatarIcon = ${avatarHtml ? `L.divIcon({ className: '', html: ${JSON.stringify(avatarHtml)}, iconSize: [36, 36], iconAnchor: [18, 18] })` : 'null'};

    let coords = [];
    let line = null;
    let startMarker = null;
    let currentMarker = null;
    let lastTs = null;
    const GAP_SECONDS = 30;

    window.addPoint = function (lat, lng) {
      const now = Date.now();
      if (lastTs !== null && (now - lastTs) / 1000 > GAP_SECONDS) {
        // Tracking was likely paused (app backgrounded/killed) - start a
        // fresh line segment instead of connecting straight across the gap.
        line = null;
      }
      lastTs = now;
      coords.push([lat, lng]);

      if (!startMarker) {
        startMarker = L.marker(coords[0], { icon: pinIcon('#22c55e', 'S') }).addTo(map);
      }
      if (!line) {
        line = L.polyline([[lat, lng]], { color: '${color}', weight: 4 }).addTo(map);
      } else {
        line.addLatLng([lat, lng]);
      }

      if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
      } else {
        currentMarker = L.marker([lat, lng], { icon: avatarIcon || pinIcon('#ef4444', 'F') }).addTo(map);
      }
      map.setView([lat, lng], map.getZoom(), { animate: true });
    };
  </script>
</body>
</html>`;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [secondaryPath, color, avatarUrl, initialCenter.lat, initialCenter.lng]);

    return (
      <View style={StyleSheet.absoluteFill}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html }}
          style={styles.webview}
          scrollEnabled={false}
        />
      </View>
    );
  },
);

LiveLeafletMap.displayName = 'LiveLeafletMap';
export default LiveLeafletMap;

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#18181b',
  },
});
