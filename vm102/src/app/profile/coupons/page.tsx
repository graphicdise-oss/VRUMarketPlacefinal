import { Metadata } from "next";
import CouponsListClient from "./CouponsListClient";

export const metadata: Metadata = {
  title: "โค้ดส่วนลดที่เราเก็บ | VRU Marketplace",
  description: "รายการโค้ดส่วนลดและคูปองทั้งหมดที่คุณเก็บไว้ในระบบ VRU Marketplace พร้อมใช้งานทันทีในการสั่งซื้อ",
};

export default function UserCouponsPage() {
  return <CouponsListClient />;
}
