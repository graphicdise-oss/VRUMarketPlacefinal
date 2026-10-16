"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * Keeps community admins and super admins out of buying/selling pages.
 * Backend enforces the same rule (@RefusesAdmins); this just stops the UI from offering it.
 */
export default function NoAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isCommunityAdmin = !!user?.adminCommunityIds && user.adminCommunityIds.length > 0;
  const blocked = isSuperAdmin || isCommunityAdmin;

  useEffect(() => {
    if (!isLoading && blocked) {
      router.replace(isSuperAdmin ? "/super-admin" : "/admin/community");
    }
  }, [isLoading, blocked, isSuperAdmin, router]);

  if (isLoading || blocked) return null;
  return <>{children}</>;
}
