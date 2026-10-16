"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon path issues in Next.js
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface LeafletMapDisplayProps {
  latitude: number;
  longitude: number;
  shopName?: string;
  containerHeight?: string;
}

export default function LeafletMapDisplay({ latitude, longitude, shopName, containerHeight = '300px' }: LeafletMapDisplayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return <div className={`h-[250px] w-full bg-gray-50 flex items-center justify-center rounded-2xl text-gray-400 border border-gray-100`} style={{ height: containerHeight }}>กำลังโหลดแผนที่...</div>;
  }

  return (
    <div className={`w-full rounded-2xl overflow-hidden shadow-sm border border-gray-100 relative z-0`} style={{ height: containerHeight }}>
      <MapContainer 
        center={[latitude, longitude]} 
        zoom={15} 
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        dragging={false}
        zoomControl={false}
        doubleClickZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[latitude, longitude]}>
          {shopName && (
            <Popup>
              <span className="font-bold">{shopName}</span>
            </Popup>
          )}
        </Marker>
      </MapContainer>
    </div>
  );
}
