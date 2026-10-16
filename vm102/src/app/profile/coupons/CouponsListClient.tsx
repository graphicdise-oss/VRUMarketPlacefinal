"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Breadcrumb from "@/components/ui/Breadcrumb";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import { couponApi, CouponDto, UserCouponClaimDto } from "@/lib/api";

type ClaimTab = "AVAILABLE" | "USED" | "EXPIRED" | "ALL";

interface NormalizedClaim {
  id: string;
  couponId: string;
  coupon: CouponDto;
  claimedAt: string;
  isUsed: boolean;
  usedAt: string | null;
  orderId: string | null;
  status: "AVAILABLE" | "USED" | "EXPIRED";
}

export default function CouponsListClient() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { showToast } = useToast();

  const [claims, setClaims] = useState<NormalizedClaim[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ClaimTab>("AVAILABLE");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  // Protect route
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/profile/coupons");
    }
  }, [user, isAuthLoading, router]);

  // Load claims
  const loadMyClaims = useCallback(async () => {
    setIsLoading(true);
    try {
      const claimsRes = await couponApi.getMyClaims().catch(() => [] as UserCouponClaimDto[]);
      const loadedClaims: NormalizedClaim[] = [];
      const seenCouponIds = new Set<string>();

      // 1. Process server claims
      if (Array.isArray(claimsRes)) {
        claimsRes.forEach((c) => {
          if (!c.coupon) return;
          seenCouponIds.add(c.couponId);
          const isExpired = new Date(c.coupon.endDate).getTime() <= now;
          let status: "AVAILABLE" | "USED" | "EXPIRED" = "AVAILABLE";
          if (c.isUsed) {
            status = "USED";
          } else if (isExpired) {
            status = "EXPIRED";
          }

          loadedClaims.push({
            id: c.id,
            couponId: c.couponId,
            coupon: c.coupon,
            claimedAt: c.claimedAt || new Date().toISOString(),
            isUsed: c.isUsed,
            usedAt: c.usedAt,
            orderId: c.orderId,
            status,
          });
        });
      }

      setClaims(loadedClaims);
    } catch (err) {
      console.error("Failed to load user coupons:", err);
      showToast("ไม่สามารถโหลดโค้ดส่วนลดได้ในขณะนี้", "error");
    } finally {
      setIsLoading(false);
    }
  }, [now, showToast]);

  useEffect(() => {
    if (user) {
      loadMyClaims();
    }
  }, [user, loadMyClaims]);

  // Copy code helper
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showToast(`คัดลอกโค้ด "${code}" แล้ว`, "success");
    setTimeout(() => {
      setCopiedCode((curr) => (curr === code ? null : curr));
    }, 2000);
  };

  // Counts
  const counts = useMemo(() => {
    const available = claims.filter((c) => c.status === "AVAILABLE").length;
    const used = claims.filter((c) => c.status === "USED").length;
    const expired = claims.filter((c) => c.status === "EXPIRED").length;
    const all = claims.length;
    return { available, used, expired, all };
  }, [claims]);

  // Filtered claims
  const filteredClaims = useMemo(() => {
    let result = claims;

    // Filter by Tab
    if (activeTab === "AVAILABLE") {
      result = result.filter((c) => c.status === "AVAILABLE");
    } else if (activeTab === "USED") {
      result = result.filter((c) => c.status === "USED");
    } else if (activeTab === "EXPIRED") {
      result = result.filter((c) => c.status === "EXPIRED");
    }

    // Filter by Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.coupon.code.toLowerCase().includes(q) ||
          c.coupon.name.toLowerCase().includes(q) ||
          (c.coupon.shopName && c.coupon.shopName.toLowerCase().includes(q))
      );
    }

    // Sort: Available first, then by earliest expiry
    return result.sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "AVAILABLE") return -1;
        if (b.status === "AVAILABLE") return 1;
      }
      return new Date(a.coupon.endDate).getTime() - new Date(b.coupon.endDate).getTime();
    });
  }, [claims, activeTab, searchQuery]);

  return (
    <div className="min-h-screen bg-gray-50/60 flex flex-col">
      <Header />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 pt-4 pb-12 flex flex-col md:flex-row gap-8">
        {/* Profile Sidebar */}
        <ProfileSidebar name={user?.displayName || ""} avatarUrl={user?.avatarUrl || null} />

        {/* Content Area */}
        <div className="flex-grow min-w-0">
          <Breadcrumb
            items={[
              { label: "โปรไฟล์", href: "/profile" },
              { label: "โค้ดส่วนลดที่เราเก็บ" },
            ]}
          />

          <div className="bg-white rounded-3xl p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100 mt-6">
            {/* Top Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 bg-emerald-50 text-[#16A085] rounded-2xl flex items-center justify-center text-xl shadow-xs border border-emerald-100/60">
                  <i className="fa-solid fa-ticket"></i>
                </div>
                <div>
                  <h1 className="text-2xl font-black text-gray-800">โค้ดส่วนลดที่เราเก็บ</h1>
                  <p className="text-xs text-gray-500 mt-0.5">
                    รวมโค้ดและคูปองที่คุณกดเก็บไว้ พร้อมใช้เป็นส่วนลดในการสั่งซื้อ
                  </p>
                </div>
              </div>

              <Link
                href="/coupons"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#16A085] text-white hover:bg-[#12876f] transition text-xs font-bold shadow-xs flex-shrink-0"
              >
                <i className="fa-solid fa-compass text-xs"></i>
                <span>ไปเก็บโค้ดเพิ่ม</span>
              </Link>
            </div>

            {/* Filter Tabs & Search */}
            <div className="mt-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Status Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
                <button
                  type="button"
                  onClick={() => setActiveTab("AVAILABLE")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                    activeTab === "AVAILABLE"
                      ? "bg-[#16A085] text-white shadow-xs"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <i className="fa-solid fa-circle-check text-[11px]"></i>
                  <span>พร้อมใช้งาน</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeTab === "AVAILABLE" ? "bg-white/20 text-white" : "bg-white text-gray-700 shadow-2xs"
                    }`}
                  >
                    {counts.available}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("USED")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                    activeTab === "USED"
                      ? "bg-[#16A085] text-white shadow-xs"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <i className="fa-solid fa-receipt text-[11px]"></i>
                  <span>ใช้แล้ว</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeTab === "USED" ? "bg-white/20 text-white" : "bg-white text-gray-700 shadow-2xs"
                    }`}
                  >
                    {counts.used}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("EXPIRED")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                    activeTab === "EXPIRED"
                      ? "bg-[#16A085] text-white shadow-xs"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <i className="fa-solid fa-clock-rotate-left text-[11px]"></i>
                  <span>หมดอายุ</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeTab === "EXPIRED" ? "bg-white/20 text-white" : "bg-white text-gray-700 shadow-2xs"
                    }`}
                  >
                    {counts.expired}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("ALL")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 flex-shrink-0 cursor-pointer ${
                    activeTab === "ALL"
                      ? "bg-[#16A085] text-white shadow-xs"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <span>ทั้งหมด</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      activeTab === "ALL" ? "bg-white/20 text-white" : "bg-white text-gray-700 shadow-2xs"
                    }`}
                  >
                    {counts.all}
                  </span>
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative w-full lg:w-72">
                <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาโค้ดส่วนลดหรือชื่อร้าน..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                )}
              </div>
            </div>

            {/* Coupons Content */}
            <div className="mt-6">
              {isLoading ? (
                <div className="py-20 flex flex-col justify-center items-center gap-3">
                  <div className="w-10 h-10 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-gray-400 font-medium">กำลังโหลดโค้ดส่วนลดของคุณ...</p>
                </div>
              ) : claims.length === 0 ? (
                /* Empty state when user has never claimed any coupon */
                <div className="text-center py-16 px-4 bg-gray-50/80 rounded-3xl border-2 border-dashed border-gray-200 my-4">
                  <div className="w-20 h-20 bg-emerald-50 text-[#16A085] rounded-3xl flex items-center justify-center mx-auto mb-4 text-3xl shadow-xs">
                    <i className="fa-solid fa-ticket-simple"></i>
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 mb-1">ยังไม่มีโค้ดส่วนลดที่คุณเก็บไว้</h3>
                  <p className="text-xs text-gray-500 mb-6 max-w-md mx-auto leading-relaxed">
                    คุณยังไม่ได้เก็บโค้ดส่วนลดใดๆ สามารถเข้าไปเลือกเก็บโค้ดสุดคุ้มจากร้านค้าชุมชน เพื่อนำมาใช้ลดราคาสินค้าได้ทันที
                  </p>
                  <Link
                    href="/coupons"
                    className="inline-flex items-center justify-center gap-2 bg-[#16A085] hover:bg-[#12876f] text-white px-6 py-3 rounded-2xl text-xs font-bold transition shadow-sm hover:shadow"
                  >
                    <i className="fa-solid fa-compass"></i>
                    <span>ไปเลือกเก็บโค้ดส่วนลดเลย</span>
                  </Link>
                </div>
              ) : filteredClaims.length === 0 ? (
                /* Empty state for the specific tab/search */
                <div className="text-center py-12 px-4 bg-gray-50/60 rounded-2xl border border-gray-100 my-4">
                  <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-3 text-lg">
                    <i className="fa-solid fa-inbox"></i>
                  </div>
                  <h4 className="text-sm font-bold text-gray-700 mb-1">
                    {searchQuery ? `ไม่พบโค้ดที่ตรงกับ "${searchQuery}"` : "ไม่มีโค้ดส่วนลดในหมวดหมู่นี้"}
                  </h4>
                  <p className="text-xs text-gray-400 mb-4">
                    {searchQuery ? "ลองเปลี่ยนคำค้นหาใหม่ดูนะ" : "ลองสลับไปดูแท็บอื่นหรือไปเก็บโค้ดเพิ่มได้เลย"}
                  </p>
                  {searchQuery ? (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      ล้างคำค้นหา
                    </button>
                  ) : (
                    <button
                      onClick={() => setActiveTab("ALL")}
                      className="px-4 py-2 bg-[#16A085] hover:bg-[#12876f] text-white rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      ดูทั้งหมด ({counts.all})
                    </button>
                  )}
                </div>
              ) : (
                /* Grid of Claimed Coupons */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredClaims.map((claim) => {
                    const c = claim.coupon;
                    const isAvailable = claim.status === "AVAILABLE";
                    const isUsed = claim.status === "USED";
                    const isExpired = claim.status === "EXPIRED";
                    const isPercent = c.discountType === "PERCENTAGE";

                    const minSpendText =
                      c.minSpendAmountMinor > 0
                        ? `ขั้นต่ำ ฿${(c.minSpendAmountMinor / 100).toLocaleString()}`
                        : "ไม่มีขั้นต่ำ";

                    const expiryDate = new Date(c.endDate);
                    const daysLeft = Math.ceil((expiryDate.getTime() - now) / (1000 * 60 * 60 * 24));

                    return (
                      <div
                        key={claim.id}
                        className={`relative rounded-3xl border transition-all duration-200 overflow-hidden flex flex-col justify-between ${
                          isAvailable
                            ? "bg-white border-gray-100 shadow-[0_4px_16px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-emerald-200"
                            : "bg-gray-50/70 border-gray-200/80 opacity-75"
                        }`}
                      >
                        {/* Status Ribbon if Used / Expired */}
                        <div className="p-5 pb-4">
                          <div className="flex items-start justify-between gap-3 mb-2.5">
                            {/* Shop Link */}
                            {c.shopName ? (
                              <Link
                                href={`/shops/${c.shopId}`}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-[#16A085] transition line-clamp-1"
                              >
                                <i className="fa-solid fa-store text-[11px] text-[#16A085]"></i>
                                <span>{c.shopName}</span>
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                                <i className="fa-solid fa-ticket text-[11px]"></i>
                                <span>คูปองส่วนลดทั้งระบบ</span>
                              </span>
                            )}

                            {/* Status Badge */}
                            {isAvailable ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-[#16A085] border border-emerald-100 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#16A085]"></span>
                                พร้อมใช้งาน
                              </span>
                            ) : isUsed ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600 flex items-center gap-1">
                                <i className="fa-solid fa-check text-[9px]"></i>
                                ใช้แล้ว
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 flex items-center gap-1">
                                <i className="fa-solid fa-clock text-[9px]"></i>
                                หมดอายุ
                              </span>
                            )}
                          </div>

                          {/* Discount & Name */}
                          <div className="flex items-start gap-4">
                            <div
                              className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center p-2 text-center flex-shrink-0 ${
                                isAvailable
                                  ? isPercent
                                    ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xs"
                                    : "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-xs"
                                  : "bg-gray-200 text-gray-500"
                              }`}
                            >
                              <span className="text-[10px] font-bold tracking-tight opacity-90 uppercase">ลด</span>
                              <span className="text-xl font-black leading-tight">
                                {isPercent ? `${c.discountValue}%` : `฿${(c.discountValue / 100).toLocaleString()}`}
                              </span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3
                                className={`text-sm font-bold line-clamp-2 ${
                                  isAvailable ? "text-gray-900" : "text-gray-500"
                                }`}
                              >
                                {c.name}
                              </h3>
                              <p className="text-xs text-gray-500 mt-1 font-medium">{minSpendText}</p>
                              {c.maxDiscountAmountMinor && isPercent && (
                                <p className="text-[11px] text-gray-400">
                                  ลดสูงสุด ฿{(c.maxDiscountAmountMinor / 100).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Code Display & Copy Box */}
                          <div className="mt-4 flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                            <div className="flex items-center gap-2 pl-1.5 min-w-0">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                โค้ด:
                              </span>
                              <code
                                className={`text-xs font-black tracking-wider truncate ${
                                  isAvailable ? "text-gray-900" : "text-gray-500"
                                }`}
                              >
                                {c.code}
                              </code>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopyCode(c.code)}
                              className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer ${
                                copiedCode === c.code
                                  ? "bg-emerald-600 text-white shadow-2xs"
                                  : "bg-white hover:bg-emerald-50 text-gray-700 hover:text-[#16A085] border border-gray-200 shadow-2xs"
                              }`}
                            >
                              <i
                                className={`fa-solid ${
                                  copiedCode === c.code ? "fa-check" : "fa-copy"
                                } text-[11px]`}
                              ></i>
                              <span>{copiedCode === c.code ? "คัดลอกแล้ว" : "คัดลอก"}</span>
                            </button>
                          </div>
                        </div>

                        {/* Bottom Action Footer */}
                        <div
                          className={`px-5 py-3 border-t flex items-center justify-between gap-3 text-xs ${
                            isAvailable ? "bg-slate-50/50 border-gray-100" : "bg-gray-100/60 border-gray-200"
                          }`}
                        >
                          {/* Expiry text */}
                          <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
                            <i className="fa-regular fa-clock text-gray-400"></i>
                            {isAvailable ? (
                              daysLeft <= 3 ? (
                                <span className="text-amber-600 font-bold">
                                  เหลืออีก {daysLeft} วัน (ถึง {new Date(c.endDate).toLocaleDateString("th-TH")})
                                </span>
                              ) : (
                                <span>ใช้ได้ถึง {new Date(c.endDate).toLocaleDateString("th-TH")}</span>
                              )
                            ) : isUsed ? (
                              <span>ใช้แล้วเมื่อ {new Date(claim.usedAt || claim.claimedAt).toLocaleDateString("th-TH")}</span>
                            ) : (
                              <span className="text-red-500">หมดอายุแล้ว</span>
                            )}
                          </div>

                          {/* CTA Button */}
                          {isAvailable ? (
                            <Link
                              href={c.shopId ? `/shops/${c.shopId}` : "/products"}
                              className="px-4 py-1.5 rounded-xl bg-[#16A085] hover:bg-[#12876f] text-white text-xs font-bold transition shadow-2xs flex items-center gap-1.5"
                            >
                              <span>ใช้โค้ดเลย</span>
                              <i className="fa-solid fa-arrow-right text-[10px]"></i>
                            </Link>
                          ) : (
                            <span className="px-3 py-1 rounded-xl bg-gray-200 text-gray-400 text-xs font-bold">
                              {isUsed ? "ใช้โค้ดแล้ว" : "หมดอายุ"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
