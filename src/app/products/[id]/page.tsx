import type { Metadata } from "next";
import ProductDetailClient from "./ProductDetailClient";
import { productApi } from "@/lib/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  try {
    const product = await productApi.getPublicById(resolvedParams.id);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";
    const imageUrl =
      product.images && product.images.length > 0
        ? `${apiUrl}/products/${product.id}/images/${product.images[0].id}`
        : undefined;

    const desc = product.description
      ? product.description.slice(0, 150)
      : "สินค้าชุมชนคุณภาพบน VRU Marketplace";

    return {
      title: `${product.name} - VRU Marketplace`,
      description: desc,
      openGraph: {
        title: product.name,
        description: desc,
        images: imageUrl ? [{ url: imageUrl, alt: product.name }] : [],
      },
    };
  } catch {
    return {
      title: "รายละเอียดสินค้า - VRU Marketplace",
      description: "รายละเอียดสินค้าและผลิตภัณฑ์ชุมชนบน VRU Marketplace",
    };
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ProductDetailClient productId={resolvedParams.id} />;
}
