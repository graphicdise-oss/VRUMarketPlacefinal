import { Metadata } from "next";
import { Suspense } from "react";
import RegisterShopClient from "./RegisterShopClient";

export const metadata: Metadata = {
  title: "ลงทะเบียนเปิดร้านค้า | VRU Marketplace",
  description: "สมัครเปิดร้านค้าเพื่อขายสินค้าบนแพลตฟอร์ม",
};

export default function RegisterShopPage() {
  return (
    <Suspense fallback={null}>
      <RegisterShopClient />
    </Suspense>
  );
}
