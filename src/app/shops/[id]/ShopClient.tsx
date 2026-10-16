"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import ProductCard from "@/components/home/ProductCard";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { shopApi, PublicShopDto, productApi, PublicProductDto, couponApi, CouponDto } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";
import { useToast } from "@/components/ui/Toast";
import dynamic from "next/dynamic";

const MapDisplay = dynamic(() => import("@/components/map/MapDisplay"), { ssr: false, loading: () => <div className="h-[250px] w-full bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 border border-gray-100">กำลังโหลดแผนที่...</div> });

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

export default function ShopClient({ shopId }: { shopId: string }) {
  const { showToast } = useToast();
  const [shop, setShop] = useState<PublicShopDto | null>(null);
  const [productList, setProductList] = useState<PublicProductDto[]>([]);
  const [followStatus, setFollowStatus] = useState<{ followerCount: number; isFollowing: boolean }>({ followerCount: 0, isFollowing: false });
  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [coupons, setCoupons] = useState<CouponDto[]>([]);
  const [claimingCouponId, setClaimingCouponId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const couponsScrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isCommunityAdmin = !!user?.adminCommunityIds && user.adminCommunityIds.length > 0;
  const isAdminBlocked = isSuperAdmin || isCommunityAdmin;

  // Share Modal States
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const scrollCoupons = (direction: "left" | "right") => {
    if (couponsScrollRef.current) {
      const scrollAmount = 336; // 320px width + 16px gap
      couponsScrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const [shopRes, productsRes, followRes, couponsRes] = await Promise.all([
          shopApi.getById(shopId),
          productApi.listPublic({ shopId, limit: 50 }),
          shopApi.getFollowStatus(shopId).catch(() => ({ followerCount: 0, isFollowing: false })),
          couponApi.getPublicShopCoupons(shopId).catch(() => []),
        ]);
        setShop(shopRes);
        setProductList(productsRes.items);
        setFollowStatus(followRes);
        setCoupons(couponsRes);
      } catch (err) {
        console.error("Failed to fetch shop:", err);
        setError(true);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [shopId]);

  const handleClaimCoupon = async (couponId: string) => {
    setClaimingCouponId(couponId);
    try {
      await couponApi.claimCoupon(couponId);
      setCoupons(prev =>
        prev.map(c =>
          c.id === couponId
            ? {
                ...c,
                isClaimed: true,
                claimedCount: c.claimedCount + 1,
                remainingQuota: Math.max(0, c.remainingQuota - 1),
              }
            : c
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ไม่สามารถเก็บคูปองได้ กรุณาเข้าสู่ระบบก่อนเก็บคูปอง";
      alert(msg);
    } finally {
      setClaimingCouponId(null);
    }
  };

  const [now] = useState(() => Date.now());
  const logoUrl = shop?.hasLogo ? `${API_BASE}/shops/${shopId}/logo` : null;
  const bannerUrl = shop?.hasBanner ? `${API_BASE}/shops/${shopId}/banner` : "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80";
  const joinedAge = shop ? (() => {
    const months = Math.floor((now - new Date(shop.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (months < 1) return "< 1 เดือน";
    if (months < 12) return `${months} เดือน`;
    return `${Math.floor(months / 12)} ปี`;
  })() : "-";

  const mapCoords = (() => {
    if (shop?.description) {
      const match = shop.description.match(/maps\.google\.com\/\?q=([0-9.-]+),([0-9.-]+)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
          return { lat, lng };
        }
      }
    }
    return { lat: 14.1323, lng: 100.6172 };
  })();

  const handleFollowToggle = async () => {
    setIsFollowLoading(true);
    try {
      if (followStatus.isFollowing) {
        await shopApi.unfollow(shopId);
        setFollowStatus(prev => ({ ...prev, isFollowing: false, followerCount: Math.max(0, prev.followerCount - 1) }));
      } else {
        await shopApi.follow(shopId);
        setFollowStatus(prev => ({ ...prev, isFollowing: true, followerCount: prev.followerCount + 1 }));
      }
    } catch {
      alert("กรุณาเข้าสู่ระบบก่อนติดตามร้านค้า");
    } finally {
      setIsFollowLoading(false);
    }
  };

  const openShareWindow = (url: string) => {
    window.open(url, "_blank", "width=600,height=500,scrollbars=yes,resizable=yes");
  };

  const handleShareFacebook = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
  };

  const handleShareLine = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    openShareWindow(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`);
  };

  const handleShareMessenger = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `fb-messenger://share?link=${encodeURIComponent(url)}`;
    } else {
      openShareWindow(`https://www.facebook.com/dialog/send?link=${encodeURIComponent(url)}&app_id=291494419107518&redirect_uri=${encodeURIComponent(url)}`);
    }
  };

  const handleShareTwitter = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = shop ? `แวะชมร้านค้า "${shop.name}" บน VRU Marketplace` : "ร้านค้าชุมชน VRU Marketplace";
    openShareWindow(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  };

  const handleCopyLink = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setIsCopied(true);
      showToast("คัดลอกลิงก์ร้านค้าเรียบร้อยแล้ว");
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      showToast("ไม่สามารถคัดลอกลิงก์ได้", "error");
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share && shop) {
      try {
        await navigator.share({
          title: shop.name,
          text: `แวะชมร้านค้า "${shop.name}" บน VRU Marketplace`,
          url: window.location.href,
        });
      } catch {
        // user dismissed
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-gray-400">
            <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i>
            <p className="font-bold">กำลังโหลดข้อมูลร้านค้า...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center text-gray-400">
            <i className="fa-solid fa-store-slash text-5xl mb-4 block text-gray-200"></i>
            <p className="font-bold text-gray-600">ไม่พบร้านค้านี้</p>
            <Link href="/shops" className="mt-4 inline-block text-[#16A085] font-bold hover:underline">← กลับหน้ารายการร้านค้า</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 py-6 md:py-8">
        <Breadcrumb items={[
          { label: "ร้านค้าชุมชน", href: "/shops" },
          { label: shop.name }
        ]} />

        {/* Cover & Profile */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8 relative">
          <div className="h-48 md:h-64 bg-cover bg-center relative overflow-hidden" style={{ backgroundImage: `url('${bannerUrl}')` }}>
            <div className="absolute inset-0 bg-black/20"></div>
          </div>

          <div className="px-6 md:px-10 pb-8 relative">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-10 mb-6 relative z-10">
              <div className="-mt-16 md:-mt-20 w-32 h-32 md:w-40 md:h-40 bg-white rounded-full p-2 border-4 border-white shadow-md flex-shrink-0 overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt={shop.name} className="w-full h-full object-cover rounded-full" />
                ) : (
                  <div className="w-full h-full bg-[#D4F1BB] rounded-full flex items-center justify-center text-[#16A085] text-4xl font-black">
                    {shop.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="text-center md:text-left flex-grow mt-2 md:mt-8">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-800 tracking-tight">{shop.name}</h1>
                {shop.description && (
                  <p className="text-gray-600 mt-2 max-w-xl whitespace-pre-line leading-relaxed text-sm bg-gray-50/70 p-4 rounded-2xl border border-gray-100">{shop.description}</p>
                )}
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-3">
                  <span className="bg-[#16A085] text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center shadow-sm">
                    <i className="fa-solid fa-leaf mr-1.5"></i> ชุมชนต้นแบบ
                  </span>
                  <span className="text-gray-500 text-sm font-medium flex items-center ml-2">
                    <i className="fa-solid fa-location-dot text-red-500 mr-1.5"></i> {shop.province || "ไม่ระบุจังหวัด"}
                  </span>
                </div>
              </div>
              <div className="w-full md:w-auto flex flex-wrap gap-3 mt-4 md:mt-8">
                <button
                  onClick={handleFollowToggle}
                  disabled={isFollowLoading}
                  className={`flex-1 md:flex-none font-bold py-3 px-8 rounded-full text-sm transition-all flex items-center justify-center gap-2 shadow-sm ${
                    followStatus.isFollowing 
                      ? "bg-gray-100 text-gray-700 hover:bg-gray-200" 
                      : "bg-[#16A085] text-white hover:bg-[#117A65]"
                  }`}
                >
                  <i className={`fa-solid ${followStatus.isFollowing ? "fa-check" : "fa-plus"} text-lg ${isFollowLoading ? "fa-spinner fa-spin" : ""}`}></i> 
                  {followStatus.isFollowing ? "กำลังติดตาม" : "ติดตามร้านค้า"}
                </button>
                <Link href="/chat" className="flex-1 md:flex-none bg-[#E8F8F5] text-[#16A085] hover:bg-[#D1F2EB] font-bold py-2.5 px-6 rounded-full text-sm transition-all flex items-center justify-center gap-2">
                  <i className="fa-regular fa-message text-lg"></i> แชท
                </Link>
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(true)}
                  className="flex-1 md:flex-none bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-2.5 px-6 rounded-full text-sm transition-all flex items-center justify-center gap-2 active:scale-95 shadow-2xs"
                  title="แชร์ร้านค้า"
                >
                  <i className="fa-solid fa-share-nodes text-lg text-[#16A085]"></i> แชร์
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center pt-6">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 flex flex-col items-center justify-center">
                <p className="text-gray-500 text-xs md:text-sm font-bold mb-1">สินค้าทั้งหมด</p>
                <p className="font-black text-[#16A085] text-2xl">{productList.length}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 flex flex-col items-center justify-center">
                <p className="text-gray-500 text-xs md:text-sm font-bold mb-1">ผู้ติดตาม</p>
                <p className="font-black text-[#16A085] text-2xl">{followStatus.followerCount}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 flex flex-col items-center justify-center">
                <p className="text-gray-500 text-xs md:text-sm font-bold mb-1">คะแนนร้านค้า</p>
                <p className="font-black text-[#16A085] text-2xl">{shop.averageRating ? `${shop.averageRating.toFixed(1)}/5` : "-"}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 flex flex-col items-center justify-center">
                <p className="text-gray-500 text-xs md:text-sm font-bold mb-1">เข้าร่วมเมื่อ</p>
                <p className="font-black text-[#16A085] text-2xl">{joinedAge}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Shop Coupons Banner */}
        {coupons.length > 0 && (
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 rounded-3xl p-6 md:p-8 border border-emerald-100 shadow-sm mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center text-[#16A085] text-xl border border-emerald-100">
                  <i className="fa-solid fa-ticket-simple"></i>
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-black text-gray-800">คูปองส่วนลดของร้านค้า</h2>
                  <p className="text-xs md:text-sm text-gray-500 font-medium">กดเก็บโค้ดเพื่อรับส่วนลดทันทีเมื่อสั่งซื้อสินค้าจากร้านนี้</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 self-start sm:self-auto">
                <span className="text-xs font-bold text-[#16A085] bg-white px-3.5 py-1.5 rounded-full border border-emerald-200 shadow-sm">
                  มี {coupons.length} โค้ดส่วนลด
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => scrollCoupons("left")}
                    aria-label="เลื่อนซ้าย"
                    title="เลื่อนซ้าย"
                    className="w-8 h-8 rounded-full bg-white border border-emerald-200 hover:border-[#16A085] hover:bg-[#16A085] text-gray-600 hover:text-white flex items-center justify-center text-xs transition shadow-sm active:scale-90"
                  >
                    <i className="fa-solid fa-chevron-left"></i>
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollCoupons("right")}
                    aria-label="เลื่อนขวา"
                    title="เลื่อนขวา"
                    className="w-8 h-8 rounded-full bg-white border border-emerald-200 hover:border-[#16A085] hover:bg-[#16A085] text-gray-600 hover:text-white flex items-center justify-center text-xs transition shadow-sm active:scale-90"
                  >
                    <i className="fa-solid fa-chevron-right"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Horizontal Slider (Single Row with Arrow Navigation) */}
            <div className="relative group/slider">
              {/* Floating Arrow Left */}
              <button
                type="button"
                onClick={() => scrollCoupons("left")}
                aria-label="เลื่อนซ้าย"
                className="hidden md:flex absolute -left-3.5 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 backdrop-blur border border-emerald-200 text-[#16A085] hover:bg-[#16A085] hover:text-white shadow-md items-center justify-center text-xs transition active:scale-90 opacity-0 group-hover/slider:opacity-100"
              >
                <i className="fa-solid fa-chevron-left"></i>
              </button>

              <div
                ref={couponsScrollRef}
                className="flex items-stretch gap-4 overflow-x-auto scroll-smooth pb-2 pt-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {coupons.map((coupon) => {
                  const isSoldOut = coupon.remainingQuota <= 0;
                  const isClaimed = coupon.isClaimed;
                  const isClaiming = claimingCouponId === coupon.id;

                  return (
                    <div
                      key={coupon.id}
                      className="w-[280px] sm:w-[320px] flex-shrink-0 bg-white rounded-2xl border border-emerald-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between overflow-hidden relative group"
                    >
                      {/* Left accent strip */}
                      <div className="absolute top-0 left-0 bottom-0 w-2 bg-gradient-to-b from-[#16A085] to-emerald-400"></div>

                      <div className="p-4 pl-6">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <span className="text-2xl font-black text-[#16A085] tracking-tight">
                              {coupon.discountType === "FIXED_AMOUNT"
                                ? `ลด ฿${(coupon.discountValue / 100).toLocaleString()}`
                                : `ลด ${coupon.discountValue}%`}
                            </span>
                            {coupon.discountType === "PERCENTAGE" && coupon.maxDiscountAmountMinor && (
                              <span className="block text-[11px] text-gray-500 font-medium">
                                ลดสูงสุด ฿{(coupon.maxDiscountAmountMinor / 100).toLocaleString()}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-xs font-bold bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200">
                            {coupon.code}
                          </span>
                        </div>

                        <p className="text-sm font-bold text-gray-800 line-clamp-1 mb-1">{coupon.name}</p>

                        <div className="space-y-1 text-xs text-gray-500 font-medium mt-2">
                          <p className="flex items-center gap-1.5">
                            <i className="fa-solid fa-bag-shopping text-gray-400 text-[10px]"></i>
                            ขั้นต่ำ ฿{(coupon.minSpendAmountMinor / 100).toLocaleString()}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <i className="fa-regular fa-clock text-gray-400 text-[10px]"></i>
                            ใช้ได้ถึง {new Date(coupon.endDate).toLocaleDateString("th-TH")}
                          </p>
                        </div>
                      </div>

                      {/* Bottom action row */}
                      <div className="bg-gray-50/70 px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-xs">
                        <span className="text-gray-400 font-medium">
                          {isSoldOut ? "สิทธิ์เต็มแล้ว" : `เหลือ ${coupon.remainingQuota} สิทธิ์`}
                        </span>
                        {isClaimed ? (
                          <span className="text-[#16A085] font-bold flex items-center gap-1 bg-[#D4F1BB]/50 px-3 py-1 rounded-full">
                            <i className="fa-solid fa-circle-check text-xs"></i> เก็บแล้ว
                          </span>
                        ) : isAdminBlocked ? (
                          <span className="text-gray-400">ไม่สามารถเก็บคูปอง (Admin)</span>
                        ) : (
                            <button
                              onClick={() => handleClaimCoupon(coupon.id)}
                              disabled={isSoldOut || isClaiming}
                              className="btn-minimal text-xs font-bold px-4 py-1.5 rounded-full transition-all shadow-sm hover:shadow disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {isClaiming ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> กำลังเก็บ...</>
                              ) : isSoldOut ? (
                                "หมดแล้ว"
                              ) : (
                                <><i className="fa-solid fa-plus"></i> เก็บโค้ด</>
                              )}
                            </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Floating Arrow Right */}
              <button
                type="button"
                onClick={() => scrollCoupons("right")}
                aria-label="เลื่อนขวา"
                className="hidden md:flex absolute -right-3.5 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 backdrop-blur border border-emerald-200 text-[#16A085] hover:bg-[#16A085] hover:text-white shadow-md items-center justify-center text-xs transition active:scale-90 opacity-0 group-hover/slider:opacity-100"
              >
                <i className="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          </div>
        )}

        {/* Map Section */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8 p-6 md:p-8">
          <h2 className="font-black text-gray-800 text-xl mb-4 flex items-center gap-2">
            <i className="fa-solid fa-map-location-dot text-[#16A085]"></i> ตำแหน่งที่ตั้งร้านค้า
          </h2>
          <div className="h-64 rounded-2xl overflow-hidden border border-gray-200">
            <MapDisplay latitude={mapCoords.lat} longitude={mapCoords.lng} shopName={shop.name} containerHeight="100%" />
          </div>
        </div>

        {/* Product list */}
        <div className="mb-8 border-b border-gray-200">
          <ul className="flex flex-wrap -mb-px text-sm font-medium text-center">
            <li className="mr-2">
              <span className="inline-block p-4 border-b-2 border-[#16A085] text-[#16A085] font-bold rounded-t-lg active text-base">
                สินค้าทั้งหมดของร้าน
              </span>
            </li>
          </ul>
        </div>

        {productList.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <i className="fa-solid fa-box-open text-4xl mb-4 block text-gray-200"></i>
            <p className="font-bold">ร้านนี้ยังไม่มีสินค้า</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {productList.map((product) => (
              <ProductCard key={product.id} product={mapPublicProductDto(product)} />
            ))}
          </div>
        )}

        {/* Share Store Modal */}
        {isShareModalOpen && shop && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in"
            onClick={() => setIsShareModalOpen(false)}
          >
            <div 
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative border border-gray-100 transform transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center transition cursor-pointer"
                aria-label="ปิด"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>

              {/* Header */}
              <div className="text-center mb-5">
                <div className="w-12 h-12 bg-[#E8F8F5] text-[#16A085] rounded-2xl flex items-center justify-center mx-auto mb-3 text-xl shadow-xs">
                  <i className="fa-solid fa-share-nodes"></i>
                </div>
                <h3 className="text-lg font-bold text-gray-900">แชร์ร้านค้านี้</h3>
                <p className="text-xs text-gray-500 mt-0.5">แบ่งปันร้านค้าให้เพื่อนหรือเครือข่ายสังคมของคุณ</p>
              </div>

              {/* Shop Info Preview Card */}
              <div className="bg-gray-50 rounded-2xl p-3.5 mb-5 flex items-center gap-3 border border-gray-100">
                <div className="w-12 h-12 rounded-xl bg-[#D4F1BB] text-[#16A085] font-black text-lg flex items-center justify-center overflow-hidden flex-shrink-0 shadow-xs border border-white">
                  {shop.hasLogo ? (
                    <img src={`${API_BASE}/shops/${shop.id}/logo`} alt={shop.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{shop.name.charAt(0)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-gray-900 truncate">{shop.name}</h4>
                  <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                    <span className="truncate">{shop.communityName || "วิสาหกิจชุมชน"}</span>
                    {shop.province && (
                      <>
                        <span>•</span>
                        <span className="flex-shrink-0">{shop.province}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Social Share Channels */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {/* LINE */}
                <button
                  type="button"
                  onClick={handleShareLine}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#06C755] text-white flex items-center justify-center text-2xl shadow-sm transition-transform group-hover:scale-105 active:scale-95">
                    <i className="fa-brands fa-line"></i>
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 group-hover:text-gray-900">LINE</span>
                </button>

                {/* Facebook */}
                <button
                  type="button"
                  onClick={handleShareFacebook}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#1877F2] text-white flex items-center justify-center text-xl shadow-sm transition-transform group-hover:scale-105 active:scale-95">
                    <i className="fa-brands fa-facebook-f"></i>
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 group-hover:text-gray-900">Facebook</span>
                </button>

                {/* Messenger */}
                <button
                  type="button"
                  onClick={handleShareMessenger}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0084FF] to-[#00C6FF] text-white flex items-center justify-center text-xl shadow-sm transition-transform group-hover:scale-105 active:scale-95">
                    <i className="fa-brands fa-facebook-messenger"></i>
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 group-hover:text-gray-900">Messenger</span>
                </button>

                {/* X (Twitter) */}
                <button
                  type="button"
                  onClick={handleShareTwitter}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center text-lg shadow-sm transition-transform group-hover:scale-105 active:scale-95">
                    <i className="fa-brands fa-x-twitter"></i>
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 group-hover:text-gray-900">X</span>
                </button>
              </div>

              {/* Native Mobile Share */}
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="w-full mb-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square"></i> แชร์ผ่านแอปพลิเคชันอื่นบนอุปกรณ์
                </button>
              )}

              {/* Copy Link Input Bar */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">คัดลอกลิงก์ร้านค้า</label>
                <div className="flex items-center gap-2 p-1.5 bg-gray-50 border border-gray-200 rounded-2xl focus-within:border-[#16A085] transition">
                  <input
                    type="text"
                    readOnly
                    value={typeof window !== "undefined" ? window.location.href : ""}
                    className="flex-1 bg-transparent px-3 text-xs text-gray-600 focus:outline-hidden select-all font-mono"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className={`font-bold text-xs py-2 px-4 rounded-xl transition flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                      isCopied 
                        ? "bg-emerald-600 text-white" 
                        : "bg-[#16A085] hover:bg-[#117A65] text-white"
                    }`}
                  >
                    <i className={`fa-solid ${isCopied ? "fa-check" : "fa-copy"}`}></i>
                    {isCopied ? "คัดลอกแล้ว" : "คัดลอก"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
