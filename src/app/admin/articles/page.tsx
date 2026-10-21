import type { Metadata } from "next";
import ArticleAdminClient from "./ArticleAdminClient";

export const metadata: Metadata = {
  title: "จัดการเรื่องราวชุมชน - VRU Marketplace",
  description: "ระบบจัดการบทความและเรื่องราวชุมชนของเว็บไซต์",
};

export default function ArticleAdminPage() {
  return <ArticleAdminClient />;
}


