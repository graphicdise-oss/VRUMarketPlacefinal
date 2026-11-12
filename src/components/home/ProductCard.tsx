"use client";

import Image from "next/image";

import { Product } from "@/types";
import { useCart } from "@/components/cart/CartProvider";
import { useToast } from "@/components/ui/Toast";
import { formatPrice, getErrorMessage } from "@/lib/utils";
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

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบเพื่อสั่งซื้อสินค้า");
      router.push("/login");
      return;
    }

    if (!user?.emailVerified) {
      showToast("กรุณายืนยันอีเมลของคุณก่อนเพิ่มสินค้าลงตะกร้า", "error");
      router.push("/verify-email");
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
    try {
      await addToCart({
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
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "ไม่สามารถเพิ่มสินค้าลงตะกร้าได้"), "error");
    }
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
      {/* Badges - bounded with max-width and truncate to avoid clashing with favorite icon */}
      <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-10 flex flex-col gap-1 max-w-[calc(100%-44px)] sm:max-w-[calc(100%-48px)]">
        {isInnovation && (
          <span className="bg-[#16A085] text-white text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full shadow-sm truncate block">
            นวัตกรรม มรว.
          </span>
        )}
        {totalStock <= 5 && totalStock > 0 && (
          <span className="bg-red-500 text-white text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full shadow-sm truncate block">
            เหลือน้อย!
          </span>
        )}
        {product.communityName && (
          <span
            className="bg-[#D4F1BB] text-[#16A085] text-[9px] sm:text-[10px] font-bold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full shadow-sm truncate block max-w-full"
            title={product.communityName}
          >
            {product.communityName}
          </span>
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
        className={`absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-10 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm
          ${isFavorite(product.id)
            ? 'bg-red-50 text-red-500 scale-110'
            : 'bg-white/90 backdrop-blur-sm text-gray-400 hover:text-red-500 hover:scale-110'}`}
        title={isFavorite(product.id) ? "ลบออกจากรายการที่ถูกใจ" : "เพิ่มลงรายการที่ถูกใจ"}
      >
        <i className={`${isFavorite(product.id) ? 'fa-solid' : 'fa-regular'} fa-heart text-xs sm:text-sm`}></i>
      </button>

      {/* Image */}
      <div className="relative pt-[100%] bg-gray-50 overflow-hidden">
        <Image src={product.images[0] || '/placeholder.png'} fill className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" alt={product.name} sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300"></div>
      </div>

      {/* Info - Responsive padding and truncation */}
      <div className="p-2.5 sm:p-4 flex flex-col flex-grow bg-white">
        <h4 className="text-xs sm:text-sm font-bold text-gray-800 line-clamp-2 mb-1.5 sm:mb-2 min-h-[2rem] sm:min-h-[2.5rem] group-hover:text-[#16A085] transition leading-snug">
          {product.name}
        </h4>
        <div className="flex flex-col gap-1 sm:gap-1.5 mb-2">
          {/* Shop */}
          <div className="flex items-center text-[10px] sm:text-[11px] text-gray-500 min-w-0">
            <i className="fa-solid fa-store text-[9px] sm:text-[10px] text-gray-300 mr-1 flex-shrink-0"></i>
            <span className="font-medium text-gray-600 truncate">{product.shopName}</span>
          </div>

          {/* Category & Sold Count */}
          <div className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] text-gray-400 min-w-0">
            <span className="truncate flex items-center min-w-0" title={product.categoryName}>
              <i className="fa-solid fa-tag text-gray-300 mr-1 flex-shrink-0 text-[8px] sm:text-[9px]"></i>
              <span className="truncate">{product.categoryName}</span>
            </span>
            <span className="flex-shrink-0 whitespace-nowrap text-right text-[9px] sm:text-[10px]">
              <i className="fa-solid fa-bag-shopping mr-0.5 sm:mr-1 text-[8px] sm:text-[9px]"></i>
              ขายแล้ว {(product.soldCount || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Price & Add to Cart */}
        <div className="mt-auto pt-2 sm:pt-3 flex items-end justify-between gap-1">
          <div className="min-w-0">
            {hasMultipleVariants && <div className="text-[9px] sm:text-[10px] text-gray-400 mb-0.5 leading-none">เริ่มต้นที่</div>}
            <span className="text-[#16A085] font-black text-base sm:text-lg truncate block leading-tight">
              {formatPrice(hasMultipleVariants ? minPriceMinor : defaultVariant.priceMinor)}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddToCart();
            }}
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#16A085]/10 text-[#16A085] flex items-center justify-center hover:bg-[#16A085] hover:text-white transition-all duration-200 shadow-xs hover:shadow-md active:scale-90 flex-shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transform md:translate-y-2 md:group-hover:translate-y-0 cursor-pointer"
            title="เพิ่มลงตะกร้า"
          >
            <i className="fa-solid fa-cart-plus text-[11px] sm:text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  );
}