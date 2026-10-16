import type { Metadata } from "next";
import ProductDetailClient from "./ProductDetailClient";

export const metadata: Metadata = {
  title: "รายละเอียดสินค้า - VRU Marketplace",
  description: "รายละเอียดสินค้า",
};

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ProductDetailClient productId={resolvedParams.id} />;
}
