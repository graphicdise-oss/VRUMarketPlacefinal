import type { Metadata } from "next";
import ProfileClient from "./ProfileClient";

export const metadata: Metadata = {
  title: "ข้อมูลส่วนตัว - VRU Marketplace",
  description: "จัดการข้อมูลส่วนตัว",
};

export default function ProfilePage() {
  return <ProfileClient />;
}
