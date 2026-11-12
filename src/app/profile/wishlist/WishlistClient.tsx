"use client";

import { useAuth } from "@/lib/auth-context";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { favoriteApi } from "@/lib/api";
import type { ProductDto } from "@/lib/api-modules/product";
import { useRouter } from "next/navigation";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";
import Breadcrumb from "@/components/ui/Breadcrumb";

export default function WishlistClient() {
  const { user, isLoading: isAuthLoading } = useAuth();
  
  const [favorites, setFavorites] = useState<ProductDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await favoriteApi.list();
      setFavorites(res);
    } catch (err) {
      const error = err as Error & { status?: number };
      if (error?.message === "กรุณาเข้าสู่ระบบก่อน" || error?.status === 401) {
        router.push("/login");
      } else {
        console.error("Failed to fetch favorites:", error);
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login');
    }
  }, [user, isAuthLoading, router]);

  useEffect(() => {
    if (user) {
      fetchFavorites();
    }
  }, [user, fetchFavorites]);

  const handleRemove = async (productId: string) => {
    try {
      await favoriteApi.remove(productId);
      setFavorites(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      console.error("Failed to remove favorite:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50">
      <Header />
      
      <main className="flex-grow max-w-7xl mx-auto w-full px-3 sm:px-4 pt-4 sm:pt-6 pb-24 md:pb-10">
        <Breadcrumb
          items={[
            { label: "ข้อมูลส่วนตัว", href: "/profile" },
            { label: "สินค้าที่ถูกใจ" },
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

          {/* Content */}
          <div className="flex-grow min-w-0 bg-white rounded-3xl shadow-sm border border-gray-100 p-5 sm:p-7 md:p-9">
            <div className="flex items-center justify-between pb-5 mb-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center text-lg sm:text-xl shadow-xs border border-red-100/60">
                  <i className="fa-solid fa-heart"></i>
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-gray-800">สินค้าที่ถูกใจ</h1>
                  <p className="text-xs sm:text-sm text-gray-500 font-medium">
                    สินค้าชุมชนที่คุณบันทึกไว้สำหรับเลือกซื้อในภายหลัง
                  </p>
                </div>
              </div>
              {!isLoading && favorites.length > 0 && (
                <span className="text-xs sm:text-sm bg-red-50 text-red-500 font-bold px-3 py-1.5 rounded-full border border-red-200/60">
                  {favorites.length} รายการ
                </span>
              )}
            </div>
          
          {isLoading ? (
            <div className="py-12 flex justify-center items-center">
              <div className="w-8 h-8 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-16 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                <i className="fa-regular fa-heart text-4xl text-gray-300"></i>
              </div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">ยังไม่มีสินค้าที่ถูกใจ</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">คุณสามารถบันทึกสินค้าที่สนใจไว้ดูภายหลังได้ โดยการกดไอคอนหัวใจที่รูปสินค้า</p>
              <Link href="/" className="inline-flex items-center justify-center bg-[#16A085] hover:bg-[#12876f] text-white px-6 py-3 rounded-xl font-bold transition shadow-sm hover:shadow">
                <i className="fa-solid fa-cart-shopping mr-2"></i> ไปเลือกซื้อสินค้าเลย
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
              {favorites.map(product => (
                <div key={product.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md transition-shadow flex flex-col group relative">
                  <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
                    {product.images?.[0] ? (
                      <img src={`/api/v1/products/${product.id}/images/${product.images[0].id}`} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <i className="fa-solid fa-image text-4xl"></i>
                      </div>
                    )}
                    <button 
                      onClick={(e) => { e.preventDefault(); handleRemove(product.id); }}
                      className="absolute top-3 right-3 w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
                      title="ลบออกจากรายการที่ถูกใจ"
                    >
                      <i className="fa-solid fa-heart"></i>
                    </button>
                  </div>
                  <div className="p-4 flex flex-col flex-grow">
                    <h3 className="font-bold text-gray-800 line-clamp-2 mb-2 group-hover:text-[#16A085] transition-colors">{product.name}</h3>
                    <div className="mt-auto">
                      <p className="text-[#16A085] font-black text-lg">฿{((product.variants?.[0]?.priceAmountMinor || 0) / 100).toLocaleString()}</p>
                    </div>
                  </div>
                  <Link href={`/products/${product.id}`} className="absolute inset-0 z-0"></Link>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </main>

      <Footer />
      <MobileNav />
    </div>
  );
}
