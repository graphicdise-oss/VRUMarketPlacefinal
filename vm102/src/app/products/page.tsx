import type { Metadata } from "next";
import ProductsClient from "./ProductsClient";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "ผลิตภัณฑ์ชุมชน - VRU Marketplace",
  description: "เลือกซื้อผลิตภัณฑ์ชุมชนทั้งหมด",
};

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">กำลังโหลดข้อมูล...</div>}>
      <ProductsClient />
    </Suspense>
  );
}
