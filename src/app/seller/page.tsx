import type { Metadata } from "next";
import dynamic from "next/dynamic";

const SellerDashboardClient = dynamic(
  () => import("./SellerDashboardClient"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">กำลังโหลดแดชบอร์ดร้านค้า...</p>
        </div>
      </div>
    ),
  }
);

export const metadata: Metadata = {
  title: "หลังบ้านร้านค้า - VRU Marketplace",
  description: "จัดการร้านค้า สินค้า และคำสั่งซื้อของคุณ",
};

export default function SellerPage() {
  return <SellerDashboardClient />;
}

