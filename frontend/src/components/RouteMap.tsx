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
}

export default function RouteMap({ path, color = '#22c55e', height = 300, showEndpoints = true }: RouteMapProps) {
  if (path.length === 0) return null;

  const center: [number, number] = [path[0].lat, path[0].lng];
  const positions: [number, number][] = path.map((p) => [p.lat, p.lng]);

  return (
    <MapContainer
      center={center}
      zoom={15}
      style={{ height, width: '100%', borderRadius: 24 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
