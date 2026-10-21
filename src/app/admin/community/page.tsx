import type { Metadata } from "next";
import CommunityAdminClient from "./CommunityAdminClient";

export const metadata: Metadata = {
  title: "แอดมินชุมชน - VRU Marketplace",
  description: "จัดการร้านค้า สินค้า และข้อพิพาทในชุมชนของคุณ",
};

export default function CommunityAdminPage() {
  return <CommunityAdminClient />;
}


