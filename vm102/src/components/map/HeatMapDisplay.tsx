"use client";

import dynamic from 'next/dynamic';

export interface HeatMapPoint {
  id: string;
  lat: number;
  lng: number;
  weight: number;
  shopName: string;
}

interface HeatMapDisplayProps {
  points: HeatMapPoint[];
  centerLat: number;
  centerLng: number;
  zoom?: number;
}

// Dynamically import LeafletMap with SSR disabled to prevent 'window is not defined' errors
const LeafletMap = dynamic(
  () => import('./leaflet/LeafletMap'),
  { 
    ssr: false,
    loading: () => <div className="h-[400px] w-full bg-gray-50 flex items-center justify-center rounded-2xl text-gray-400 font-bold border border-gray-100">กำลังเตรียมระบบแผนที่...</div>
  }
);

export default function HeatMapDisplay(props: HeatMapDisplayProps) {
  return <LeafletMap {...props} />;
}
