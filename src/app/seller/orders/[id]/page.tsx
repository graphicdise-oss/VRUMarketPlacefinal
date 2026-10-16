import type { Metadata } from "next";
import SellerOrderDetailClient from "./SellerOrderDetailClient";

export const metadata: Metadata = {
  title: "รายละเอียดคำสั่งซื้อ - VRU Seller Center",
  description: "จัดการรายละเอียดคำสั่งซื้อ",
};

export default async function SellerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <SellerOrderDetailClient orderId={resolvedParams.id} />;
}
