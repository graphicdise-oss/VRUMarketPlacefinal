import type { Metadata } from "next";
import SellerCouponsClient from "./SellerCouponsClient";

export const metadata: Metadata = {
  title: "จัดการโค้ดส่วนลด - VRU Seller Center",
  description: "สร้างและจัดการคูปองส่วนลดร้านค้าสำหรับผู้ซื้อ",
};

export default function SellerCouponsPage() {
  return <SellerCouponsClient />;
}
