"use client";

import dynamic from 'next/dynamic';

interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
}

// Dynamically import LeafletMapPicker with SSR disabled
const LeafletMapPicker = dynamic(
  () => import('./leaflet/LeafletMapPicker'),
  { 
    ssr: false,
    loading: () => <div className="h-[300px] w-full bg-gray-100 flex items-center justify-center rounded-xl text-gray-400">กำลังเตรียมระบบแผนที่...</div>
  }
);

export default function MapPicker(props: MapPickerProps) {
  return <LeafletMapPicker {...props} />;
}
