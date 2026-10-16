import type { Metadata } from "next";
import SellerDashboardClient from "./SellerDashboardClient";

export const metadata: Metadata = {
  title: "หลังบ้านร้านค้า - VRU Marketplace",
  description: "จัดการร้านค้า สินค้า และคำสั่งซื้อของคุณ",
};

export default function SellerPage() {
  return <SellerDashboardClient />;
}
