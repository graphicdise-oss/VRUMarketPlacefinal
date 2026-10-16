import type { Metadata } from "next";
import BannerAdminClient from "./BannerAdminClient";

export const metadata: Metadata = {
  title: "จัดการแบนเนอร์โฆษณา - VRU Marketplace",
  description: "ระบบจัดการสไลเดอร์แบนเนอร์หน้าแรกของเว็บไซต์",
};

export default function BannerAdminPage() {
  return <BannerAdminClient />;
}
