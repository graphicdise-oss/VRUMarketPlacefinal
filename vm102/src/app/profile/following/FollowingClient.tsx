"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { shopApi, PublicShopDto } from "@/lib/api-modules/shop";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { useToast } from "@/components/ui/Toast";

export default function FollowingClient() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [shops, setShops] = useState<PublicShopDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const fetchFollowedShops = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await shopApi.getFollowedShops();
      setShops(res);
    } catch (err: unknown) {
      const error = err as Error & { status?: number };
      if (error?.message === "กรุณาเข้าสู่ระบบก่อน" || error?.status === 401) {
        router.push("/login");
      } else {
        console.error("Failed to fetch followed shops:", error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login");
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (user) {
      fetchFollowedShops();
    }
  }, [user, fetchFollowedShops]);

  const handleUnfollow = async (shop: PublicShopDto) => {
    try {
      setUnfollowingId(shop.id);
      await shopApi.unfollow(shop.id);
      setShops((prev) => prev.filter((s) => s.id !== shop.id));
      showToast(`เลิกติดตามร้าน "${shop.name}" เรียบร้อยแล้ว`, "success");
    } catch (err) {
      console.error("Failed to unfollow shop:", err);
      showToast("เกิดข้อผิดพลาดในการเลิกติดตาม กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setUnfollowingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50">
      <Header />

      <main className="flex-grow max-w-7xl mx-auto w-full px-3 sm:px-4 pt-4 sm:pt-6 pb-24 md:pb-10">
        <Breadcrumb
          items={[
            { label: "ข้อมูลส่วนตัว", href: "/profile" },
            { label: "ร้านค้าที่ติดตาม" },
          ]}
        />

        <div className="flex flex-col md:flex-row gap-6 md:gap-8 mt-4">
          {/* Profile Sidebar */}
          <aside className="w-full md:w-64 flex-shrink-0">
            <ProfileSidebar
              name={user?.displayName || "ผู้ใช้งาน"}
              avatarUrl={user?.avatarUrl || null}
            />
          </aside>

          {/* Main Content Area */}
          <div className="flex-grow min-w-0">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-7 md:p-9">
              {/* Header Title */}
              <div className="flex items-center justify-between pb-5 mb-6 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-emerald-50 text-[#16A085] flex items-center justify-center text-lg sm:text-xl shadow-xs border border-emerald-100/60">
                    <i className="fa-solid fa-store"></i>
                  </div>
                  <div>
                    <h1 className="text-xl sm:text-2xl font-black text-gray-800">ร้านค้าที่ติดตาม</h1>
                    <p className="text-xs sm:text-sm text-gray-500 font-medium">
                      ติดตามร้านค้าชุมชนที่คุณชื่นชอบเพื่อไม่พลาดสินค้าใหม่และโปรโมชั่นพิเศษ
                    </p>
                  </div>
                </div>
                {!isLoading && shops.length > 0 && (
                  <span className="text-xs sm:text-sm bg-emerald-50 text-[#16A085] font-bold px-3 py-1.5 rounded-full border border-[#16A085]/20">
                    {shops.length} ร้านค้า
                  </span>
                )}
              </div>

              {/* Content List */}
              {isLoading ? (
                <div className="py-20 text-center">
                  <div className="w-9 h-9 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-xs sm:text-sm text-gray-400 font-medium">กำลังโหลดร้านค้าที่ติดตาม...</p>
                </div>
              ) : shops.length === 0 ? (
                <div className="text-center py-16 px-4 bg-gray-50/70 rounded-3xl border-2 border-dashed border-gray-200">
                  <div className="w-20 h-20 bg-white rounded-3xl shadow-xs flex items-center justify-center mx-auto mb-4 text-[#16A085] text-3xl border border-gray-100">
                    <i className="fa-solid fa-store"></i>
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 mb-1">ยังไม่มีร้านค้าที่คุณติดตาม</h3>
                  <p className="text-xs sm:text-sm text-gray-500 mb-6 max-w-md mx-auto">
                    คุณสามารถกดติดตามร้านค้าชุมชนที่สนใจเพื่อรับข่าวสารและสินค้าใหม่ได้ก่อนใคร
                  </p>
                  <Link
                    href="/products"
                    className="inline-flex items-center gap-2 bg-[#16A085] hover:bg-[#12876f] text-white px-5 py-2.5 rounded-2xl font-bold text-sm transition shadow-sm hover:shadow active:scale-95 cursor-pointer"
                  >
                    <i className="fa-solid fa-cart-shopping"></i> สำรวจร้านค้าและสินค้า
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  {shops.map((shop) => (
                    <div
                      key={shop.id}
                      className="bg-white border border-gray-200/80 hover:border-[#16A085]/40 rounded-3xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-all duration-300 flex flex-col justify-between group relative"
                    >
                      <div>
                        {/* Top Info */}
                        <div className="flex items-start gap-3.5 mb-3.5">
                          {/* Logo */}
                          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden bg-emerald-50 border border-gray-100 flex-shrink-0 flex items-center justify-center shadow-xs">
                            {shop.hasLogo ? (
                              <img
                                src={`/api/v1/shops/${shop.id}/logo`}
                                alt={shop.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              />
                            ) : (
                              <span className="text-xl sm:text-2xl font-black text-[#16A085]">
                                {shop.name.charAt(0)}
                              </span>
                            )}
                          </div>

                          {/* Shop text info */}
                          <div className="flex-grow min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/shops/${shop.id}`}
                                className="font-bold text-gray-800 text-base sm:text-lg hover:text-[#16A085] transition truncate"
                              >
                                {shop.name}
                              </Link>
                              <i className="fa-solid fa-circle-check text-xs text-[#16A085]" title="ร้านค้าชุมชนที่ได้รับการยืนยัน"></i>
                            </div>

                            {shop.communityName && (
                              <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                <i className="fa-solid fa-location-dot text-[#16A085] text-[11px]"></i>
                                <span className="truncate">{shop.communityName}</span>
                                {shop.province && (
                                  <span className="text-gray-400">({shop.province})</span>
                                )}
                              </div>
                            )}

                            {/* Ratings & Products */}
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                              <span className="flex items-center gap-1 text-amber-500 font-bold">
                                <i className="fa-solid fa-star"></i>
                                {shop.averageRating ? shop.averageRating.toFixed(1) : "ใหม่"}
                                {shop.reviewCount > 0 && (
                                  <span className="text-gray-400 font-normal">({shop.reviewCount})</span>
                                )}
                              </span>
                              <span className="text-gray-300">•</span>
                              <span className="text-gray-500">
                                <i className="fa-solid fa-box text-gray-400 mr-1"></i>
                                {shop.productCount} รายการ
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Bio / Description */}
                        {shop.description && (
                          <p className="text-xs text-gray-500 line-clamp-2 mb-4 bg-gray-50/70 p-2.5 rounded-xl border border-gray-100">
                            {shop.description}
                          </p>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 mt-2">
                        <Link
                          href={`/shops/${shop.id}`}
                          className="flex-1 py-2 px-3 rounded-xl bg-[#16A085] hover:bg-[#12876f] text-white text-xs font-bold text-center transition shadow-2xs hover:shadow active:scale-95"
                        >
                          <i className="fa-solid fa-store mr-1.5"></i> ไปที่ร้านค้า
                        </Link>

                        <Link
                          href={`/chat?shopId=${shop.id}`}
                          className="py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#16A085] text-xs font-bold transition border border-emerald-200/60 active:scale-95"
                          title="แชทกับร้านค้า"
                        >
                          <i className="fa-solid fa-comments"></i>
                        </Link>

                        <button
                          type="button"
                          onClick={() => handleUnfollow(shop)}
                          disabled={unfollowingId === shop.id}
                          className="py-2 px-3 rounded-xl bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-500 text-xs font-semibold transition border border-gray-200 hover:border-red-200 cursor-pointer disabled:opacity-50"
                          title="เลิกติดตามร้านนี้"
                        >
                          {unfollowingId === shop.id ? (
                            <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                          ) : (
                            <i className="fa-solid fa-user-minus text-xs"></i>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
      <MobileNav />
    </div>
  );
}
