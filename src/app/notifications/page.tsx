import type { Metadata } from "next";
import NotificationsClient from "./NotificationsClient";

export const metadata: Metadata = {
  title: "แจ้งเตือน - VRU Marketplace",
  description: "การแจ้งเตือนทั้งหมดของคุณ",
};

export default function NotificationsPage() {
  return <NotificationsClient />;
}
