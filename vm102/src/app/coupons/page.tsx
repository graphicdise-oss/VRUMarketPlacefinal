import { Suspense } from "react";
import { Metadata } from "next";
import CouponsClient from "./CouponsClient";

export const metadata: Metadata = {
  title: "ศูนย์รวมโค้ดส่วนลด | VRU Marketplace",
  description: "รวมโค้ดส่วนลดและคูปองพิเศษจากร้านค้าชุมชน มรว. เก็บโค้ดไปใช้ลดราคาสินค้าได้ทันที คุ้มค่าทุกการสั่งซื้อ",
};

export default function CouponsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50/60 flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#16A085]" />
        </div>
      }
    >
      <CouponsClient />
    </Suspense>
  );
}

