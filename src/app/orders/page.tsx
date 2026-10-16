import type { Metadata } from "next";
import OrdersPageClient from "./OrdersPageClient";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "คำสั่งซื้อของฉัน - VRU Marketplace",
  description: "ติดตามสถานะคำสั่งซื้อทั้งหมดของคุณ",
};

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <OrdersPageClient />
    </Suspense>
  );
}
