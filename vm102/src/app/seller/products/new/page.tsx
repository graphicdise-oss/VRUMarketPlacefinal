import type { Metadata } from "next";
import NewProductClient from "./NewProductClient";

export const metadata: Metadata = {
  title: "เพิ่มสินค้าใหม่ - VRU Seller Center",
  description: "เพิ่มสินค้าใหม่",
};

export default function NewProductPage() {
  return <NewProductClient />;
}
