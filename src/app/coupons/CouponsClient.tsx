"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { couponApi, CouponDto } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";



type FilterTab = "ALL" | "PERCENT" | "FIXED" | "NO_MIN" | "CLAIMED";
type SortOption = "RECOMMENDED" | "DISCOUNT_DESC" | "EXPIRING_SOON" | "POPULAR";

export default function CouponsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();

  const [coupons, setCoupons] = useState<CouponDto[]>([]);
  const [claimedMap, setClaimedMap] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Read tab parameter from URL query string
  const tabParam = searchParams.get("tab");
  const initialTab: FilterTab = useMemo(() => {
    if (!tabParam) return "ALL";
    const norm = tabParam.toUpperCase();
    if (norm === "CLAIMED" || norm === "MY" || norm === "COLLECTED") return "CLAIMED";
    if (norm === "PERCENT") return "PERCENT";
    if (norm === "FIXED") return "FIXED";
    if (norm === "NO_MIN") return "NO_MIN";
    return "ALL";
  }, [tabParam]);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>(initialTab);
  const [sortBy, setSortBy] = useState<SortOption>("RECOMMENDED");
  const [now] = useState(() => Date.now());

  // Keep activeTab in sync if URL query parameter changes
  useEffect(() => {
    if (tabParam) {
      const norm = tabParam.toUpperCase();
      if (norm === "CLAIMED" || norm === "MY" || norm === "COLLECTED") {
        setActiveTab("CLAIMED");
      } else if (norm === "PERCENT") {
        setActiveTab("PERCENT");
      } else if (norm === "FIXED") {
        setActiveTab("FIXED");
      } else if (norm === "NO_MIN") {
        setActiveTab("NO_MIN");
      } else if (norm === "ALL") {
        setActiveTab("ALL");
      }
    }
  }, [tabParam]);

  // Tab horizontal scroll ref & states
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const checkScrollable = useCallback(() => {
    if (!tabsContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabsContainerRef.current;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 6);
  }, []);

  useEffect(() => {
    checkScrollable();
    const el = tabsContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScrollable, { passive: true });
    window.addEventListener("resize", checkScrollable);
    return () => {
      el.removeEventListener("scroll", checkScrollable);
      window.removeEventListener("resize", checkScrollable);
    };
  }, [checkScrollable, coupons]);

  const scrollTabs = (direction: "left" | "right") => {
    if (!tabsContainerRef.current) return;
    const scrollAmount = tabsContainerRef.current.clientWidth * 0.6;
    tabsContainerRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!tabsContainerRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - tabsContainerRef.current.offsetLeft;
    scrollLeftRef.current = tabsContainerRef.current.scrollLeft;
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !tabsContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - tabsContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    tabsContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!tabsContainerRef.current) return;
    if (e.deltaX === 0 && e.deltaY !== 0) {
      tabsContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  // Load Coupons and User Claims
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [featuredRes, claimsRes] = await Promise.allSettled([
          couponApi.getFeaturedCoupons(100),
          isAuthenticated ? couponApi.getMyClaims() : Promise.resolve([]),
        ]);

        let loadedCoupons: CouponDto[] = [];
        if (featuredRes.status === "fulfilled" && Array.isArray(featuredRes.value) && featuredRes.value.length > 0) {
          loadedCoupons = featuredRes.value;
        } else {
          loadedCoupons = [];
        }

        const newClaimedMap: Record<string, boolean> = {};

        // Merge claims from API
        if (claimsRes.status === "fulfilled" && Array.isArray(claimsRes.value)) {
          claimsRes.value.forEach((claim) => {
            if (claim.couponId && !claim.isUsed) {
              newClaimedMap[claim.couponId] = true;
            }
          });
        }

        // Also check if coupons contain isClaimed flag
        loadedCoupons.forEach((c) => {
          if (c.isClaimed) {
            newClaimedMap[c.id] = true;
          }
        });

        if (isMounted) {
          setCoupons(loadedCoupons);
          setClaimedMap(newClaimedMap);
        }
      } catch (err) {
        console.error("Failed to load coupons:", err);
        if (isMounted) {
          setCoupons([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  // Handle Claim Coupon
  const handleClaim = async (coupon: CouponDto) => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบก่อนเก็บโค้ดส่วนลด", "info");
      router.push(`/login?redirect=/coupons`);
      return;
    }

    if (claimedMap[coupon.id]) {
      showToast("คุณเก็บโค้ดนี้ไปแล้ว", "info");
      return;
    }

    setClaimingId(coupon.id);
    try {
      if (!coupon.id.startsWith("fb-coupon-")) {
        await couponApi.claimCoupon(coupon.id);
      }

      setClaimedMap((prev) => ({ ...prev, [coupon.id]: true }));
      setCoupons((prev) =>
        prev.map((c) =>
          c.id === coupon.id
            ? {
                ...c,
                claimedCount: c.claimedCount + 1,
                remainingQuota: Math.max(0, c.remainingQuota - 1),
                isClaimed: true,
              }
            : c
        )
      );

      showToast(`เก็บโค้ด "${coupon.code}" เรียบร้อยแล้ว!`, "success");
    } catch (err: unknown) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage =
        errObj?.response?.data?.message || errObj?.message || "ไม่สามารถเก็บโค้ดได้ในขณะนี้";
      if (errorMessage.includes("ALREADY_CLAIMED") || errorMessage.includes("เก็บคูปองนี้ไปแล้ว")) {
        setClaimedMap((prev) => ({ ...prev, [coupon.id]: true }));
        showToast("คุณเก็บโค้ดนี้ไปแล้ว", "info");
      } else {
        showToast(errorMessage, "error");
      }
    } finally {
      setClaimingId(null);
    }
  };

  // Copy Coupon Code
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showToast(`คัดลอกโค้ด ${code} แล้ว`, "success");
    setTimeout(() => {
      setCopiedCode((curr) => (curr === code ? null : curr));
    }, 2000);
  };

  // Filtered & Sorted Coupons
  const filteredAndSortedCoupons = useMemo(() => {
    let result = [...coupons];

    // Filter by Tab
    if (activeTab === "PERCENT") {
      result = result.filter((c) => c.discountType === "PERCENTAGE");
    } else if (activeTab === "FIXED") {
      result = result.filter((c) => c.discountType === "FIXED_AMOUNT");
    } else if (activeTab === "NO_MIN") {
      result = result.filter((c) => c.minSpendAmountMinor === 0);
    } else if (activeTab === "CLAIMED") {
      result = result.filter((c) => claimedMap[c.id]);
    }

    // Filter by Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.shopName && c.shopName.toLowerCase().includes(q))
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === "DISCOUNT_DESC") {
        const valA = a.discountType === "PERCENTAGE" ? a.discountValue * 100 : a.discountValue;
        const valB = b.discountType === "PERCENTAGE" ? b.discountValue * 100 : b.discountValue;
        return valB - valA;
      }
      if (sortBy === "EXPIRING_SOON") {
        return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      }
      if (sortBy === "POPULAR") {
        return b.claimedCount - a.claimedCount;
      }
      // RECOMMENDED: Active first, unclaimed first, high quota
      const aClaimed = claimedMap[a.id] ? 1 : 0;
      const bClaimed = claimedMap[b.id] ? 1 : 0;
      if (aClaimed !== bClaimed) return aClaimed - bClaimed;
      return b.claimedCount - a.claimedCount;
    });

    return result;
  }, [coupons, activeTab, searchQuery, sortBy, claimedMap]);

  // Compute Stats
  const stats = useMemo(() => {
    const total = coupons.length;
    const percentCount = coupons.filter((c) => c.discountType === "PERCENTAGE").length;
    const fixedCount = coupons.filter((c) => c.discountType === "FIXED_AMOUNT").length;
    const claimedCount = Object.keys(claimedMap).filter((k) => claimedMap[k]).length;
    return { total, percentCount, fixedCount, claimedCount };
  }, [coupons, claimedMap]);

  return (
    <div className="min-h-screen bg-slate-50/60 flex flex-col">
      <Header />
      <div className="flex-grow pb-12 sm:pb-16">
        {/* ======================================================== */}
        {/* HERO BANNER SECTION                                      */}
        {/* ======================================================== */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#16A085] via-teal-700 to-emerald-900 text-white pt-12 pb-16 px-4 sm:px-6 lg:px-8">
        {/* Glow & Decorative Background Circles */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 bg-teal-400/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>

        <div className="max-w-7xl mx-auto relative z-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-white/80 font-medium mb-6">
            <Link href="/" className="hover:text-white transition flex items-center gap-1">
              <i className="fa-solid fa-house text-[11px]"></i>
              <span>หน้าแรก</span>
            </Link>
            <i className="fa-solid fa-chevron-right text-[9px] opacity-60"></i>
            <span className="text-white font-bold">ศูนย์รวมโค้ดส่วนลด</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-black tracking-wide uppercase mb-4 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping"></span>
                <i className="fa-solid fa-ticket text-xs text-emerald-300"></i>
                <span>VRU Marketplace Coupon Center</span>
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
                ศูนย์รวมโค้ดส่วนลด <br className="hidden sm:inline" />
                <span className="bg-gradient-to-r from-emerald-200 via-teal-100 to-white bg-clip-text text-transparent">
                  ช้อปคุ้มทุกร้านค้าชุมชน
                </span>
              </h1>
              <p className="mt-4 text-sm sm:text-base text-white/85 font-normal leading-relaxed">
                เก็บโค้ดส่วนลดจากร้านค้า มรว. เพื่อนำไปใช้ลดราคาสินค้าทันทีในหน้าชำระเงิน ประหยัดยิ่งขึ้นในทุกคำสั่งซื้อของคุณ
              </p>
            </div>

            {/* Quick Stats Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3 sm:gap-4 lg:w-96">
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 text-center">
                <div className="text-2xl sm:text-3xl font-black text-white">{stats.total}</div>
                <div className="text-xs text-white/80 font-medium mt-0.5">โค้ดทั้งหมด</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 text-center">
                <div className="text-2xl sm:text-3xl font-black text-emerald-200">{stats.percentCount}</div>
                <div className="text-xs text-white/80 font-medium mt-0.5">ลดเป็นเปอร์เซ็นต์</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 text-center">
                <div className="text-2xl sm:text-3xl font-black text-amber-200">{stats.fixedCount}</div>
                <div className="text-xs text-white/80 font-medium mt-0.5">ลดคงที่ (บาท)</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 text-center">
                <div className="text-2xl sm:text-3xl font-black text-white">{stats.claimedCount}</div>
                <div className="text-xs text-white/80 font-medium mt-0.5">ที่คุณเก็บแล้ว</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* FILTER & SEARCH TOOLBAR                                  */}
      {/* ======================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-7 relative z-20">
        <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* Live Search Input */}
          <div className="relative flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อโค้ด, รหัสโค้ด, หรือชื่อร้านค้า..."
              className="w-full pl-11 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085] focus:bg-white transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2 self-end md:self-auto flex-shrink-0">
            <span className="text-xs text-gray-400 font-bold hidden sm:inline">จัดเรียง:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#16A085] cursor-pointer"
            >
              <option value="RECOMMENDED">แนะนำสำหรับคุณ</option>
              <option value="DISCOUNT_DESC">ส่วนลดมากที่สุด</option>
              <option value="POPULAR">ยอดนิยม / ถูกเก็บมากสุด</option>
              <option value="EXPIRING_SOON">ใกล้หมดอายุเร็วๆ นี้</option>
            </select>
          </div>
        </div>

        {/* Tab Pills with Smooth Scroll & Arrows */}
        <div className="relative w-full max-w-full my-2.5">
          {/* Left Arrow Button / Gradient Fade (Desktop only) */}
          {canScrollLeft && (
            <div className="hidden sm:flex absolute left-0 top-0 bottom-0 z-10 items-center pr-3 bg-gradient-to-r from-slate-50 via-slate-50/90 to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => scrollTabs("left")}
                className="w-8 h-8 rounded-full bg-white shadow-md border border-gray-200 text-gray-700 flex items-center justify-center hover:bg-emerald-50 hover:text-[#16A085] hover:border-[#16A085]/40 transition active:scale-95 cursor-pointer pointer-events-auto"
                aria-label="เลื่อนซ้าย"
              >
                <i className="fa-solid fa-chevron-left text-[11px]"></i>
              </button>
            </div>
          )}

          <div
            ref={tabsContainerRef}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeave}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            className="w-full max-w-full flex items-center gap-2 overflow-x-auto scroll-smooth hide-scrollbar touch-pan-x py-1.5 px-0.5"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <button
              onClick={(e) => {
                setActiveTab("ALL");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 flex-shrink-0 cursor-pointer shadow-2xs ${
                activeTab === "ALL"
                  ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                  : "bg-white text-gray-600 hover:bg-emerald-50/50 border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-border-all text-[11px]"></i>
              <span>ทั้งหมด</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === "ALL" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                {coupons.length}
              </span>
            </button>

            <button
              onClick={(e) => {
                setActiveTab("PERCENT");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 flex-shrink-0 cursor-pointer shadow-2xs ${
                activeTab === "PERCENT"
                  ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                  : "bg-white text-gray-600 hover:bg-emerald-50/50 border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-percent text-[11px]"></i>
              <span>ลดเป็นเปอร์เซ็นต์ (%)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === "PERCENT" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                {stats.percentCount}
              </span>
            </button>

            <button
              onClick={(e) => {
                setActiveTab("FIXED");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 flex-shrink-0 cursor-pointer shadow-2xs ${
                activeTab === "FIXED"
                  ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                  : "bg-white text-gray-600 hover:bg-emerald-50/50 border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-baht-sign text-[11px]"></i>
              <span>ลดคงที่ (฿)</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === "FIXED" ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                {stats.fixedCount}
              </span>
            </button>

            <button
              onClick={(e) => {
                setActiveTab("NO_MIN");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 flex-shrink-0 cursor-pointer shadow-2xs ${
                activeTab === "NO_MIN"
                  ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                  : "bg-white text-gray-600 hover:bg-emerald-50/50 border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-gift text-[11px]"></i>
              <span>ไม่มีขั้นต่ำ</span>
            </button>

            <button
              onClick={(e) => {
                setActiveTab("CLAIMED");
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 flex-shrink-0 cursor-pointer shadow-2xs ${
                activeTab === "CLAIMED"
                  ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                  : "bg-white text-gray-600 hover:bg-emerald-50/50 border border-gray-200/80"
              }`}
            >
              <i className="fa-solid fa-bookmark text-[11px]"></i>
              <span>โค้ดที่เก็บแล้ว</span>
              {stats.claimedCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === "CLAIMED" ? "bg-white/20 text-white" : "bg-emerald-100 text-[#16A085]"}`}>
                  {stats.claimedCount}
                </span>
              )}
            </button>
          </div>

          {/* Right Arrow Button / Gradient Fade (Desktop only) */}
          {canScrollRight && (
            <div className="hidden sm:flex absolute right-0 top-0 bottom-0 z-10 items-center pl-3 bg-gradient-to-l from-slate-50 via-slate-50/90 to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => scrollTabs("right")}
                className="w-8 h-8 rounded-full bg-white shadow-md border border-gray-200 text-gray-700 flex items-center justify-center hover:bg-emerald-50 hover:text-[#16A085] hover:border-[#16A085]/40 transition active:scale-95 cursor-pointer pointer-events-auto"
                aria-label="เลื่อนขวา"
              >
                <i className="fa-solid fa-chevron-right text-[11px]"></i>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ======================================================== */}
      {/* COUPONS GRID SECTION                                     */}
      {/* ======================================================== */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-3xl border border-gray-100 p-3.5 sm:p-4 md:p-5 shadow-xs animate-pulse flex flex-col justify-between h-56"
              >
                <div className="flex gap-3">
                  <div className="w-16 sm:w-20 h-16 sm:h-20 bg-gray-200 rounded-2xl flex-shrink-0"></div>
                  <div className="flex-1 space-y-2">
                    <div className="w-3/4 h-4 bg-gray-200 rounded"></div>
                    <div className="w-1/2 h-3 bg-gray-200 rounded"></div>
                    <div className="w-full h-2.5 bg-gray-200 rounded"></div>
                  </div>
                </div>
                <div className="w-full h-9 bg-gray-200 rounded-xl mt-3"></div>
              </div>
            ))}
          </div>
        ) : filteredAndSortedCoupons.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center max-w-lg mx-auto shadow-xs">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-[#16A085] flex items-center justify-center text-3xl mx-auto mb-4">
              <i className="fa-solid fa-ticket-simple"></i>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">
              {activeTab === "CLAIMED" ? "ยังไม่มีโค้ดส่วนลดที่คุณเก็บไว้" : "ไม่พบโค้ดส่วนลดที่ค้นหา"}
            </h3>
            <p className="text-xs text-gray-500 mb-6 leading-relaxed">
              {searchQuery
                ? `ไม่พบโค้ดที่ตรงกับคำค้นหา "${searchQuery}" ลองเปลี่ยนคำค้นหาใหม่ดูนะ`
                : activeTab === "CLAIMED"
                ? "คุณยังไม่ได้เก็บโค้ดส่วนลดใดๆ สามารถไปเลือกเก็บโค้ดสุดคุ้มจากร้านค้าชุมชนได้เลย!"
                : "ยังไม่มีโค้ดส่วนลดในหมวดหมู่นี้ในขณะนี้"}
            </p>
            <button
              onClick={() => {
                setSearchQuery("");
                setActiveTab("ALL");
              }}
              className="px-5 py-2.5 bg-[#16A085] text-white text-xs font-bold rounded-xl hover:bg-[#12876f] transition cursor-pointer shadow-sm"
            >
              {activeTab === "CLAIMED" ? "สำรวจและเก็บโค้ดส่วนลดทั้งหมด" : "ล้างตัวกรองและดูทั้งหมด"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
            {filteredAndSortedCoupons.map((coupon) => {
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

              const expiryDate = new Date(coupon.endDate);
              const daysLeft = Math.ceil((expiryDate.getTime() - now) / (1000 * 60 * 60 * 24));

              return (
                <div
                  key={coupon.id}
                  className="relative bg-white rounded-3xl border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_35px_rgb(0,0,0,0.08)] transition-all duration-300 group flex flex-col justify-between overflow-hidden"
                >
                  {/* Top Header Ticket Stub */}
                  <div className="p-3.5 sm:p-4 md:p-5 relative pb-3 sm:pb-4">
                    {/* Discount Value and Theme Colors */}
                    <div className="flex items-start justify-between gap-2 sm:gap-3 mb-2.5 sm:mb-3">
                      <div className="min-w-0 flex-1">
                        {coupon.shopName && (
                          <Link
                            href={`/shops/${coupon.shopId}`}
                            className="inline-flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs font-bold text-gray-500 hover:text-[#16A085] transition mb-1 line-clamp-1"
                          >
                            <i className="fa-solid fa-store text-[10px] sm:text-[11px] text-[#16A085]"></i>
                            <span className="truncate">{coupon.shopName}</span>
                          </Link>
                        )}
                        <h3 className="font-black text-gray-900 text-xs sm:text-sm md:text-base line-clamp-1 group-hover:text-[#16A085] transition-colors">
                          {coupon.name}
                        </h3>
                      </div>

                      {/* Prominent Discount Badge */}
                      <div
                        className={`text-right flex-shrink-0 px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl sm:rounded-2xl ${
                          isPercent
                            ? "bg-emerald-50 text-[#16A085] border border-emerald-100"
                            : "bg-amber-50 text-amber-600 border border-amber-100"
                        }`}
                      >
                        <div className="text-lg sm:text-xl lg:text-2xl font-black leading-none">
                          {isPercent ? `${coupon.discountValue}%` : `฿${coupon.discountValue / 100}`}
                        </div>
                        <div className="text-[9px] sm:text-[10px] font-bold opacity-80 mt-0.5">
                          {isPercent ? "ส่วนลด" : "ลดคงที่"}
                        </div>
                      </div>
                    </div>

                    {/* Voucher Code & Copy Tool */}
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl sm:rounded-2xl px-2.5 py-1.5 sm:px-3.5 sm:py-2 border border-gray-100 mt-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] sm:text-[11px] text-gray-400 font-bold uppercase tracking-wider hidden xs:inline">โค้ด:</span>
                        <span className="font-mono text-xs sm:text-sm font-black tracking-wider text-gray-800 truncate">
                          {coupon.code}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopyCode(coupon.code)}
                        className="text-[10px] sm:text-xs text-gray-500 hover:text-[#16A085] font-bold flex items-center gap-1 transition px-1.5 py-0.5 rounded-lg hover:bg-white flex-shrink-0"
                        title="คัดลอกโค้ด"
                      >
                        {copiedCode === coupon.code ? (
                          <>
                            <i className="fa-solid fa-check text-emerald-500 text-[10px] sm:text-xs"></i>
                            <span className="text-emerald-600 text-[10px] sm:text-[11px]">คัดลอกแล้ว</span>
                          </>
                        ) : (
                          <>
                            <i className="fa-regular fa-copy text-[10px] sm:text-[11px]"></i>
                            <span className="text-[10px] sm:text-[11px]">คัดลอก</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Perforated Divider Line with Cutout Notches */}
                  <div className="relative flex items-center py-1">
                    <div className="w-3 h-6 sm:w-4 sm:h-8 bg-slate-50/60 rounded-r-full border-r border-y border-gray-100 -ml-1.5 sm:-ml-2"></div>
                    <div className="flex-1 border-b-2 border-dashed border-gray-200 mx-1.5 sm:mx-2"></div>
                    <div className="w-3 h-6 sm:w-4 sm:h-8 bg-slate-50/60 rounded-l-full border-l border-y border-gray-100 -mr-1.5 sm:-mr-2"></div>
                  </div>

                  {/* Conditions & Expiry Stub */}
                  <div className="p-3.5 sm:p-4 md:p-5 pt-2 sm:pt-3 space-y-2.5 sm:space-y-4 flex-1 flex flex-col justify-between">
                    <div className="space-y-1.5 sm:space-y-2 text-[11px] sm:text-xs text-gray-600">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">เงื่อนไข:</span>
                        <span className="font-bold text-gray-700 truncate ml-1">{minSpendText}</span>
                      </div>

                      {isPercent && coupon.maxDiscountAmountMinor && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400">ลดสูงสุด:</span>
                          <span className="font-bold text-gray-700 truncate ml-1">
                            ฿{(coupon.maxDiscountAmountMinor / 100).toLocaleString()}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-gray-400">ใช้ได้ถึง:</span>
                        <span className={`font-bold ${daysLeft <= 3 ? "text-amber-600" : "text-gray-700"} truncate ml-1`}>
                          {expiryDate.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}
                          {daysLeft > 0 && daysLeft <= 7 && (
                            <span className="ml-1 text-[9px] sm:text-[10px] font-normal text-amber-500">
                              (เหลือ {daysLeft} วัน)
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Quota Progress */}
                      <div className="pt-1">
                        <div className="flex justify-between text-[10px] sm:text-[11px] mb-1">
                          <span className="text-gray-400">สิทธิ์คงเหลือ:</span>
                          <span className="font-bold text-gray-700">
                            {coupon.remainingQuota} / {coupon.quota}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              claimPercent >= 90 ? "bg-amber-500" : "bg-[#16A085]"
                            }`}
                            style={{ width: `${claimPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-1.5 sm:pt-2">
                      {isClaimed ? (
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <div className="flex-1 py-2 sm:py-2.5 px-1.5 rounded-xl sm:rounded-2xl bg-emerald-50 text-[#16A085] text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 border border-emerald-200/80">
                            <i className="fa-solid fa-check-circle text-[10px] sm:text-xs flex-shrink-0"></i>
                            <span className="truncate">เก็บแล้ว</span>
                          </div>
                          <Link
                            href={`/shops/${coupon.shopId}`}
                            className="px-2.5 sm:px-3.5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-[#16A085] hover:bg-[#12876f] text-white text-[10px] sm:text-xs font-bold transition flex items-center justify-center gap-1 shadow-xs hover:shadow-sm flex-shrink-0"
                            title="ไปที่หน้าร้านเพื่อเลือกซื้อสินค้า"
                          >
                            <span>ช้อป</span>
                            <i className="fa-solid fa-arrow-right text-[8px] sm:text-[10px]"></i>
                          </Link>
                        </div>
                      ) : isQuotaFull ? (
                        <button
                          disabled
                          className="w-full py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-gray-100 text-gray-400 text-[10px] sm:text-xs font-bold cursor-not-allowed text-center"
                        >
                          สิทธิ์เต็มแล้ว
                        </button>
                      ) : (
                        <button
                          onClick={() => handleClaim(coupon)}
                          disabled={isClaiming}
                          className={`w-full py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-black text-white shadow-xs hover:shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 ${
                            isPercent
                              ? "bg-[#16A085] hover:bg-[#12876f]"
                              : "bg-amber-500 hover:bg-amber-600"
                          }`}
                        >
                          {isClaiming ? (
                            <>
                              <i className="fa-solid fa-spinner fa-spin text-xs"></i>
                              <span>กำลังเก็บ...</span>
                            </>
                          ) : (
                            <>
                              <i className="fa-solid fa-ticket text-xs"></i>
                              <span>กดเก็บโค้ด</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ======================================================== */}
        {/* HOW TO USE GUIDE SECTION                                 */}
        {/* ======================================================== */}
        <section className="mt-16 bg-gradient-to-br from-white via-emerald-50/20 to-teal-50/30 rounded-3xl border border-emerald-100/80 p-6 sm:p-10 shadow-xs">
          <div className="text-center max-w-xl mx-auto mb-8">
            <h3 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              วิธีใช้งานโค้ดส่วนลดใน 3 ขั้นตอนง่ายๆ
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              สะสมโค้ดและนำไปใช้ลดราคาได้ทันทีก่อนกดยืนยันคำสั่งซื้อ
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100/70 text-[#16A085] flex items-center justify-center text-xl font-black mb-4">
                1
              </div>
              <h4 className="font-bold text-gray-800 text-sm mb-1.5">กดเก็บโค้ดส่วนลด</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                เลือกโค้ดจากร้านค้าที่สนใจในหน้านี้ แล้วกดปุ่ม &quot;กดเก็บโค้ด&quot; เพื่อบันทึกสิทธิ์เข้าสู่บัญชีของคุณ
              </p>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-teal-100/70 text-teal-600 flex items-center justify-center text-xl font-black mb-4">
                2
              </div>
              <h4 className="font-bold text-gray-800 text-sm mb-1.5">เลือกซื้อสินค้าในร้าน</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                คลิกไปที่หน้าร้านค้าและเลือกซื้อสินค้าให้มียอดขั้นต่ำตามที่โค้ดกำหนด แล้วเพิ่มลงตะกร้าสินค้า
              </p>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-xs flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-100/70 text-amber-600 flex items-center justify-center text-xl font-black mb-4">
                3
              </div>
              <h4 className="font-bold text-gray-800 text-sm mb-1.5">รับส่วนลดทันทีตอนชำระเงิน</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                ในหน้าเช็คเอาต์ ระบบจะเลือกโค้ดที่คุ้มที่สุดให้อัตโนมัติ หรือเลือกคูปองที่ต้องการเพื่อลดทันทีก่อนชำระเงิน
              </p>
            </div>
          </div>
        </section>
      </main>
      </div>
      <Footer />
      <MobileNav />
    </div>
  );
}
