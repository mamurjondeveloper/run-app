'use client';

import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface RouteMapProps {
  path: MapPoint[];
  color?: string;
  height?: number;
  showEndpoints?: boolean;
  /** Optional second route (e.g. the originally planned route) drawn as a dashed grey line under the main path. */
  secondaryPath?: MapPoint[];
}

export default function RouteMap({ path, color = '#22c55e', height = 300, showEndpoints = true, secondaryPath }: RouteMapProps) {
  if (path.length === 0) return null;

  const center: [number, number] = [path[0].lat, path[0].lng];
  const positions: [number, number][] = path.map((p) => [p.lat, p.lng]);
  const secondaryPositions: [number, number][] | null =
    secondaryPath && secondaryPath.length > 0 ? secondaryPath.map((p) => [p.lat, p.lng]) : null;

  return (
    <MapContainer
      center={center}
      zoom={15}
      style={{ height, width: '100%', borderRadius: 24 }}
      scrollWheelZoom={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {secondaryPositions && (
        <Polyline positions={secondaryPositions} pathOptions={{ color: '#a1a1aa', weight: 3, dashArray: '6 8' }} />
      )}
      <Polyline positions={positions} pathOptions={{ color, weight: 4 }} />
      {showEndpoints && (
        <>
          <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
          <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
        </>
      )}
    </MapContainer>
  );
}
