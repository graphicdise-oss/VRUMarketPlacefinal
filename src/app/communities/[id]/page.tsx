import type { Metadata } from "next";
import CommunityDetailClient from "./CommunityDetailClient";

export const metadata: Metadata = {
  title: "ข้อมูลชุมชน - VRU Marketplace",
  description: "รายละเอียดชุมชนและสินค้าที่น่าสนใจ",
};

export default async function CommunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <CommunityDetailClient communityId={resolvedParams.id} />;
}
