import NoAdminGuard from "@/components/auth/NoAdminGuard";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <NoAdminGuard>{children}</NoAdminGuard>;
}
