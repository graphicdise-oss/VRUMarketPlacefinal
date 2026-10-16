import type { Metadata } from "next";
import OrderDetailClient from "./OrderDetailClient";

export const metadata: Metadata = {
  title: "รายละเอียดคำสั่งซื้อ - VRU Marketplace",
  description: "รายละเอียดและสถานะคำสั่งซื้อของคุณ",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <OrderDetailClient orderId={resolvedParams.id} />;
}
