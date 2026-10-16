import type { Metadata } from "next";
import ChatPageClient from "./ChatPageClient";

export const metadata: Metadata = {
  title: "แชท - VRU Marketplace",
  description: "ส่งข้อความถึงร้านค้าชุมชน",
};

export default function ChatPage() {
  return <ChatPageClient />;
}