import type { Metadata } from "next";
import RegisterPageClient from "./RegisterPageClient";

export const metadata: Metadata = {
  title: "ลงทะเบียน - VRU Marketplace",
  description: "สมัครสมาชิก VRU Marketplace แหล่งรวมสินค้าชุมชนออนไลน์",
};

export default function RegisterPage() {
  return <RegisterPageClient />;
}