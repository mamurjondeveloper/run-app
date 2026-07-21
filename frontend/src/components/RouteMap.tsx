'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
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
  /** Keep the map panned to the latest point — for live tracking, not static route review. */
  followLatest?: boolean;
}

function FollowLatest({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(point, map.getZoom(), { animate: true });
  }, [point, map]);
  return null;
}

export default function RouteMap({
  path,
  color = '#22c55e',
  height = 300,
  showEndpoints = true,
  secondaryPath,
  followLatest = false,
}: RouteMapProps) {
  if (path.length === 0) return null;

  const center: [number, number] = [path[0].lat, path[0].lng];
  const positions: [number, number][] = path.map((p) => [p.lat, p.lng]);
  const latest = positions[positions.length - 1];
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
      {followLatest && <FollowLatest point={latest} />}
      {secondaryPositions && (
        <Polyline positions={secondaryPositions} pathOptions={{ color: '#a1a1aa', weight: 3, dashArray: '6 8' }} />
      )}
      {positions.length > 1 && <Polyline positions={positions} pathOptions={{ color, weight: 4 }} />}
      {showEndpoints && (
        positions.length > 1 ? (
          <>
            <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
            <CircleMarker center={latest} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
          </>
        ) : (
          <CircleMarker center={latest} radius={7} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }} />
        )
      )}
    </MapContainer>
  );
}
