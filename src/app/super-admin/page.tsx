import type { Metadata } from "next";
import SuperAdminDashboardClient from "./SuperAdminDashboardClient";

export const metadata: Metadata = {
  title: "Super Admin Dashboard - VRU Marketplace",
  description: "แดชบอร์ดผู้ดูแลระบบระดับบนสุด",
};

export default function SuperAdminPage() {
  return <SuperAdminDashboardClient />;
}
