import type { Metadata } from "next";
import AddressesClient from "./AddressesClient";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "ที่อยู่จัดส่ง - VRU Marketplace",
  description: "จัดการที่อยู่จัดส่งของคุณ",
};

export default function AddressesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <AddressesClient />
    </Suspense>
  );
}
