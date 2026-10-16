import type { Metadata } from "next";
import SellerProductsClient from "./SellerProductsClient";

export const metadata: Metadata = {
  title: "จัดการสินค้า - VRU Seller Center",
  description: "จัดการรายการสินค้าของคุณ",
};

export default function SellerProductsPage() {
  return <SellerProductsClient />;
}
