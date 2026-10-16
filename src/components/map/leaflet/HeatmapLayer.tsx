"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { HeatMapPoint } from "../HeatMapDisplay";

interface HeatmapLayerProps {
  points: HeatMapPoint[];
}

export default function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    
    // 1. เทคนิคสำคัญ: Normalization ทำให้น้ำหนักอยู่ระหว่าง 0.0 ถึง 1.0
    const maxWeight = Math.max(...points.map(p => p.weight), 1);
    
    // 2. โครงสร้างข้อมูล (Data Format): [latitude, longitude, intensity]
    const heatData = points.map(p => {
      const normalizedIntensity = p.weight / maxWeight; // ค่า 0.0 ถึง 1.0
      return [p.lat, p.lng, normalizedIntensity] as [number, number, number];
    });
    
    // Configurable options for heatmap
    const options = {
      radius: 50,       // ขยายรัศมีความฟุ้ง (Radius) ให้ใหญ่ขึ้น
      blur: 25,         // การกระจายตัว (Blur)
      maxZoom: 17,
      max: 1.0,         // ตั้งค่าฐานสุดเป็น 1.0
      minOpacity: 0.4,  // บังคับให้จุดที่สว่างน้อยที่สุดก็ยังมีความทึบแสง 40% (มองเห็นชัด)
      gradient: {
        0.1: 'blue',
        0.3: 'cyan',
        0.5: 'lime',
        0.7: 'yellow',
        1.0: 'red'
      }
    };
    
    // Create the heat layer
    // @ts-ignore - leaflet.heat types might not be perfectly aligned with standard L namespace
    const heatLayer = L.heatLayer(heatData, options).addTo(map);

    // Cleanup when component unmounts or points change
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null;
}
