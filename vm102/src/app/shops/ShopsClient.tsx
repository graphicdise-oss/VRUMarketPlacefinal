"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { StaggeredGrid, FadeIn } from "@/components/ui/Animations";
import { shopApi, PublicShopDto } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

export default function ShopsClient() {
  const [shops, setShops] = useState<PublicShopDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    shopApi.listPublic({ limit: 50 })
      .then(res => setShops(res.items))
      .catch(err => console.error("Failed to fetch shops:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = shops.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const joinedAge = (createdAt: string) => {
    // eslint-disable-next-line react-hooks/purity
    const months = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (months < 1) return "< 1 เดือน";
    if (months < 12) return `${months} เดือน`;
    return `${Math.floor(months / 12)} ปี`;
  };

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 py-6 md:py-8">
        <Breadcrumb items={[{ label: "ร้านค้าชุมชน" }]} />

        {/* Page Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-3">ร้านค้าชุมชนทั้งหมด</h1>
          <p className="text-gray-500 max-w-2xl mx-auto">ค้นหาร้านค้าและผู้ประกอบการจากวิสาหกิจชุมชนต่างๆ สนับสนุนรายได้สู่ท้องถิ่นโดยตรง</p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4 bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
          <div className="relative w-full sm:w-96">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              placeholder="ค้นหาร้านค้า..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-minimal w-full pl-10"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 lg:gap-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col animate-pulse">
                <div className="h-24 sm:h-28 lg:h-32 bg-gray-200"></div>
                <div className="p-3 sm:p-4 lg:p-5 pt-7 sm:pt-8 lg:pt-9 relative flex flex-col flex-grow">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-gray-300 rounded-xl sm:rounded-2xl border-2 sm:border-4 border-white shadow-md absolute -top-6 sm:-top-7 left-4 sm:left-5"></div>
                  <div className="mt-4 mb-3 space-y-1.5">
                    <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:gap-1.5 mt-auto mb-3">
                    <div className="h-9 bg-gray-100 rounded-lg"></div>
                    <div className="h-9 bg-gray-100 rounded-lg"></div>
                    <div className="h-9 bg-gray-100 rounded-lg"></div>
                  </div>
                  <div className="h-8 bg-gray-200 rounded-full w-full"></div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <i className="fa-solid fa-store-slash text-4xl mb-4 block text-gray-200"></i>
            <p className="font-bold">{search ? "ไม่พบร้านค้าที่ตรงกับการค้นหา" : "ยังไม่มีร้านค้า"}</p>
          </div>
        ) : (
          /* Shops Grid (Mobile: 2, Tablet: 3, Laptop: 4, PC: 5) */
          <StaggeredGrid className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 lg:gap-5">
            {filtered.map((shop) => {
              const logoUrl = shop.hasLogo ? `${API_BASE}/shops/${shop.id}/logo` : null;
              const bannerUrl = shop.hasBanner ? `${API_BASE}/shops/${shop.id}/banner` : "https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=600&auto=format&fit=crop";
              return (
                <FadeIn key={shop.id} direction="up" delay={0.1}>
                  <div className="bg-white h-full rounded-2xl sm:rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.1)] transition-all duration-300 border border-gray-100 overflow-hidden flex flex-col group relative">
                    {/* Banner Image */}
                    <div className="h-24 sm:h-28 lg:h-32 w-full relative overflow-hidden bg-gray-200">
                      <img 
                        src={bannerUrl} 
                        alt="Shop Banner" 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-black/10"></div>
                    </div>

                    <div className="p-3 sm:p-4 lg:p-5 pt-7 sm:pt-8 lg:pt-9 relative flex flex-col flex-grow bg-white">
                      {/* Logo (Rounded Square with white border) */}
                      <div className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-white rounded-xl sm:rounded-2xl border-2 sm:border-4 border-white shadow-md absolute -top-6 sm:-top-7 left-4 sm:left-5 flex-shrink-0 overflow-hidden z-10 group-hover:-translate-y-1 transition-transform duration-300">
                        {logoUrl ? (
                          <img src={logoUrl} alt={shop.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-[#D4F1BB] flex items-center justify-center text-[#16A085] text-lg sm:text-xl font-black">
                            {shop.name.charAt(0)}
                          </div>
                        )}
                      </div>

                      {/* Title and Subtitle */}
                      <div className="mb-3 sm:mb-4">
                        <h3 className="font-bold text-sm sm:text-base lg:text-lg text-[#16A085] mb-1 sm:mb-1.5 line-clamp-1" title={shop.name}>{shop.name}</h3>
                        <div className="flex items-center text-[11px] sm:text-xs text-gray-500 divide-x divide-gray-300">
                          {shop.communityName && (
                            <span className="flex items-center pr-2">
                              <i className="fa-solid fa-users text-[#16A085]/70 mr-1 text-[10px] sm:text-xs"></i> 
                              <span className="truncate max-w-[80px] sm:max-w-[110px]">{shop.communityName}</span>
                            </span>
                          )}
                          <span className="flex items-center pl-2">
                            <i className="fa-solid fa-location-dot text-red-500/80 mr-1 text-[10px] sm:text-xs"></i> 
                            <span className="truncate max-w-[70px] sm:max-w-[90px]">{shop.province || "ไม่ระบุ"}</span>
                          </span>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-1 sm:gap-1.5 text-center text-[11px] sm:text-xs mb-3 sm:mb-4 mt-auto">
                        <div className="bg-gray-50/80 py-1.5 sm:py-2 px-0.5 rounded-lg sm:rounded-xl">
                          <p className="text-gray-400 text-[10px] sm:text-[11px] mb-0.5 truncate">สินค้า</p>
                          <p className="font-bold text-gray-800 text-xs sm:text-sm truncate">{shop.productCount ?? 0}</p>
                        </div>
                        <div className="bg-gray-50/80 py-1.5 sm:py-2 px-0.5 rounded-lg sm:rounded-xl">
                          <p className="text-gray-400 text-[10px] sm:text-[11px] mb-0.5 truncate">คะแนน</p>
                          <p className="font-bold text-gray-800 text-xs sm:text-sm flex items-center justify-center gap-0.5 truncate">
                            <i className="fa-solid fa-star text-amber-400 text-[9px] sm:text-[10px]"></i> {shop.averageRating ? shop.averageRating.toFixed(1) : "-"}
                          </p>
                        </div>
                        <div className="bg-gray-50/80 py-1.5 sm:py-2 px-0.5 rounded-lg sm:rounded-xl">
                          <p className="text-gray-400 text-[10px] sm:text-[11px] mb-0.5 truncate">เข้าร่วม</p>
                          <p className="font-bold text-gray-800 text-[10px] sm:text-xs truncate">{joinedAge(shop.createdAt)}</p>
                        </div>
                      </div>

                      {/* Action Button */}
                      <Link href={`/shops/${shop.id}`} className="w-full bg-white border border-gray-200 text-gray-700 hover:border-[#16A085] hover:text-[#16A085] text-center font-bold py-2 sm:py-2.5 rounded-full text-xs sm:text-sm active:scale-[0.98] transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md">
                        เยี่ยมชมร้านค้า
                      </Link>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </StaggeredGrid>
        )}

      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
