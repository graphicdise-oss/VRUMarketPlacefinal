import { Suspense } from "react";
import type { Metadata } from "next";
import CheckoutPageClient from "./CheckoutPageClient";

export const metadata: Metadata = {
  title: "ยืนยันคำสั่งซื้อ - VRU Marketplace",
  description: "ตรวจสอบรายการสินค้าและยืนยันคำสั่งซื้อ",
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">กำลังโหลด...</div>}>
      <CheckoutPageClient />
    </Suspense>
  );
}
