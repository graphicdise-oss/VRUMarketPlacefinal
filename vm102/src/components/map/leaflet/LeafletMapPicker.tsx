"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
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

// Default center: VRU / Pathum Thani area (Central Thailand)
const defaultCenter = {
  lat: 14.1323,
  lng: 100.6172
};

interface LeafletMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
}

function LocationMarker({ position, setPosition, onChange }: { 
  position: L.LatLng | null, 
  setPosition: (p: L.LatLng) => void,
  onChange: (lat: number | null, lng: number | null) => void 
}) {
  useMapEvents({
    click(e) {
      setPosition(e.latlng);
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });

  return position === null ? null : (
    <Marker position={position} />
  );
}

function MapController({ position }: { position: L.LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    if (position) {
      map.flyTo(position, 15);
    }
  }, [position, map]);

  return null;
}

export default function LeafletMapPicker({ latitude, longitude, onChange }: LeafletMapPickerProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<L.LatLng | null>(
    latitude && longitude ? new L.LatLng(latitude, longitude) : null
  );
  const [isLocating, setIsLocating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude)) {
      setPosition(new L.LatLng(latitude, longitude));
    } else if (latitude === null || longitude === null) {
      setPosition(null);
    }
  }, [latitude, longitude]);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("เบราว์เซอร์ของคุณไม่รองรับการระบุตำแหน่ง GPS");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const newPos = new L.LatLng(lat, lng);
        setPosition(newPos);
        onChange(lat, lng);
      },
      (err) => {
        setIsLocating(false);
        console.warn("Geolocation error:", err);
        alert("ไม่สามารถดึงตำแหน่งปัจจุบันได้ กรุณากดคลิกปักหมุดบนแผนที่โดยตรง");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleClear = () => {
    setPosition(null);
    onChange(null, null);
  };

  if (!mounted) {
    return <div className="h-[280px] w-full bg-gray-100 flex items-center justify-center rounded-2xl text-gray-400">กำลังโหลดแผนที่...</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={handleGetCurrentLocation}
          disabled={isLocating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-bold transition border border-emerald-200"
        >
          {isLocating ? (
            <><i className="fa-solid fa-spinner fa-spin"></i> กำลังค้นหาตำแหน่ง...</>
          ) : (
            <><i className="fa-solid fa-location-crosshairs text-emerald-600"></i> ปักหมุดตำแหน่งปัจจุบันของฉัน (GPS)</>
          )}
        </button>

        {position && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono text-[11px] bg-gray-100 px-2 py-1 rounded">
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="text-red-500 hover:text-red-700 font-bold text-xs"
            >
              ล้างหมุด
            </button>
          </div>
        )}
      </div>

      <div className="h-[280px] w-full rounded-2xl overflow-hidden border border-gray-200 shadow-inner relative z-0">
        <MapContainer 
          center={position ? [position.lat, position.lng] : [defaultCenter.lat, defaultCenter.lng]} 
          zoom={position ? 15 : 12} 
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController position={position} />
          <LocationMarker position={position} setPosition={setPosition} onChange={onChange} />
        </MapContainer>
      </div>
    </div>
  );
}
