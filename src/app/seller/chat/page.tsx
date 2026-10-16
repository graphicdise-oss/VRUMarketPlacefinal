import { Metadata } from "next";
import SellerChatClient from "./SellerChatClient";

export const metadata: Metadata = {
  title: "ข้อความผู้ขาย - VRU Marketplace",
  description: "ระบบจัดการข้อความสำหรับร้านค้า VRU Marketplace",
};

export default function SellerChatPage() {
  return <SellerChatClient />;
}
