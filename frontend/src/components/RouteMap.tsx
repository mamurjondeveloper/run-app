'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  lat: number;
  lng: number;
  ts?: number;
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
  /** Shown as a circular avatar at the latest point instead of a plain marker, when followLatest is true. */
  avatarUrl?: string | null;
}

// A gap this long between two consecutive GPS points means tracking was
// almost certainly paused (browser tab backgrounded/suspended) rather than
// the runner actually covering that ground — so it's rendered as a break in
// the line instead of a straight line cutting across whatever's in between.
const GAP_SECONDS = 30;

function FollowLatest({ point }: { point: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(point, map.getZoom(), { animate: true });
  }, [point, map]);
  return null;
}

function pinIcon(color: string, glyph: string) {
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.8 14 24 14 24s14-14.2 14-24C28 6.268 21.732 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="6.5" fill="#0b0b0f"/>
      <text x="14" y="18.5" font-size="9" text-anchor="middle" fill="#fff">${glyph}</text>
    </svg>`,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
  });
}

const startIcon = pinIcon('#22c55e', 'S');
const endIcon = pinIcon('#ef4444', 'F');

function avatarIcon(avatarUrl: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:3px solid #22c55e;box-shadow:0 0 0 3px rgba(34,197,94,0.25),0 2px 6px rgba(0,0,0,0.5);">
      <img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" />
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function splitOnGaps(positions: [number, number][], timestamps: (number | undefined)[]): [number, number][][] {
  const hasTimestamps = timestamps.every((t) => typeof t === 'number');
  if (!hasTimestamps) return [positions];

  const segments: [number, number][][] = [];
  let current: [number, number][] = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const gapSec = ((timestamps[i] as number) - (timestamps[i - 1] as number)) / 1000;
    if (gapSec > GAP_SECONDS) {
      segments.push(current);
      current = [positions[i]];
    } else {
      current.push(positions[i]);
    }
  }
  segments.push(current);
  return segments;
}

export default function RouteMap({
  path,
  color = '#22c55e',
  height = 300,
  showEndpoints = true,
  secondaryPath,
  followLatest = false,
  avatarUrl,
}: RouteMapProps) {
  if (path.length === 0) return null;

  const center: [number, number] = [path[0].lat, path[0].lng];
  const positions: [number, number][] = path.map((p) => [p.lat, p.lng]);
  const timestamps = path.map((p) => p.ts);
  const latest = positions[positions.length - 1];
  const segments = splitOnGaps(positions, timestamps);
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
      {segments
        .filter((seg) => seg.length > 1)
        .map((seg, i) => (
          <Polyline key={i} positions={seg} pathOptions={{ color, weight: 4 }} />
        ))}
      {showEndpoints && (
        positions.length > 1 ? (
          <>
            <Marker position={positions[0]} icon={startIcon} />
            {followLatest && avatarUrl ? (
              <Marker position={latest} icon={avatarIcon(avatarUrl)} />
            ) : (
              <Marker position={latest} icon={endIcon} />
            )}
          </>
        ) : followLatest && avatarUrl ? (
          <Marker position={latest} icon={avatarIcon(avatarUrl)} />
        ) : (
          <Marker position={latest} icon={startIcon} />
        )
      )}
    </MapContainer>
  );
}
