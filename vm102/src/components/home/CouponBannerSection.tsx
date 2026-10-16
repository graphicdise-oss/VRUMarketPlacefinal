"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { couponApi, CouponDto } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";

type FilterType = "ALL" | "FIXED" | "PERCENT" | "NO_MIN";

export default function CouponBannerSection() {
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();

  const [coupons, setCoupons] = useState<CouponDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>("ALL");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedMap, setClaimedMap] = useState<Record<string, boolean>>({});

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load claimed coupons from localStorage as quick cache
  useEffect(() => {
    try {
      const stored = localStorage.getItem("vru_user_claimed_coupons");
      if (stored) {
        setClaimedMap(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch real coupons from backend API
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    couponApi
      .getFeaturedCoupons()
      .then((data) => {
        if (!isMounted) return;
        if (data && data.length > 0) {
          setCoupons(data);
          // Sync server claims
          const newMap: Record<string, boolean> = {};
          data.forEach((c) => {
            if (c.isClaimed) newMap[c.id] = true;
          });
          setClaimedMap((prev) => ({ ...prev, ...newMap }));
        } else {
          setCoupons([]);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setCoupons([]);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filter coupons based on selected pill
  const filteredCoupons = useMemo(() => {
    return coupons.filter((coupon) => {
      if (activeFilter === "FIXED") return coupon.discountType === "FIXED_AMOUNT";
      if (activeFilter === "PERCENT") return coupon.discountType === "PERCENTAGE";
      if (activeFilter === "NO_MIN") return coupon.minSpendAmountMinor === 0;
      return true;
    });
  }, [coupons, activeFilter]);

  // Handle claim button click
  const handleClaim = async (coupon: CouponDto) => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบก่อนเก็บคูปองส่วนลด", "info");
      return;
    }

    if (claimedMap[coupon.id]) {
      showToast("คุณเก็บคูปองนี้ไปแล้ว นำไปใช้เป็นส่วนลดได้เลยค่ะ", "info");
      return;
    }

    if (coupon.remainingQuota <= 0) {
      showToast("ขออภัย สิทธิ์คูปองนี้ถูกเก็บครบจำนวนแล้ว", "error");
      return;
    }

    setClaimingId(coupon.id);
    try {
      await couponApi.claimCoupon(coupon.id);
      const nextMap = { ...claimedMap, [coupon.id]: true };
      setClaimedMap(nextMap);
      localStorage.setItem("vru_user_claimed_coupons", JSON.stringify(nextMap));

      // Locally increment claimed count and decrement remaining
      setCoupons((prev) =>
        prev.map((c) =>
          c.id === coupon.id
            ? {
                ...c,
                isClaimed: true,
                claimedCount: c.claimedCount + 1,
                remainingQuota: Math.max(0, c.remainingQuota - 1),
              }
            : c
        )
      );

      showToast(`เก็บโค้ด "${coupon.code}" สำเร็จแล้ว!`, "success");
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการเก็บคูปอง";
      if (errorMessage.includes("เก็บคูปอง") || errorMessage.includes("ไปแล้ว")) {
        const nextMap = { ...claimedMap, [coupon.id]: true };
        setClaimedMap(nextMap);
        localStorage.setItem("vru_user_claimed_coupons", JSON.stringify(nextMap));
        showToast("คุณเก็บคูปองนี้ไปแล้ว นำไปใช้ในขั้นตอนสั่งซื้อได้เลยค่ะ", "info");
      } else {
        showToast(errorMessage, "error");
      }
    } finally {
      setClaimingId(null);
    }
  };

  // Horizontal scroll controls
  const scroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const { current } = scrollContainerRef;
    const scrollAmount = current.clientWidth * 0.75;
    current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  const formatEndDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      });
    } catch {
      return "เร็วๆ นี้";
    }
  };

  return (
    <section className="relative mt-10 md:mt-14 z-20">
      <div className="bg-gradient-to-br from-white/95 via-emerald-50/30 to-teal-50/40 backdrop-blur-xl p-5 sm:p-7 md:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-emerald-100/70 relative overflow-hidden">
        {/* Subtle Decorative Background Glow */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-gradient-to-br from-emerald-200/20 to-teal-300/10 rounded-full blur-3xl pointer-events-none -z-10"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-72 h-72 bg-gradient-to-tr from-amber-200/20 to-emerald-200/10 rounded-full blur-3xl pointer-events-none -z-10"></div>

        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100/70 text-[#16A085] text-xs font-black tracking-wide uppercase mb-2 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#16A085] animate-ping"></span>
              <i className="fa-solid fa-ticket text-xs"></i>
              <span>โค้ดส่วนลดชุมชน มรว.</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
              เก็บคูปองส่วนลดพิเศษ ช้อปคุ้มทุกร้านค้า
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 font-medium mt-1">
              กดเก็บโค้ดส่วนลดร้านค้า เพื่อนำไปใช้ลดทันทีก่อนยืนยันชำระเงิน
            </p>
          </div>

          {/* Carousel Navigation Buttons & View More */}
          <div className="flex items-center gap-2.5 self-end sm:self-auto">
            <Link
              href="/coupons"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-xs font-bold text-[#16A085] border border-emerald-200/90 shadow-2xs hover:border-[#16A085] hover:shadow-xs transition-all group active:scale-95 cursor-pointer"
            >
              <i className="fa-solid fa-ticket text-xs text-[#16A085]"></i>
              <span>แสดงเพิ่มเติม</span>
              <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-0.5 transition-transform text-[#16A085]"></i>
            </Link>

            {coupons.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => scroll("left")}
                  aria-label="เลื่อนซ้าย"
                  className="w-9 h-9 rounded-full bg-white border border-gray-200/80 shadow-xs flex items-center justify-center text-gray-600 hover:text-[#16A085] hover:border-[#16A085]/40 hover:bg-emerald-50/50 transition active:scale-95 cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <button
                  onClick={() => scroll("right")}
                  aria-label="เลื่อนขวา"
                  className="w-9 h-9 rounded-full bg-white border border-gray-200/80 shadow-xs flex items-center justify-center text-gray-600 hover:text-[#16A085] hover:border-[#16A085]/40 hover:bg-emerald-50/50 transition active:scale-95 cursor-pointer"
                >
                  <i className="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter Pills - Shown only when there are coupons */}
        {coupons.length > 0 && (
          <div
            className="w-full max-w-full flex items-center gap-2 overflow-x-auto pb-2 mb-5 scroll-smooth hide-scrollbar touch-pan-x overscroll-x-contain select-none"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <button
              onClick={(e) => {
                setActiveFilter("ALL");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${
                activeFilter === "ALL"
                  ? "bg-[#16A085] text-white shadow-xs"
                  : "bg-white/80 text-gray-600 hover:bg-white border border-gray-200/80"
              }`}
            >
              <span>ทั้งหมด</span>
              <span className="text-[11px] opacity-80">({coupons.length})</span>
            </button>
            <button
              onClick={(e) => {
                setActiveFilter("PERCENT");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${
                activeFilter === "PERCENT"
                  ? "bg-[#16A085] text-white shadow-xs"
                  : "bg-white/80 text-gray-600 hover:bg-white border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-percent text-[10px]"></i>
              <span>ลดเป็นเปอร์เซ็นต์ (%)</span>
            </button>
            <button
              onClick={(e) => {
                setActiveFilter("FIXED");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${
                activeFilter === "FIXED"
                  ? "bg-[#16A085] text-white shadow-xs"
                  : "bg-white/80 text-gray-600 hover:bg-white border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-baht-sign text-[10px]"></i>
              <span>ลดเป็นบาท (฿)</span>
            </button>
            <button
              onClick={(e) => {
                setActiveFilter("NO_MIN");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${
                activeFilter === "NO_MIN"
                  ? "bg-[#16A085] text-white shadow-xs"
                  : "bg-white/80 text-gray-600 hover:bg-white border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-gift text-[10px]"></i>
              <span>ไม่มีขั้นต่ำ</span>
            </button>
          </div>
        )}

        {/* Content Area */}
        {isLoading ? (
          // Skeleton Placeholders
          <div className="flex gap-4 sm:gap-5 overflow-x-auto pb-4 pt-1 px-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="min-w-[280px] sm:min-w-[340px] md:min-w-[360px] h-36 bg-white/60 rounded-2xl border border-gray-200/60 p-4 animate-pulse flex-shrink-0"
              >
                <div className="flex gap-4 h-full">
                  <div className="w-24 bg-gray-200 rounded-xl"></div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div className="w-3/4 h-4 bg-gray-200 rounded"></div>
                    <div className="w-1/2 h-3 bg-gray-200 rounded"></div>
                    <div className="w-full h-8 bg-gray-200 rounded-lg"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : coupons.length === 0 ? (
          // Empty State - Consistent with ArticleSection design
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center z-10 relative bg-white/60 rounded-3xl border border-dashed border-emerald-200/80 shadow-xs">
            <div className="w-20 h-20 bg-white shadow-sm rounded-full flex items-center justify-center mb-5 text-[#16A085]">
              <i className="fa-solid fa-ticket text-3xl"></i>
            </div>
            <h3 className="text-xl font-black text-gray-800 mb-2">ยังไม่มีโค้ดส่วนลดในขณะนี้</h3>
            <p className="text-gray-500 text-sm max-w-sm font-medium">
              คูปองและโค้ดส่วนลดพิเศษจากร้านค้าชุมชน จะถูกนำมาแสดงที่นี่ในเร็วๆ นี้
            </p>
          </div>
        ) : filteredCoupons.length === 0 ? (
          // Category filter returned empty
          <div className="w-full text-center py-12 bg-white/50 rounded-2xl border border-dashed border-gray-200">
            <i className="fa-solid fa-ticket text-3xl text-gray-300 mb-2"></i>
            <p className="text-sm font-bold text-gray-500">ไม่พบคูปองในหมวดหมู่นี้</p>
          </div>
        ) : (
          /* Horizontal Vouchers Track */
          <div
            ref={scrollContainerRef}
            className="flex gap-4 sm:gap-5 overflow-x-auto pb-4 pt-1 px-1 scroll-smooth scrollbar-none snap-x snap-mandatory"
          >
            {filteredCoupons.map((coupon, idx) => {
              const isClaimed = !!claimedMap[coupon.id];
              const isQuotaFull = coupon.remainingQuota <= 0;
              const isClaiming = claimingId === coupon.id;
              const isPercent = coupon.discountType === "PERCENTAGE";

              const minSpendText =
                coupon.minSpendAmountMinor > 0
                  ? `ขั้นต่ำ ฿${(coupon.minSpendAmountMinor / 100).toLocaleString()}`
                  : "ไม่มีขั้นต่ำ";

              const claimPercent = Math.min(
                100,
                Math.round((coupon.claimedCount / (coupon.quota || 1)) * 100)
              );

              return (
                <motion.div
                  key={coupon.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.3 }}
                  className="min-w-[300px] sm:min-w-[350px] md:min-w-[370px] max-w-[400px] flex-shrink-0 snap-start"
                >
                  {/* Voucher Ticket Card */}
                  <div className="relative bg-white rounded-2xl border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group flex overflow-hidden h-full">
                    {/* Left Stub: Discount Value & Brand Theme */}
                    <div
                      className={`w-28 sm:w-32 flex-shrink-0 p-3 sm:p-4 flex flex-col justify-between items-center text-center relative overflow-hidden ${
                        isPercent
                          ? "bg-gradient-to-br from-[#16A085] to-[#0e6f5c] text-white"
                          : "bg-gradient-to-br from-amber-500 to-orange-600 text-white"
                      }`}
                    >
                      {/* Subtle watermark circle */}
                      <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-white/10 pointer-events-none"></div>

                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-xs text-[10px] font-black tracking-wider uppercase">
                        <i className="fa-solid fa-tag text-[9px]"></i>
                        <span>{coupon.code}</span>
                      </div>

                      <div className="my-auto py-2">
                        <div className="text-2xl sm:text-3xl font-black leading-none drop-shadow-xs">
                          {isPercent ? `${coupon.discountValue}%` : `฿${coupon.discountValue / 100}`}
                        </div>
                        <div className="text-[11px] font-bold text-white/90 mt-1">ส่วนลด</div>
                      </div>

                      <div className="text-[10px] font-medium text-white/80 leading-tight">
                        {minSpendText}
                      </div>

                      {/* Notches for authentic ticket perforation */}
                      <div className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-gray-50/80 border border-emerald-100/70 z-10"></div>
                      <div className="absolute -bottom-2.5 -right-2.5 w-5 h-5 rounded-full bg-gray-50/80 border border-emerald-100/70 z-10"></div>
                    </div>

                    {/* Dashed Cut Line Divider */}
                    <div className="w-[1px] border-r-2 border-dashed border-gray-200/80 my-2 z-10 relative"></div>

                    {/* Right Section: Details & Action */}
                    <div className="flex-1 p-3.5 sm:p-4 flex flex-col justify-between bg-white min-w-0">
                      <div>
                        {/* Shop Header Link */}
                        <div className="flex items-center gap-1.5 text-gray-500 text-[11px] font-bold mb-1 truncate">
                          <i className="fa-solid fa-store text-[10px] text-[#16A085]"></i>
                          {coupon.shopId ? (
                            <Link
                              href={`/shops/${coupon.shopId}`}
                              className="truncate hover:text-[#16A085] transition-colors"
                              title={coupon.shopName || "ร้านค้าชุมชน"}
                            >
                              {coupon.shopName || "ร้านค้าชุมชน"}
                            </Link>
                          ) : (
                            <span className="truncate">{coupon.shopName || "ร้านค้าชุมชน"}</span>
                          )}
                        </div>

                        {/* Coupon Name / Description */}
                        <h4
                          className="font-bold text-gray-900 text-xs sm:text-sm line-clamp-2 leading-snug group-hover:text-[#16A085] transition-colors"
                          title={coupon.name}
                        >
                          {coupon.name}
                        </h4>
                      </div>

                      {/* Quota Progress & Claim Action */}
                      <div className="mt-3 pt-2 border-t border-gray-100/80">
                        {/* Quota Bar */}
                        <div className="mb-2.5">
                          <div className="flex justify-between items-center text-[10px] text-gray-400 font-bold mb-1">
                            <span>
                              {isQuotaFull ? (
                                <span className="text-rose-500 font-semibold">สิทธิ์เต็มแล้ว</span>
                              ) : (
                                <span>เก็บแล้ว {claimPercent}%</span>
                              )}
                            </span>
                            <span className="flex items-center gap-1 text-gray-400">
                              <i className="fa-regular fa-clock text-[9px]"></i>
                              {formatEndDate(coupon.endDate)}
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isPercent ? "bg-[#16A085]" : "bg-amber-500"
                              }`}
                              style={{ width: `${claimPercent}%` }}
                            ></div>
                          </div>
                        </div>

                        {/* Claim Button */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-gray-400 font-medium truncate">
                            {coupon.maxDiscountAmountMinor
                              ? `ลดสูงสุด ฿${(coupon.maxDiscountAmountMinor / 100).toLocaleString()}`
                              : "ใช้ได้ทันที"}
                          </span>

                          {isClaimed ? (
                            <button
                              disabled
                              className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-[#16A085] border border-emerald-200/80 text-xs font-black flex items-center gap-1 shadow-2xs cursor-default flex-shrink-0"
                            >
                              <i className="fa-solid fa-circle-check text-xs"></i>
                              <span>เก็บแล้ว</span>
                            </button>
                          ) : isQuotaFull ? (
                            <button
                              disabled
                              className="px-3.5 py-1.5 rounded-xl bg-gray-100 text-gray-400 text-xs font-bold cursor-not-allowed flex-shrink-0"
                            >
                              <span>สิทธิ์เต็ม</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleClaim(coupon)}
                              disabled={isClaiming}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-black text-white shadow-xs hover:shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 flex-shrink-0 ${
                                isPercent
                                  ? "bg-[#16A085] hover:bg-[#12876f]"
                                  : "bg-amber-500 hover:bg-amber-600"
                              }`}
                            >
                              {isClaiming ? (
                                <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                              ) : (
                                <i className="fa-solid fa-plus text-[10px]"></i>
                              )}
                              <span>เก็บโค้ด</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* View All End Card */}
            {filteredCoupons.length > 0 && (
              <Link
                href="/coupons"
                className="flex-shrink-0 w-64 md:w-72 bg-gradient-to-br from-white via-emerald-50/50 to-teal-50/60 rounded-2xl border-2 border-dashed border-emerald-200/90 hover:border-[#16A085] shadow-xs hover:shadow-md transition-all flex flex-col items-center justify-center p-6 text-center group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-100/70 text-[#16A085] flex items-center justify-center text-2xl mb-3 group-hover:scale-110 group-hover:bg-[#16A085] group-hover:text-white transition-all shadow-xs">
                  <i className="fa-solid fa-ticket-simple"></i>
                </div>
                <h4 className="font-black text-gray-900 group-hover:text-[#16A085] transition-colors text-base mb-1">
                  ดูโค้ดส่วนลดทั้งหมด
                </h4>
                <p className="text-xs text-gray-500 mb-3">
                  ยังมีโค้ดคุ้มๆ จากร้านค้าชุมชนอีกเพียบ
                </p>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#16A085] group-hover:underline">
                  <span>เข้าสู่ศูนย์รวมโค้ด</span>
                  <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-1 transition-transform"></i>
                </span>
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
