"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import HeatmapLayer from "./HeatmapLayer";
import { HeatMapPoint } from "../HeatMapDisplay";

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

interface LeafletMapProps {
  points: HeatMapPoint[];
  centerLat: number;
  centerLng: number;
  zoom?: number;
}

export default function LeafletMap({ points, centerLat, centerLng, zoom = 12 }: LeafletMapProps) {
  // To avoid hydration mismatch, we only render the map on the client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
     
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-[400px] w-full bg-gray-50 flex items-center justify-center rounded-2xl text-gray-400 font-bold">กำลังโหลดแผนที่ Leaflet...</div>;
  }

  return (
    <div className="h-[400px] w-full rounded-2xl overflow-hidden shadow-sm border border-gray-100 relative z-0">
      <MapContainer 
        center={[centerLat, centerLng]} 
        zoom={zoom} 
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          className="grayscale opacity-75 contrast-125"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Heat Map Layer */}
        <HeatmapLayer points={points} />
        
        {/* Markers */}
        {points.map((point) => (
          <Marker key={point.id} position={[point.lat, point.lng]}>
            <Popup>
              <div className="text-center min-w-[120px]">
                <h4 className="font-bold text-gray-800 m-0 leading-tight pb-1">{point.shopName}</h4>
                <p className="text-sm text-gray-500 m-0">ยอดขาย: ฿{point.weight.toLocaleString()}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
