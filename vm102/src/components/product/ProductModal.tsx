"use client";

import Image from "next/image";

import { useState } from "react";
import Link from "next/link";
import { Product, ProductVariant } from "@/types";
import { useCart } from "@/components/cart/CartProvider";
import { useToast } from "@/components/ui/Toast";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

interface ProductModalProps {
  product: Product;
  onClose: () => void;
}

export default function ProductModal({ product, onClose }: ProductModalProps) {
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant>(product.variants[0]);
  const { addToCart } = useCart();
  const { showToast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();

  const handleAdd = () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบเพื่อสั่งซื้อสินค้า");
      router.push("/login");
      return;
    }

    if (user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') {
      showToast("ไม่สามารถทำรายการสั่งซื้อได้เนื่องจากคุณอยู่ในสิทธิ์ผู้ดูแลระบบ", "error");
      return;
    }
    
    if (selectedVariant.stock < qty) {
      showToast("สต็อกไม่พอ กรุณาลดจำนวน");
      return;
    }
    addToCart({
      productId: product.id,
      variantId: selectedVariant.id,
      variantName: selectedVariant.name,
      name: product.name,
      priceMinor: selectedVariant.priceMinor,
      image: product.images[0],
      shopId: product.shopId,
      shopName: product.shopName,
      qty,
    });
    showToast(`เพิ่ม "${product.name}" (${selectedVariant.name}) ${qty} ชิ้นลงตะกร้าแล้ว`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 transition-opacity duration-300" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col relative" onClick={(e) => e.stopPropagation()}>
        {/* Header (Floating Close Button) */}
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-sm hover:shadow-md z-10">
          <i className="fa-solid fa-xmark text-xl"></i>
        </button>

        {/* Content */}
        <div className="flex flex-col md:flex-row overflow-y-auto">
          {/* Left: Image Section */}
          <div className="md:w-1/2 p-6 bg-gray-50 flex flex-col">
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-4 shadow-sm group">
              <Image src={product.images[activeImage] || '/placeholder.png'} alt={product.name} fill className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 50vw" />
              {product.images.length > 1 && (
                <div className="absolute bottom-2.5 right-2.5 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded-full pointer-events-none">
                  {activeImage + 1} / {product.images.length}
                </div>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-2.5 overflow-x-auto hide-scrollbar pb-2 px-0.5">
                {product.images.map((img, idx) => {
                  const isActive = activeImage === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveImage(idx)}
                      onMouseEnter={() => setActiveImage(idx)}
                      className={`relative w-14 h-14 flex-shrink-0 rounded-xl overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
                        isActive
                          ? "border-[#16A085] shadow-md ring-2 ring-[#16A085]/20 scale-105"
                          : "border-gray-200 opacity-60 hover:opacity-100 hover:border-gray-400"
                      }`}
                    >
                      <Image src={img || '/placeholder.png'} alt={`${product.name} ${idx + 1}`} fill className="object-cover" sizes="56px" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Info Section */}
          <div className="md:w-1/2 p-6 md:p-8 flex flex-col bg-white">
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              {product.communityName && (
                <span className="bg-[#D4F1BB]/50 text-[#16A085] text-[10px] font-bold px-3 py-1 rounded-full shadow-sm">
                  {product.communityName}
                </span>
              )}
              {product.categoryId === "cat-5" && (
                <span className="bg-[#16A085] text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm">
                  นวัตกรรม มรว.
                </span>
              )}
            </div>

            <h4 className="font-bold text-2xl text-gray-800 mb-2 leading-tight">{product.name}</h4>
            
            <div className="flex items-center gap-4 text-sm text-gray-500 mb-4 pb-4 border-b border-gray-100">
              <span className="flex items-center gap-1"><i className="fa-solid fa-store text-gray-400"></i> {product.shopName}</span>
              <span className="text-gray-300">|</span>
              {product.categoryName && (
                <span className="flex items-center gap-1"><i className="fa-solid fa-tag text-[#16A085]/60"></i> {product.categoryName}</span>
              )}
            </div>

            {/* Price */}
            <div className="mb-6">
              <div className="text-[#16A085] font-bold text-4xl mb-1">{formatPrice(selectedVariant.priceMinor)}</div>
              <div className="text-xs text-gray-400">
                คงเหลือ {selectedVariant.stock} ชิ้น
                {selectedVariant.stock <= 5 && selectedVariant.stock > 0 && (
                  <span className="text-red-500 font-bold ml-2 bg-red-50 px-2 py-0.5 rounded-full">เหลือน้อย!</span>
                )}
              </div>
            </div>

            {/* Variant Selector */}
            {product.variants.length > 1 && (
              <div className="mb-6">
                <span className="text-sm font-bold text-gray-700 mb-3 block">เลือกรูปแบบ:</span>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((variant) => (
                    <button
                      key={variant.id}
                      onClick={() => { setSelectedVariant(variant); setQty(1); }}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                        selectedVariant.id === variant.id
                          ? "border-[#16A085] bg-[#D4F1BB]/20 text-[#16A085] shadow-sm"
                          : "border-gray-100 bg-white text-gray-500 hover:border-[#16A085]/50"
                      } ${variant.stock === 0 ? "opacity-40 cursor-not-allowed" : ""}`}
                      disabled={variant.stock === 0}
                    >
                      {variant.name}
                      {variant.stock === 0 && " (หมด)"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="mb-8">
              <span className="text-sm font-bold text-gray-700 mb-3 block">จำนวน:</span>
              <div className="flex items-center w-max bg-gray-50 border border-gray-100 rounded-full p-1 shadow-inner">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-10 flex items-center justify-center bg-white rounded-full text-gray-500 hover:text-[#16A085] transition shadow-sm">-</button>
                <span className="text-sm font-bold w-12 text-center text-gray-700">{qty}</span>
                <button onClick={() => setQty(Math.min(selectedVariant.stock, qty + 1))} className="w-10 h-10 flex items-center justify-center bg-white rounded-full text-gray-500 hover:text-[#16A085] transition shadow-sm">+</button>
              </div>
            </div>

            {/* Description (Truncated/Scrollable if too long) */}
            <div className="mb-6 text-sm text-gray-600 flex-grow max-h-24 overflow-y-auto hide-scrollbar">
              <span className="font-bold text-gray-700 block mb-1">รายละเอียดสินค้า:</span>
              {product.description || "ผลิตภัณฑ์คุณภาพจากชุมชน ผลิตด้วยความใส่ใจและใช้วัสดุจากธรรมชาติ เพื่อสร้างความยั่งยืนให้กับท้องถิ่น"}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 mt-auto pt-4 border-t border-gray-100">
              <button
                onClick={handleAdd}
                disabled={selectedVariant.stock === 0}
                className="w-full btn-minimal text-white rounded-full text-sm font-bold py-3.5 flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className="fa-solid fa-cart-plus text-lg"></i> เพิ่มลงตะกร้า
              </button>
              <div className="flex gap-3">
                <Link href={`/chat`} className="flex-1 bg-white border-2 border-gray-200 text-gray-600 hover:border-[#16A085] hover:text-[#16A085] rounded-full text-sm font-bold py-3 flex items-center justify-center gap-2 transition text-center shadow-sm hover:shadow-md">
                  <i className="fa-regular fa-message text-lg"></i> แชท
                </Link>
                <Link href={`/products/${product.id}`} className="flex-1 bg-gray-100 border-2 border-gray-100 text-gray-600 hover:border-gray-300 hover:text-gray-800 rounded-full text-sm font-bold py-3 flex items-center justify-center gap-2 transition text-center shadow-sm hover:shadow-md">
                  <i className="fa-solid fa-arrow-up-right-from-square text-lg"></i> ดูรายละเอียดเต็ม
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}