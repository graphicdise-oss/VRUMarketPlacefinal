import type { Metadata } from "next";
import PasswordClient from "./PasswordClient";

export const metadata: Metadata = {
  title: "เปลี่ยนรหัสผ่าน - VRU Marketplace",
  description: "ตั้งค่ารหัสผ่านใหม่เพื่อความปลอดภัยของบัญชี",
};

export default function PasswordPage() {
  return <PasswordClient />;
}
