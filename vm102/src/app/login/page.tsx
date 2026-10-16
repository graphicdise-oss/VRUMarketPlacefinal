import type { Metadata } from "next";
import LoginPageClient from "./LoginPageClient";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ - VRU Marketplace",
  description: "เข้าสู่ระบบ VRU Marketplace แหล่งรวมสินค้าชุมชนออนไลน์",
};

export default function LoginPage() {
  return <LoginPageClient />;
}