"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useBadge } from "@/lib/badge-context";

export default function MobileNav() {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuth();
  const { unreadNotifications, unreadChat } = useBadge();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const navItems = [
    { href: "/", icon: "fa-solid fa-house", label: "หน้าแรก" },
    { href: "/products", icon: "fa-solid fa-border-all", label: "สินค้า" },
    ...(isAuthenticated
      ? (isSuperAdmin
          ? [{ href: "/notifications", icon: "fa-regular fa-bell", label: "แจ้งเตือน" }]
          : [
              { href: "/orders", icon: "fa-solid fa-box", label: "คำสั่งซื้อ" },
              { href: "/notifications", icon: "fa-regular fa-bell", label: "แจ้งเตือน" }
            ])
      : [
          { href: "/login", icon: "fa-regular fa-message", label: "แชท" }
        ]),
    {
      href: isAuthenticated ? (isSuperAdmin ? "/super-admin" : "/profile") : "/login",
      icon: isSuperAdmin ? "fa-solid fa-server" : "fa-regular fa-user",
      label: isAuthenticated ? (isSuperAdmin ? "ระบบส่วนกลาง" : "โปรไฟล์") : "เข้าสู่ระบบ"
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-100 flex justify-around items-center h-16 z-50 pb-safe">
      {navItems.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex flex-col items-center justify-center w-full h-full transition ${pathname === item.href ? "text-[#16A085]" : "text-gray-400 hover:text-[#16A085]"}`}
        >
          <div className="relative">
            <i className={`${item.icon} text-[22px] mb-1 ${pathname === item.href ? "drop-shadow-[0_2px_4px_rgba(22,160,133,0.3)]" : ""}`}></i>
            {item.href === "/notifications" && unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[9px] font-bold px-1 min-w-[15px] h-[15px] rounded-full flex items-center justify-center shadow-sm">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
            {item.href === "/chat" && unreadChat > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#16A085] text-white text-[9px] font-bold px-1 min-w-[15px] h-[15px] rounded-full flex items-center justify-center shadow-sm">
                {unreadChat > 99 ? "99+" : unreadChat}
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}