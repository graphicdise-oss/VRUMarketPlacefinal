"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { useAuth } from "@/lib/auth-context";
import { useBadge } from "@/lib/badge-context";
import CartModal from "@/components/cart/CartModal";
import { usePathname, useRouter } from "next/navigation";
import SearchAutocomplete from "./SearchAutocomplete";

export default function Header() {
  const { totalItems } = useCart();
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { unreadNotifications, unreadChat } = useBadge();
  const [cartOpen, setCartOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // ป้องกันการเลื่อนหน้าจอด้านหลังเมื่อเปิด Mobile Drawer
  useEffect(() => {
    if (mobileDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileDrawerOpen]);

  return (
    <>
      <header className="bg-white/90 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Row 1: Logo, Nav Links, Right Controls */}
          <div className="flex items-center justify-between gap-4 py-2 md:py-2.5">
            {/* Logo Wrapper & Mobile Hamburger */}
            <div className="flex items-center flex-shrink-0 gap-1.5 sm:gap-2">
              {/* Mobile Hamburger Button (ขีด 3 ขีด) */}
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                className="md:hidden p-2 -ml-1 text-gray-700 hover:text-[#16A085] hover:bg-gray-100 rounded-xl transition cursor-pointer"
                aria-label="เปิดเมนูนำทาง"
              >
                <i className="fa-solid fa-bars text-xl"></i>
              </button>

              <Link href="/" className="flex-shrink-0 flex items-center gap-2 md:gap-2.5 lg:gap-3 group">
                <Image src="/logo.png" alt="VRU Marketplace Logo" width={160} height={56} className="h-9 sm:h-10 md:h-11 lg:h-12 w-auto object-contain group-hover:scale-105 transition-transform duration-300" priority />
                <div className="flex flex-col leading-tight">
                  <div className="text-sm sm:text-base md:text-lg lg:text-xl font-bold tracking-tight text-[#16A085] whitespace-nowrap">
                    VRU <span className="text-gray-800">Marketplace</span>
                  </div>
                  <div className="text-[9px] sm:text-[10px] md:text-[10px] lg:text-[11px] font-black tracking-[0.18em] uppercase mt-0.5 bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent transform relative">
                    Thai Trade
                    <div className="absolute -bottom-0.5 left-0 w-full h-[2px] bg-gradient-to-r from-blue-600 to-cyan-500 scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left rounded-full"></div>
                  </div>
                </div>
              </Link>
            </div>

            {/* Navigation Links (Desktop) */}
            <nav className="hidden md:flex items-center gap-6 lg:gap-8 xl:gap-10 text-sm font-bold text-gray-600 flex-shrink-0">
              <Link
                href="/"
                className={`px-1.5 py-1 transition whitespace-nowrap ${
                  pathname === '/'
                    ? 'text-[#16A085] font-black border-b-2 border-[#16A085]'
                    : 'hover:text-[#16A085] border-b-2 border-transparent'
                }`}
              >
                หน้าแรก
              </Link>
              <Link
                href="/shops"
                className={`px-1.5 py-1 transition whitespace-nowrap ${
                  pathname.startsWith('/shops')
                    ? 'text-[#16A085] font-black border-b-2 border-[#16A085]'
                    : 'hover:text-[#16A085] border-b-2 border-transparent'
                }`}
              >
                ร้านค้า
              </Link>
              <Link
                href="/products"
                className={`px-1.5 py-1 transition whitespace-nowrap ${
                  pathname.startsWith('/products')
                    ? 'text-[#16A085] font-black border-b-2 border-[#16A085]'
                    : 'hover:text-[#16A085] border-b-2 border-transparent'
                }`}
              >
                สินค้า
              </Link>
              <Link
                href="/coupons"
                className={`px-1.5 py-1 transition whitespace-nowrap flex items-center gap-1.5 ${
                  pathname.startsWith('/coupons')
                    ? 'text-[#16A085] font-black border-b-2 border-[#16A085]'
                    : 'hover:text-[#16A085] border-b-2 border-transparent'
                }`}
              >
                <span>โค้ดส่วนลด</span>
                <span className="text-[10px] bg-gradient-to-r from-red-500 to-rose-500 text-white font-black px-1.5 py-0.5 rounded-full leading-none shadow-2xs">
                  HOT
                </span>
              </Link>
              {isAuthenticated && !(user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') && (
                <Link
                  href="/orders"
                  className={`px-1.5 py-1 transition whitespace-nowrap ${
                    pathname.startsWith('/orders')
                      ? 'text-[#16A085] font-black border-b-2 border-[#16A085]'
                      : 'hover:text-[#16A085] border-b-2 border-transparent'
                  }`}
                >
                  คำสั่งซื้อ
                </Link>
              )}
            </nav>

            {/* Mobile Action Icons (Chat & Cart) */}
            <div className="flex md:hidden items-center gap-3.5">
              <Link href={isAuthenticated ? (user?.shopId ? "/seller/chat" : "/chat") : "/login"} className="text-gray-500 hover:text-[#16A085] transition relative">
                <i className="fa-regular fa-message text-xl"></i>
                {unreadChat > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#16A085] text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm">
                    {unreadChat > 99 ? "99+" : unreadChat}
                  </span>
                )}
              </Link>
              {!(user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') && (
                <button onClick={() => isAuthenticated ? setCartOpen(true) : router.push("/login")} className="text-gray-500 hover:text-[#16A085] transition relative cursor-pointer">
                  <i className="fa-solid fa-cart-shopping text-xl"></i>
                  {totalItems > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#D4F1BB] text-[#16A085] text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                      {totalItems > 99 ? "99+" : totalItems}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Desktop Right Controls (Notifications, Chat, Cart, Profile) */}
            <div className="hidden md:flex flex-shrink-0 items-center gap-2 lg:gap-4 ml-1 lg:ml-2">
              {/* Notifications */}
              {isAuthenticated && (
                <Link href="/notifications" className="relative text-gray-400 hover:text-[#16A085] transition" title="การแจ้งเตือน">
                  <i className="fa-regular fa-bell text-xl"></i>
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm animate-pulse">
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  )}
                </Link>
              )}

              <Link href={isAuthenticated ? (user?.shopId ? "/seller/chat" : "/chat") : "/login"} className="relative text-gray-400 hover:text-[#16A085] transition" title="ข้อความแชท">
                <i className="fa-regular fa-message text-xl"></i>
                {unreadChat > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#16A085] text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm">
                    {unreadChat > 99 ? "99+" : unreadChat}
                  </span>
                )}
              </Link>

              {!(user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') && (
                <button onClick={() => isAuthenticated ? setCartOpen(true) : router.push("/login")} className="relative text-gray-400 hover:text-[#16A085] transition">
                  <i className="fa-solid fa-cart-shopping text-xl"></i>
                  {totalItems > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#D4F1BB] text-[#16A085] text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                      {totalItems > 99 ? "99+" : totalItems}
                    </span>
                  )}
                </button>
              )}

              <div className="h-6 w-px bg-gray-200 mx-1"></div>

              {/* Auth State */}
              {isLoading ? (
                <div className="w-20 h-8 bg-gray-100 rounded-full animate-pulse"></div>
              ) : isAuthenticated && user ? (
                <div className="relative">
                  <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-2 hover:opacity-80 transition bg-gray-50 px-2 py-1 rounded-full border border-gray-100 shadow-sm">
                    <div className="w-8 h-8 rounded-full gradient-bg text-white flex items-center justify-center text-sm font-bold shadow-inner overflow-hidden border border-white">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        user.displayName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-700 hidden xl:block pl-1 pr-2">{user.displayName}</span>
                  </button>

                  {/* User Dropdown */}
                  {userMenuOpen && (
                    <div className="absolute right-0 top-full mt-3 w-56 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
                      <div className="px-4 py-3 border-b border-gray-50">
                        <p className="text-sm font-bold text-gray-800 truncate">{user.displayName}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      </div>
                      <div className="py-1">
                        {user.role === 'SUPER_ADMIN' ? (
                          <Link href="/super-admin" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-900 hover:bg-[#16A085]/10 hover:text-[#16A085] transition font-bold">
                            <i className="fa-solid fa-server w-4 text-[#16A085]"></i> จัดการระบบส่วนกลาง
                          </Link>
                        ) : (
                          <>
                            <Link href="/profile" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-[#D4F1BB]/30 hover:text-[#16A085] transition">
                              <i className="fa-regular fa-user w-4"></i> ข้อมูลส่วนตัว
                            </Link>

                            {!(user.adminCommunityIds && user.adminCommunityIds.length > 0) && (
                              <>
                                <Link href="/profile/wishlist" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-[#D4F1BB]/30 hover:text-[#16A085] transition">
                                  <i className="fa-regular fa-heart w-4"></i> สินค้าที่ถูกใจ
                                </Link>
                                <Link href="/profile/coupons" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-[#D4F1BB]/30 hover:text-[#16A085] transition">
                                  <i className="fa-solid fa-ticket w-4"></i> โค้ดส่วนลดที่เราเก็บ
                                </Link>
                              </>
                            )}

                            {user.shopId ? (
                              <Link href="/seller" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-[#16A085] bg-[#16A085]/5 hover:bg-[#16A085]/10 transition">
                                <i className="fa-solid fa-store w-4"></i> จัดการร้านค้า
                              </Link>
                            ) : (!(user.adminCommunityIds && user.adminCommunityIds.length > 0) && (
                              <Link href="/register-shop" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-[#16A085] bg-[#16A085]/5 hover:bg-[#16A085]/10 transition">
                                <i className="fa-solid fa-shop w-4"></i> ลงทะเบียนเปิดร้านค้า
                              </Link>
                            ))}

                            {(user.adminCommunityIds && user.adminCommunityIds.length > 0) && (
                              <Link href="/admin/community" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-purple-600 hover:bg-purple-50 transition border-t border-gray-100 mt-1 pt-2">
                                <i className="fa-solid fa-shield-halved w-4"></i> จัดการชุมชน
                              </Link>
                            )}
                          </>
                        )}
                      </div>
                      <div className="border-t border-gray-50 mt-1 pt-1">
                        <button onClick={() => { logout(); setUserMenuOpen(false); }} className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition w-full">
                          <i className="fa-solid fa-right-from-bracket w-4"></i> ออกจากระบบ
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 lg:gap-2">
                  <Link href="/login" className="text-gray-500 font-bold text-xs lg:text-sm px-2.5 lg:px-4 py-1.5 lg:py-2 hover:text-[#16A085] transition whitespace-nowrap">เข้าสู่ระบบ</Link>
                  <Link href="/register" className="btn-minimal px-3.5 lg:px-5 py-1.5 lg:py-2 rounded-full text-xs lg:text-sm font-bold whitespace-nowrap">สร้างบัญชี</Link>
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Search Bar */}
          <div className="pb-2.5 pt-0.5 md:pt-1">
            <div className="max-w-2xl lg:max-w-3xl mx-auto w-full relative">
              <SearchAutocomplete />
            </div>
          </div>
        </div>
      </header>
      <CartModal isOpen={cartOpen} onClose={() => setCartOpen(false)} />

      {/* ======================================================== */}
      {/* MOBILE NAVIGATION DRAWER (Slide out on hamburger click)   */}
      {/* ======================================================== */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileDrawerOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="fixed inset-y-0 left-0 w-[84%] max-w-xs bg-white shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-300 h-[100dvh] max-h-[100dvh]">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/60 to-teal-50/30">
              <Link href="/" onClick={() => setMobileDrawerOpen(false)} className="flex items-center gap-2">
                <Image src="/logo.png" alt="VRU Marketplace Logo" width={120} height={42} className="h-8 w-auto object-contain" />
                <div className="leading-tight">
                  <div className="text-sm font-bold text-[#16A085]">VRU <span className="text-gray-800">Marketplace</span></div>
                  <div className="text-[9px] font-black tracking-widest uppercase text-blue-600">Thai Trade</div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center transition cursor-pointer"
                aria-label="ปิดเมนู"
              >
                <i className="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>

            {/* User Profile Card or Auth Buttons */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/60">
              {isAuthenticated && user ? (
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full gradient-bg text-white flex items-center justify-center font-bold text-base shadow-xs overflow-hidden border border-white flex-shrink-0">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      user.displayName ? user.displayName.charAt(0).toUpperCase() : "U"
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-800 truncate">{user.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Link
                    href="/login"
                    onClick={() => setMobileDrawerOpen(false)}
                    className="flex-1 text-center py-2 px-3 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:text-[#16A085]"
                  >
                    เข้าสู่ระบบ
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setMobileDrawerOpen(false)}
                    className="flex-1 text-center py-2 px-3 rounded-xl bg-[#16A085] text-white text-xs font-bold hover:bg-[#12876f]"
                  >
                    สร้างบัญชี
                  </Link>
                </div>
              )}
            </div>

            {/* Scrollable Nav Sections */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Primary Navigation */}
              <div>
                <p className="text-[11px] font-black uppercase text-gray-400 tracking-wider mb-2 px-2">
                  เมนูหลัก
                </p>
                <div className="space-y-1">
                  <Link
                    href="/"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition ${
                      pathname === '/' ? 'bg-[#16A085] text-white shadow-xs' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <i className="fa-solid fa-house w-5 text-center"></i>
                    <span>หน้าแรก</span>
                  </Link>
                  <Link
                    href="/shops"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition ${
                      pathname.startsWith('/shops') ? 'bg-[#16A085] text-white shadow-xs' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <i className="fa-solid fa-store w-5 text-center"></i>
                    <span>ร้านค้า</span>
                  </Link>
                  <Link
                    href="/products"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition ${
                      pathname.startsWith('/products') ? 'bg-[#16A085] text-white shadow-xs' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <i className="fa-solid fa-box-open w-5 text-center"></i>
                    <span>สินค้า</span>
                  </Link>
                  <Link
                    href="/coupons"
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-bold transition ${
                      pathname.startsWith('/coupons') ? 'bg-[#16A085] text-white shadow-xs' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <i className="fa-solid fa-ticket w-5 text-center"></i>
                      <span>โค้ดส่วนลด</span>
                    </div>
                    <span className="text-[10px] bg-rose-500 text-white font-extrabold px-1.5 py-0.5 rounded-full">
                      HOT
                    </span>
                  </Link>
                  {isAuthenticated && !(user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') && (
                    <Link
                      href="/orders"
                      onClick={() => setMobileDrawerOpen(false)}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition ${
                        pathname.startsWith('/orders') ? 'bg-[#16A085] text-white shadow-xs' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <i className="fa-solid fa-receipt w-5 text-center"></i>
                      <span>คำสั่งซื้อ</span>
                    </Link>
                  )}
                </div>
              </div>

              {/* Account Navigation (if logged in) */}
              {isAuthenticated && user && (
                <div>
                  <p className="text-[11px] font-black uppercase text-gray-400 tracking-wider mb-2 px-2">
                    บัญชีของฉัน
                  </p>
                  <div className="space-y-1">
                    <Link
                      href="/profile"
                      onClick={() => setMobileDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition font-medium"
                    >
                      <i className="fa-regular fa-user w-5 text-center"></i>
                      <span>ข้อมูลส่วนตัว</span>
                    </Link>
                    <Link
                      href="/profile/coupons"
                      onClick={() => setMobileDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition font-medium"
                    >
                      <i className="fa-solid fa-ticket w-5 text-center text-[#16A085]"></i>
                      <span>โค้ดส่วนลดที่เราเก็บ</span>
                    </Link>
                    <Link
                      href="/profile/wishlist"
                      onClick={() => setMobileDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition font-medium"
                    >
                      <i className="fa-regular fa-heart w-5 text-center"></i>
                      <span>สินค้าที่ถูกใจ</span>
                    </Link>
                    <Link
                      href="/profile/addresses"
                      onClick={() => setMobileDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition font-medium"
                    >
                      <i className="fa-solid fa-location-dot w-5 text-center"></i>
                      <span>ที่อยู่จัดส่ง</span>
                    </Link>
                    <Link
                      href="/profile/password"
                      onClick={() => setMobileDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition font-medium"
                    >
                      <i className="fa-solid fa-lock w-5 text-center"></i>
                      <span>เปลี่ยนรหัสผ่าน</span>
                    </Link>

                    {user.shopId ? (
                      <Link
                        href="/seller"
                        onClick={() => setMobileDrawerOpen(false)}
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#16A085] bg-[#16A085]/5 hover:bg-[#16A085]/10 transition"
                      >
                        <i className="fa-solid fa-store w-5 text-center"></i>
                        <span>จัดการร้านค้า</span>
                      </Link>
                    ) : (
                      <Link
                        href="/register-shop"
                        onClick={() => setMobileDrawerOpen(false)}
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold text-[#16A085] bg-[#16A085]/5 hover:bg-[#16A085]/10 transition"
                      >
                        <i className="fa-solid fa-shop w-5 text-center"></i>
                        <span>ลงทะเบียนเปิดร้านค้า</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Logout Button (Sticky at bottom of drawer, above MobileNav) */}
            {isAuthenticated && (
              <div className="p-3 border-t border-gray-100 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.05)] pb-safe">
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 rounded-xl font-bold transition cursor-pointer border border-red-200 shadow-2xs"
                >
                  <i className="fa-solid fa-right-from-bracket"></i>
                  <span>ออกจากระบบ</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}