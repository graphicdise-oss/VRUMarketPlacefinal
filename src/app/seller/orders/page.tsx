import type { Metadata } from "next";
import SellerOrdersClient from "./SellerOrdersClient";

export const metadata: Metadata = {
  title: "จัดการคำสั่งซื้อ - VRU Seller Center",
  description: "จัดการคำสั่งซื้อของร้านค้าคุณ",
};

export default function SellerOrdersPage() {
  return <SellerOrdersClient />;
}
