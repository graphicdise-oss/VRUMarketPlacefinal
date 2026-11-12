import type { Metadata } from "next";
import ChatPageClient from "./ChatPageClient";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "แชท - VRU Marketplace",
  description: "ส่งข้อความถึงร้านค้าชุมชน",
};

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-gray-50 flex-col gap-4">
          <div className="w-12 h-12 border-4 border-[#D4F1BB] border-t-[#16A085] rounded-full animate-spin"></div>
          <p className="text-gray-500 font-bold">กำลังโหลดห้องแชท...</p>
        </div>
      }
    >
      <ChatPageClient />
    </Suspense>
  );
}