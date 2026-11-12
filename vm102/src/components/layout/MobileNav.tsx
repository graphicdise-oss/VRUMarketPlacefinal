"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useBadge } from "@/lib/badge-context";
import { motion } from "framer-motion";

export default function MobileNav() {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuth();
  const { unreadNotifications } = useBadge();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isCommunityAdmin = !!user?.adminCommunityIds && user.adminCommunityIds.length > 0;
  const isAdmin = isSuperAdmin || isCommunityAdmin;

  const adminHref = isSuperAdmin ? "/super-admin" : isCommunityAdmin ? "/admin/community" : "/profile";
  const adminIcon = isAdmin ? "fa-solid fa-shield-halved" : "fa-solid fa-user";
  const adminLabel = isSuperAdmin ? "ส่วนกลาง" : isCommunityAdmin ? "จัดการชุมชน" : "โปรไฟล์";

  const navItems = [
    { href: "/", icon: "fa-solid fa-house", label: "หน้าแรก", id: "home" },
    { href: "/products", icon: "fa-solid fa-bag-shopping", label: "สินค้า", id: "products" },
    ...(isAuthenticated
      ? isAdmin
        ? [{ href: "/notifications", icon: "fa-solid fa-bell", label: "แจ้งเตือน", id: "notifications" }]
        : [
            { href: "/orders", icon: "fa-solid fa-box-archive", label: "คำสั่งซื้อ", id: "orders" },
            { href: "/notifications", icon: "fa-solid fa-bell", label: "แจ้งเตือน", id: "notifications" },
          ]
      : [
          { href: "/coupons", icon: "fa-solid fa-ticket", label: "คูปอง", id: "coupons" },
        ]),
    {
      href: isAuthenticated ? adminHref : "/login",
      icon: adminIcon,
      label: isAuthenticated ? adminLabel : "เข้าสู่ระบบ",
      id: "profile",
    },
  ];

  // Helper to determine active state
  const isItemActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/admin/community") return pathname.startsWith("/admin");
    return pathname.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-3 sm:bottom-4 left-0 right-0 z-50 px-4 pointer-events-none">
      <div className="max-w-[340px] mx-auto bg-white/95 backdrop-blur-2xl border border-emerald-100/90 rounded-full shadow-[0_12px_36px_rgba(22,160,133,0.14),0_2px_8px_rgba(0,0,0,0.06)] p-1.5 flex items-center justify-between pointer-events-auto relative">
        {navItems.map((item) => {
          const active = isItemActive(item.href);

          return (
            <Link
              key={item.id}
              href={item.href}
              className="relative flex items-center justify-center flex-1 h-11 rounded-full text-xs font-semibold select-none transition-colors duration-200"
            >
              {/* Sliding Pill Active Indicator in VRU Brand Green */}
              {active && (
                <motion.div
                  layoutId="mobileSlidingPill"
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-[#16A085] via-teal-600 to-[#117A65] shadow-[0_4px_18px_rgba(22,160,133,0.45)]"
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 30,
                  }}
                />
              )}

              {/* Icon & Badge */}
              <div className="relative z-10 flex items-center justify-center">
                {item.id === "profile" && !isAdmin && user?.avatarUrl ? (
                  <div className={`w-5 h-5 rounded-full overflow-hidden border ${active ? "border-white shadow-xs" : "border-gray-300"}`}>
                    <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <i
                    className={`${item.icon} text-base transition-all duration-200 ${
                      active
                        ? "text-white scale-110 drop-shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
                        : "text-gray-400 hover:text-[#16A085]"
                    }`}
                  />
                )}

                {/* Notification Badge */}
                {item.id === "notifications" && unreadNotifications > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[8px] font-black px-1 min-w-[14px] h-[14px] rounded-full flex items-center justify-center shadow-xs border border-white">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
