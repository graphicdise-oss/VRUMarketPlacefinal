import type { Metadata } from "next";
import ShopClient from "./ShopClient";

export const metadata: Metadata = {
  title: "ร้านค้า - VRU Marketplace",
  description: "รายละเอียดร้านค้า",
};

export default async function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ShopClient shopId={resolvedParams.id} />;
}
