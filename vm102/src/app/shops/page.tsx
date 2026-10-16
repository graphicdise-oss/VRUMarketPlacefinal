import type { Metadata } from "next";
import ShopsClient from "./ShopsClient";

export const metadata: Metadata = {
  title: "ร้านค้าชุมชน - VRU Marketplace",
  description: "รวมร้านค้าวิสาหกิจชุมชนทั้งหมด",
};

export default function ShopsPage() {
  return <ShopsClient />;
}
