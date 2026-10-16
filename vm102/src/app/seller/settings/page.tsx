import type { Metadata } from "next";
import SellerSettingsClient from "./SellerSettingsClient";

export const metadata: Metadata = {
  title: "ตั้งค่าร้านค้า - VRU Seller Center",
  description: "ตั้งค่าช่องทางชำระเงินและข้อมูลร้านค้า",
};

export default function SellerSettingsPage() {
  return <SellerSettingsClient />;
}
