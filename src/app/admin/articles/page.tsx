import type { Metadata } from "next";
import dynamic from "next/dynamic";

const ArticleAdminClient = dynamic(
  () => import("./ArticleAdminClient"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">กำลังโหลดระบบบทความ...</p>
        </div>
      </div>
    ),
  }
);

export const metadata: Metadata = {
  title: "จัดการเรื่องราวชุมชน - VRU Marketplace",
  description: "ระบบจัดการบทความและเรื่องราวชุมชนของเว็บไซต์",
};

export default function ArticleAdminPage() {
  return <ArticleAdminClient />;
}

