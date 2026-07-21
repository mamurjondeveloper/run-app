'use client';

import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  value: MapPoint;
  onChange: (point: MapPoint) => void;
  height?: number;
}

function ClickHandler({ onChange }: { onChange: (point: MapPoint) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationPicker({ value, onChange, height = 260 }: LocationPickerProps) {
  return (
    <MapContainer
      center={[value.lat, value.lng]}
      zoom={13}
      style={{ height, width: '100%', borderRadius: 24 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onChange={onChange} />
      <CircleMarker
        center={[value.lat, value.lng]}
        radius={9}
        pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
      />
    </MapContainer>
  );
}
