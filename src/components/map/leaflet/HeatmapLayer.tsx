"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { HeatMapPoint } from "../HeatMapDisplay";

interface HeatmapLayerProps {
  points: HeatMapPoint[];
}

export default function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof window === "undefined") return;

    let heatLayer: any = null;
    let isCancelled = false;

    import("leaflet.heat").then(() => {
      if (isCancelled || !map) return;

      const maxWeight = Math.max(...points.map((p) => p.weight), 1);
      const heatData = points.map((p) => {
        const normalizedIntensity = p.weight / maxWeight;
        return [p.lat, p.lng, normalizedIntensity] as [number, number, number];
      });

      const options = {
        radius: 50,
        blur: 25,
        maxZoom: 17,
        max: 1.0,
        minOpacity: 0.4,
        gradient: {
          0.1: "blue",
          0.3: "cyan",
          0.5: "lime",
          0.7: "yellow",
          1.0: "red",
        },
      };

      // @ts-ignore
      heatLayer = L.heatLayer(heatData, options).addTo(map);
    }).catch((err) => {
      console.warn("Leaflet.heat failed to load:", err);
    });

    return () => {
      isCancelled = true;
      if (heatLayer && map) {
        map.removeLayer(heatLayer);
      }
    };
  }, [map, points]);

  return null;
}
