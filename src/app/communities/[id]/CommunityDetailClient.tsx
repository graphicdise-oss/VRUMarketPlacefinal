"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import ProductCard from "@/components/home/ProductCard";
import { communityApi, CommunityDto, shopApi, productApi, PublicProductDto } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";

export default function CommunityDetailClient({ communityId }: { communityId: string }) {
  const [community, setCommunity] = useState<CommunityDto | null>(null);
  const [products, setProducts] = useState<PublicProductDto[]>([]);
  const [shopCount, setShopCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const [communityRes, shopsRes, productsRes] = await Promise.all([
          communityApi.getById(communityId),
          shopApi.listPublic({ communityId, limit: 50 }),
          productApi.listPublic({ communityId, limit: 12 }),
        ]);
        setCommunity(communityRes);
        setShopCount(shopsRes.items.length);
        setProducts(productsRes.items);
      } catch (err) {
        console.error("Failed to fetch community:", err);
        setError(true);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [communityId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-gray-400">
            <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i>
            <p className="font-bold">กำลังโหลดข้อมูลชุมชน...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !community) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center text-center text-gray-400">
          <div>
            <i className="fa-solid fa-city text-5xl mb-4 block text-gray-200"></i>
            <p className="font-bold text-gray-600">ไม่พบชุมชนนี้</p>
            <Link href="/" className="mt-4 inline-block text-[#16A085] font-bold hover:underline">← กลับหน้าหลัก</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="flex-grow w-full pb-12">

        {/* Cover Header */}
        <div className="w-full h-[300px] md:h-[400px] relative bg-gradient-to-br from-[#16A085] to-[#2ECC71] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-6 md:p-12">
            <div className="max-w-7xl mx-auto w-full">
              <span className="bg-[#16A085] text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-md mb-4 inline-block">ชุมชน VRU</span>
              <h1 className="text-4xl md:text-5xl font-black text-white mb-2">{community.name}</h1>
              {community.description && (
                <p className="text-white/80 max-w-2xl line-clamp-2">{community.description}</p>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 -mt-8 relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Left Panel */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              <h3 className="font-bold text-gray-800 text-lg mb-4">เกี่ยวกับชุมชน</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-6">
                {community.description || "ชุมชนในเครือข่ายมหาวิทยาลัยราชภัฏวไลยอลงกรณ์"}
              </p>

              <div className="grid grid-cols-2 gap-3 text-center mb-6">
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-xl font-black text-[#16A085]">{shopCount}</p>
                  <p className="text-[10px] text-gray-500 font-bold">ร้านค้า</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-xl font-black text-[#16A085]">{products.length}+</p>
                  <p className="text-[10px] text-gray-500 font-bold">สินค้า</p>
                </div>
              </div>

              <Link href={`/shops?communityId=${communityId}`} className="w-full block text-center bg-[#D4F1BB]/30 text-[#16A085] hover:bg-[#D4F1BB]/60 font-bold py-3 rounded-xl transition text-sm">
                ดูร้านค้าทั้งหมดในชุมชนนี้
              </Link>
            </div>
          </div>

          {/* Right Panel (Products) */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-800">สินค้าแนะนำจากชุมชน</h2>
              </div>

              {products.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <i className="fa-solid fa-box-open text-3xl mb-3 block text-gray-200"></i>
                  <p className="font-bold">ยังไม่มีสินค้าในชุมชนนี้</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 md:gap-6">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={mapPublicProductDto(product)} />
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
