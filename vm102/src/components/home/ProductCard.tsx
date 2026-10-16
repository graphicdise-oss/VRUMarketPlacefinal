"use client";

import Image from "next/image";

import { useState } from "react";
import { Product } from "@/types";
import { useCart } from "@/components/cart/CartProvider";
import { useToast } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useFavorite } from "@/lib/favorite-context";

import { useRouter } from "next/navigation";

interface ProductCardProps {
  product: Product;
  onViewDetail?: (product: Product) => void;
}

export default function ProductCard({ product, onViewDetail }: ProductCardProps) {
  const router = useRouter();
  const { addToCart } = useCart();
  const { showToast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorite();

  const defaultVariant = product.variants[0];
  const hasMultipleVariants = product.variants.length > 1;
  const minPriceMinor = Math.min(...product.variants.map((v) => v.priceMinor));

  const handleAddToCart = () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบเพื่อสั่งซื้อสินค้า");
      router.push("/login");
      return;
    }
    
    if (user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') {
      showToast("ไม่สามารถทำรายการสั่งซื้อได้เนื่องจากคุณอยู่ในสิทธิ์ผู้ดูแลระบบ", "error");
      return;
    }
    
    if (hasMultipleVariants) {
      if (onViewDetail) onViewDetail(product);
      else router.push(`/products/${product.id}`);
      return;
    }
    addToCart({
      productId: product.id,
      variantId: defaultVariant.id,
      variantName: defaultVariant.name,
      name: product.name,
      priceMinor: defaultVariant.priceMinor,
      image: product.images[0],
      shopId: product.shopId,
      shopName: product.shopName,
      qty: 1,
    });
    showToast(`เพิ่ม "${product.name}" ลงตะกร้าแล้ว`);
  };

  const isInnovation = product.categoryId === "cat-5";
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);

  const viewDetails = () => {
    if (onViewDetail) onViewDetail(product);
    else router.push(`/products/${product.id}`);
  };

  return (
    <div 
      onClick={viewDetails}
      className={`product-card bg-white rounded-2xl shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1.5 transition-all duration-300 border border-gray-100 overflow-hidden flex flex-col group relative cursor-pointer h-full`}
    >
      {/* Badges */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
        {isInnovation && (
          <span className="bg-[#16A085] text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm">นวัตกรรม มรว.</span>
        )}
        {totalStock <= 5 && totalStock > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm">เหลือน้อย!</span>
        )}
        {product.communityName && (
          <span className="bg-[#D4F1BB] text-[#16A085] text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm">{product.communityName}</span>
        )}
      </div>

      {/* Favorite Button */}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          if (!isAuthenticated) {
            showToast("กรุณาเข้าสู่ระบบเพื่อเพิ่มสินค้าที่ถูกใจ");
            router.push("/login");
            return;
          }
          toggleFavorite(product.id);
        }}
        className={`absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm
          ${isFavorite(product.id) 
            ? 'bg-red-50 text-red-500 scale-110' 
            : 'bg-white/90 backdrop-blur-sm text-gray-400 hover:text-red-500 hover:scale-110'}`}
        title={isFavorite(product.id) ? "ลบออกจากรายการที่ถูกใจ" : "เพิ่มลงรายการที่ถูกใจ"}
      >
        <i className={`${isFavorite(product.id) ? 'fa-solid' : 'fa-regular'} fa-heart`}></i>
      </button>

      {/* Image */}
      <div className="relative pt-[100%] bg-gray-50 overflow-hidden">
        <Image src={product.images[0] || '/placeholder.png'} fill className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" alt={product.name} sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300"></div>
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col flex-grow bg-white">
        <h4 className="text-sm font-bold text-gray-800 line-clamp-2 mb-2 h-10 group-hover:text-[#16A085] transition">{product.name}</h4>
        <div className="flex flex-col gap-1.5 mb-2">
          <div className="flex items-center text-[11px] text-gray-500">
            <i className="fa-solid fa-store w-4 text-gray-300"></i>
            <span className="font-medium text-gray-600 truncate">{product.shopName}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span><i className="fa-solid fa-tag text-gray-300 mr-1"></i>{product.categoryName}</span>
            <span><i className="fa-solid fa-bag-shopping mr-1"></i>ขายแล้ว {(product.soldCount || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Price & Add to Cart */}
        <div className="mt-auto pt-3 flex items-end justify-between">
          <div>
            {hasMultipleVariants && <div className="text-[10px] text-gray-400 mb-0.5">เริ่มต้นที่</div>}
            {hasMultipleVariants ? (
              <span className="text-[#16A085] font-black text-lg">{formatPrice(minPriceMinor)}</span>
            ) : (
              <span className="text-[#16A085] font-black text-lg">{formatPrice(defaultVariant.priceMinor)}</span>
            )}
          </div>

          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddToCart();
            }}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#16A085]/10 text-[#16A085] flex items-center justify-center hover:bg-[#16A085] hover:text-white transition-all duration-200 shadow-sm hover:shadow-md active:scale-90 opacity-100 md:opacity-0 md:group-hover:opacity-100 transform md:translate-y-2 md:group-hover:translate-y-0 cursor-pointer"
            title="เพิ่มลงตะกร้า"
          >
            <i className="fa-solid fa-cart-plus text-xs sm:text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  );
}