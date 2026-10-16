"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface ProfileSidebarProps {
  name: string;
  avatarUrl: string | null;
}

type MenuItem = {
  href: string;
  icon: string;
  label: string;
  exact?: boolean;
  matchPath?: string;
};

export default function ProfileSidebar({ name, avatarUrl }: ProfileSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isCommunityAdmin = user && (user.adminCommunityIds && user.adminCommunityIds.length > 0);
  const isAdmin = isSuperAdmin || isCommunityAdmin;

  let menuItems: MenuItem[] = [
    {
      href: "/profile",
      icon: "fa-regular fa-user",
      label: "ข้อมูลส่วนตัว",
      exact: true
    },
    {
      href: "/profile/password",
      icon: "fa-solid fa-lock",
      label: "เปลี่ยนรหัสผ่าน",
    },
    {
      href: "/profile/coupons",
      matchPath: "/profile/coupons",
      icon: "fa-solid fa-ticket",
      label: "โค้ดส่วนลดที่เราเก็บ",
    },
    {
      href: "/profile/addresses?from=profile",
      matchPath: "/profile/addresses",
      icon: "fa-solid fa-location-dot",
      label: "ที่อยู่จัดส่ง",
    },
    {
      href: "/orders?from=profile",
      matchPath: "/orders",
      icon: "fa-solid fa-box",
      label: "คำสั่งซื้อของฉัน",
    },
    {
      href: "/profile/reviews",
      icon: "fa-regular fa-star",
      label: "รอการรีวิว",
    },
    ...(user?.shopId ? [{
      href: "/seller",
      icon: "fa-solid fa-store",
      label: "ร้านค้าของฉัน",
    }] : [{
      href: "/register-shop",
      icon: "fa-solid fa-store",
      label: "เปิดร้านค้ากับเรา",
    }])
  ];

  if (isSuperAdmin) {
    menuItems = [
      {
        href: "/super-admin",
        icon: "fa-solid fa-shield-halved",
        label: "การจัดการระบบส่วนกลาง",
      },
      {
        href: "/profile/password",
        icon: "fa-solid fa-lock",
        label: "เปลี่ยนรหัสผ่าน",
      }
    ];
  } else if (isAdmin) {
    menuItems = menuItems.filter(item => 
      !['ที่อยู่จัดส่ง', 'คำสั่งซื้อของฉัน', 'รอการรีวิว', 'โค้ดส่วนลดที่เราเก็บ'].includes(item.label) &&
      item.href !== "/register-shop"
    );
  }

  // Find currently active menu item
  const currentItem = menuItems.find((item) => {
    const checkPath = item.matchPath || item.href;
    return item.exact ? pathname === checkPath : pathname.startsWith(checkPath);
  }) || menuItems[0];

  return (
    <>
      {/* ======================================================== */}
      {/* MOBILE TRIGGER BAR: Hidden Menu (md:hidden)               */}
      {/* ======================================================== */}
      <div className="md:hidden w-full mb-4">
        <div className="bg-white rounded-2xl p-3 shadow-xs border border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-[#16A085]/10 text-[#16A085] rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 overflow-hidden border border-emerald-100">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                name ? name.charAt(0).toUpperCase() : "U"
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-800 text-sm truncate">{name || "User"}</h3>
              <p className="text-xs text-[#16A085] font-semibold flex items-center gap-1.5 truncate">
                <i className={`${currentItem?.icon || "fa-regular fa-user"} text-[11px]`}></i>
                <span>{currentItem?.label || "ข้อมูลส่วนตัว"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[#16A085] hover:bg-[#12876f] text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
              aria-label="เปิดเมนูโปรไฟล์"
            >
              <i className="fa-solid fa-bars text-sm"></i>
              <span>เมนูโปรไฟล์</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("คุณต้องการออกจากระบบหรือไม่?")) {
                  await logout();
                  router.push("/login");
                }
              }}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center border border-red-200 transition cursor-pointer active:scale-95 shadow-2xs"
            >
              <i className="fa-solid fa-right-from-bracket text-xs"></i>
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MOBILE SLIDE-OUT DRAWER                                   */}
      {/* ======================================================== */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="fixed inset-y-0 left-0 w-[82%] max-w-xs bg-white shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-300 h-[100dvh] max-h-[100dvh]">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/60 to-teal-50/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-white rounded-full border border-emerald-100 shadow-xs flex items-center justify-center font-bold text-base text-[#16A085] overflow-hidden flex-shrink-0">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    name ? name.charAt(0).toUpperCase() : "U"
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-800 text-sm truncate">{name || "User"}</h3>
                  <span className="text-[11px] text-[#16A085] font-semibold flex items-center gap-1">
                    <i className="fa-solid fa-shield-halved text-[10px]"></i>
                    {isSuperAdmin ? "ผู้ดูแลระบบส่วนกลาง" : "เมนูจัดการบัญชี"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-700 flex items-center justify-center transition cursor-pointer flex-shrink-0"
              >
                <i className="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>

            {/* Menu Items List */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {menuItems.map((item) => {
                const checkPath = item.matchPath || item.href;
                const isActive = item.exact 
                  ? pathname === checkPath 
                  : pathname.startsWith(checkPath);
                  
                return (
                  <Link 
                    key={item.href}
                    href={item.href} 
                    onClick={() => setIsMenuOpen(false)}
                    className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl font-medium text-sm transition ${
                      isActive 
                        ? "bg-[#16A085] text-white font-bold shadow-xs" 
                        : "text-gray-600 hover:bg-emerald-50/60 hover:text-[#16A085]"
                    }`}
                  >
                    <i className={`${item.icon} w-5 text-base`}></i>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Drawer Footer with Sticky Logout Button */}
            <div className="p-3 border-t border-gray-100 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.05)] pb-safe">
              <button
                type="button"
                onClick={async () => {
                  setIsMenuOpen(false);
                  if (window.confirm("คุณต้องการออกจากระบบหรือไม่?")) {
                    await logout();
                    router.push("/login");
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 text-sm font-bold transition cursor-pointer border border-red-200 shadow-2xs"
              >
                <i className="fa-solid fa-right-from-bracket"></i>
                <span>ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* DESKTOP SIDEBAR (Static sticky on md and larger)         */}
      {/* ======================================================== */}
      <div className="hidden md:block w-64 flex-shrink-0">
        <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100 sticky top-24">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 bg-gray-100 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-xl text-gray-400 overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                name ? name.charAt(0).toUpperCase() : "U"
              )}
            </div>
            <div>
              <h3 className="font-bold text-gray-800 line-clamp-1">{name || "User"}</h3>
              {isSuperAdmin ? (
                <span className="text-xs text-[#16A085] font-semibold flex items-center gap-1 mt-0.5">
                  <i className="fa-solid fa-shield-halved"></i> ผู้ดูแลระบบส่วนกลาง
                </span>
              ) : (
                <Link href="/profile" className="text-xs text-[#16A085] hover:underline font-medium">
                  <i className="fa-solid fa-pen"></i> แก้ไขโปรไฟล์
                </Link>
              )}
            </div>
          </div>
          
          <nav className="space-y-1">
            {menuItems.map((item) => {
              const checkPath = item.matchPath || item.href;
              const isActive = item.exact 
                ? pathname === checkPath 
                : pathname.startsWith(checkPath);
                
              return (
                <Link 
                  key={item.href}
                  href={item.href} 
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition ${
                    isActive 
                      ? "bg-[#D4F1BB]/30 text-[#16A085] font-bold" 
                      : "text-gray-600 hover:bg-gray-50 hover:text-[#16A085]"
                  }`}
                >
                  <i className={`${item.icon} w-5`}></i> {item.label}
                </Link>
              );
            })}

            {/* Desktop Logout Button */}
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("คุณต้องการออกจากระบบหรือไม่?")) {
                  await logout();
                  router.push("/login");
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-red-500 hover:bg-red-50 hover:text-red-600 transition cursor-pointer mt-4 border-t border-gray-100 pt-3"
            >
              <i className="fa-solid fa-right-from-bracket w-5"></i>
              <span>ออกจากระบบ</span>
            </button>
          </nav>
        </div>
      </div>
    </>
  );
}
