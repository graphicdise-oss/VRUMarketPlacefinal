"use client";

import dynamic from 'next/dynamic';

interface MapDisplayProps {
  latitude: number;
  longitude: number;
  shopName?: string;
  containerHeight?: string;
}

// Dynamically import LeafletMapDisplay with SSR disabled
const LeafletMapDisplay = dynamic(
  () => import('./leaflet/LeafletMapDisplay'),
  { 
    ssr: false,
    loading: () => <div className="h-[250px] w-full bg-gray-50 flex items-center justify-center rounded-2xl text-gray-400 border border-gray-100">กำลังเตรียมระบบแผนที่...</div>
  }
);

export default function MapDisplay(props: MapDisplayProps) {
  return <LeafletMapDisplay {...props} />;
}
