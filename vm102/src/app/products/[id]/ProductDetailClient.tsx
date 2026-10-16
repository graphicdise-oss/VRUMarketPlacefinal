"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Product, ProductVariant } from "@/types";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import { useCart } from "@/components/cart/CartProvider";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { productApi, communityApi } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";
import { reviewApi, type Review } from "@/lib/api-modules/review";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { formatPrice } from "@/lib/utils";
import { useFavorite } from "@/lib/favorite-context";

export default function ProductDetailClient({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  const handlePrevImage = useCallback(() => {
    if (!product || product.images.length <= 1) return;
    setActiveImage((prev) => (prev > 0 ? prev - 1 : product.images.length - 1));
  }, [product]);

  const handleNextImage = useCallback(() => {
    if (!product || product.images.length <= 1) return;
    setActiveImage((prev) => (prev < product.images.length - 1 ? prev + 1 : 0));
  }, [product]);

  const scrollThumbnails = (direction: "left" | "right") => {
    if (thumbnailsRef.current) {
      const scrollAmount = direction === "left" ? -160 : 160;
      thumbnailsRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (thumbnailsRef.current && thumbnailsRef.current.children[activeImage]) {
      const activeEl = thumbnailsRef.current.children[activeImage] as HTMLElement;
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeImage]);

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const { addToCart } = useCart();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorite();

  useEffect(() => {
    const fetchProduct = async () => {
      setIsLoading(true);
      try {
        const p = await productApi.getPublicById(productId);
        
        // Community name is best-effort: a failed lookup must not break the product page.
        const community = await communityApi.getById(p.communityId).catch(() => null);
        const mappedProduct: Product = mapPublicProductDto(p, community?.name ?? "");
        
        setProduct(mappedProduct);
        setIsLoading(false);
        
        // Fetch reviews
        setLoadingReviews(true);
        try {
          const reviewsData = await reviewApi.listForShop(p.shopId, { limit: 5 });
          setReviews(reviewsData.items);
        } catch (error) {
          console.error("Failed to fetch reviews:", error);
        } finally {
          setLoadingReviews(false);
        }
      } catch (error) {
        console.error("Failed to fetch product:", error);
        setProduct(null);
        setIsLoading(false);
      }
    };
    fetchProduct();
  }, [productId]);



  const handleReviewClick = () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบก่อนทำการรีวิว");
      router.push("/login");
      return;
    }
    showToast("กรุณาไปที่หน้ารายการสั่งซื้อของคุณ เพื่อทำการรีวิวสินค้าที่ได้รับแล้ว", "info");
    router.push("/orders");
  };

  const handleAddToCart = () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบเพื่อสั่งซื้อสินค้า");
      router.push("/login");
      return false;
    }

    if (user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') {
      showToast("ไม่สามารถทำรายการสั่งซื้อได้เนื่องจากคุณอยู่ในสิทธิ์ผู้ดูแลระบบ", "error");
      return false;
    }
    
    if (!selectedVariant) {
      showToast("กรุณาเลือกตัวเลือกสินค้าก่อน");
      return;
    }
    
    if (!product) return;
    
    addToCart({
      productId: product.id,
      shopId: product.shopId,
      shopName: product.shopName,
      variantId: selectedVariant.id,
      name: product.name,
      variantName: selectedVariant.name,
      priceMinor: selectedVariant.priceMinor,
      qty: quantity,
      image: product.images[0]
    });
    
    showToast(`เพิ่ม "${product.name}" (${selectedVariant.name}) ${quantity} ชิ้นลงตะกร้าแล้ว`);
    return true;
  };

  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanNativeShare(true);
    }
  }, []);

  const openShareWindow = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=550");
  };

  const handleShareFacebook = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
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

  const handleShareLine = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    openShareWindow(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`);
  };

  const handleShareTwitter = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = product ? product.name : "สินค้าชุมชน VRU Marketplace";
    openShareWindow(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  };

  const handleSharePinterest = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const media = product && product.images[0] ? product.images[0] : "";
    const desc = product ? product.name : "สินค้าชุมชน VRU Marketplace";
    openShareWindow(`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&media=${encodeURIComponent(media)}&description=${encodeURIComponent(desc)}`);
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
      showToast("คัดลอกลิงก์สินค้าเรียบร้อยแล้ว");
    } catch {
      showToast("ไม่สามารถคัดลอกลิงก์ได้", "error");
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share && product) {
      try {
        await navigator.share({
          title: product.name,
          text: `สั่งซื้อ ${product.name} บน VRU Marketplace`,
          url: window.location.href,
        });
      } catch {
        // User closed the share sheet
      }
    } else {
      handleCopyLink();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center flex-col">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085] mb-4"></i>
          <p className="text-gray-500 font-bold">กำลังโหลดข้อมูลสินค้า...</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center flex-col">
          <i className="fa-solid fa-box-open text-6xl text-gray-300 mb-4"></i>
          <h2 className="text-xl font-bold text-gray-800">ไม่พบสินค้า</h2>
          <p className="text-gray-500 mt-2">สินค้านี้อาจถูกลบหรือหยุดขายไปแล้ว</p>
          <Link href="/products" className="mt-6 text-[#16A085] font-bold hover:underline">
            กลับไปดูสินค้าทั้งหมด
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-6xl mx-auto w-full px-4 py-6 md:py-8">
        <Breadcrumb items={[
          { label: "ผลิตภัณฑ์ชุมชน", href: "/products" },
          { label: product.categoryName || "หมวดหมู่", href: `/products?category=${product.categoryId}` },
          { label: product.name }
        ]} />

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-10 mb-8">
          <div className="flex flex-col md:flex-row gap-10">
            
            {/* Gallery (Shopee/Lazada style with thumbnail strip & arrows) */}
            <div className="md:w-5/12 flex flex-col gap-3">
              {/* Main Image with Navigation Arrows */}
              <div className="aspect-square rounded-3xl overflow-hidden border border-gray-100 bg-gray-50 shadow-sm relative group select-none">
                <img 
                  src={product.images[activeImage] || "/placeholder.png"} 
                  alt={product.name} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                />
                
                {/* Arrow buttons on main image (visible when > 1 image) */}
                {product.images.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="รูปก่อนหน้า"
                      onClick={handlePrevImage}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/80 hover:bg-white text-gray-700 hover:text-[#16A085] shadow-md flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
                    >
                      <i className="fa-solid fa-chevron-left text-xs md:text-sm"></i>
                    </button>
                    <button
                      type="button"
                      aria-label="รูปถัดไป"
                      onClick={handleNextImage}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/80 hover:bg-white text-gray-700 hover:text-[#16A085] shadow-md flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
                    >
                      <i className="fa-solid fa-chevron-right text-xs md:text-sm"></i>
                    </button>

                    {/* Image index counter badge */}
                    <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm pointer-events-none">
                      {activeImage + 1} / {product.images.length}
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnails row with horizontal scroll controls */}
              {product.images.length > 1 && (
                <div className="relative flex items-center gap-1 group/thumbs">
                  {/* Left scroll arrow for thumbnails */}
                  <button
                    type="button"
                    aria-label="เลื่อนรูปย่อไปทางซ้าย"
                    onClick={() => scrollThumbnails("left")}
                    className="w-7 h-7 flex-shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#16A085] flex items-center justify-center text-xs transition shadow-xs disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-left text-[10px]"></i>
                  </button>

                  {/* Thumbnails scroll container */}
                  <div
                    ref={thumbnailsRef}
                    className="flex gap-2.5 overflow-x-auto hide-scrollbar py-1 px-1 scroll-smooth flex-grow"
                  >
                    {product.images.map((img, idx) => {
                      const isActive = activeImage === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveImage(idx)}
                          onMouseEnter={() => setActiveImage(idx)}
                          className={`w-16 h-16 sm:w-18 sm:h-18 flex-shrink-0 rounded-2xl overflow-hidden transition-all duration-200 cursor-pointer ${
                            isActive
                              ? "border-2 border-[#16A085] shadow-md ring-2 ring-[#16A085]/20 scale-105"
                              : "border-2 border-gray-100 opacity-60 hover:opacity-100 hover:border-gray-300"
                          }`}
                        >
                          <img src={img} alt={`รูปที่ ${idx + 1}`} className="w-full h-full object-cover" />
                        </button>
                      );
                    })}
                  </div>

                  {/* Right scroll arrow for thumbnails */}
                  <button
                    type="button"
                    aria-label="เลื่อนรูปย่อไปทางขวา"
                    onClick={() => scrollThumbnails("right")}
                    className="w-7 h-7 flex-shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#16A085] flex items-center justify-center text-xs transition shadow-xs disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-right text-[10px]"></i>
                  </button>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="md:w-7/12 flex flex-col">
              {/* Top Row: Community/Category Badges on left, Social Share & Wishlist on top-right (บนขวาสุด ชิดขวา ไม่ตกบรรทัด) */}
              <div className="flex items-center justify-between gap-2 sm:gap-3 mb-2 w-full">
                {/* Left Badges */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  {product.communityName && (
                    <span className="bg-[#D4F1BB]/50 text-[#16A085] text-[10px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full shadow-2xs">
                      {product.communityName}
                    </span>
                  )}
                  {product.categoryId === "cat-5" && (
                    <span className="bg-[#16A085] text-white text-[10px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full shadow-2xs">
                      นวัตกรรม มรว.
                    </span>
                  )}
                </div>

                {/* Top-Right Actions: Social Share & Wishlist (บนขวาสุด ชิดขวาเสมอ) */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto">
                  {/* Share pill cluster */}
                  <div className="flex items-center gap-1 bg-gray-50/90 hover:bg-gray-50 p-1 rounded-full border border-gray-200/80 shadow-2xs">
                    <span className="text-[11px] font-bold text-gray-400 pl-2 pr-0.5 hidden xl:inline">แชร์:</span>

                    {/* Messenger */}
                    <button 
                      type="button" 
                      onClick={handleShareMessenger}
                      title="แชร์ไปยัง Messenger"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#0099FF]/10 text-[#0099FF] hover:bg-[#0099FF] hover:text-white transition-all flex items-center justify-center text-xs sm:text-sm active:scale-95 shadow-2xs"
                    >
                      <i className="fa-brands fa-facebook-messenger"></i>
                    </button>

                    {/* Facebook */}
                    <button 
                      type="button" 
                      onClick={handleShareFacebook}
                      title="แชร์ไปยัง Facebook"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2] hover:text-white transition-all flex items-center justify-center text-xs sm:text-sm active:scale-95 shadow-2xs"
                    >
                      <i className="fa-brands fa-facebook-f"></i>
                    </button>

                    {/* LINE */}
                    <button 
                      type="button" 
                      onClick={handleShareLine}
                      title="แชร์ไปยัง LINE"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#06C755]/10 text-[#06C755] hover:bg-[#06C755] hover:text-white transition-all flex items-center justify-center text-sm sm:text-base active:scale-95 shadow-2xs"
                    >
                      <i className="fa-brands fa-line"></i>
                    </button>

                    {/* X (Twitter) */}
                    <button 
                      type="button" 
                      onClick={handleShareTwitter}
                      title="แชร์ไปยัง X (Twitter)"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/5 text-gray-800 hover:bg-black hover:text-white transition-all flex items-center justify-center active:scale-95 shadow-2xs"
                    >
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    </button>

                    {/* Pinterest */}
                    <button 
                      type="button" 
                      onClick={handleSharePinterest}
                      title="ปักพิน Pinterest"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#BD081C]/10 text-[#BD081C] hover:bg-[#BD081C] hover:text-white transition-all flex items-center justify-center text-xs sm:text-sm active:scale-95 shadow-2xs"
                    >
                      <i className="fa-brands fa-pinterest-p"></i>
                    </button>

                    {/* Copy Link */}
                    <button 
                      type="button" 
                      onClick={handleCopyLink}
                      title="คัดลอกลิงก์สินค้า"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-200/80 text-gray-700 hover:bg-[#16A085] hover:text-white transition-all flex items-center justify-center text-xs active:scale-95 shadow-2xs"
                    >
                      <i className="fa-solid fa-link"></i>
                    </button>

                    {/* Native Mobile Share (Shown when navigator.share is available) */}
                    {canNativeShare && (
                      <button 
                        type="button" 
                        onClick={handleNativeShare}
                        title="แชร์ผ่านอุปกรณ์"
                        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#D4F1BB] text-[#16A085] hover:bg-[#16A085] hover:text-white transition-all flex items-center justify-center text-xs active:scale-95 shadow-2xs sm:hidden"
                      >
                        <i className="fa-solid fa-share-nodes"></i>
                      </button>
                    )}
                  </div>

                  {/* Wishlist Button */}
                  <button 
                    onClick={() => {
                      if (!isAuthenticated) {
                        showToast("กรุณาเข้าสู่ระบบเพื่อเพิ่มสินค้าที่ถูกใจ");
                        router.push("/login");
                        return;
                      }
                      toggleFavorite(product.id);
                    }}
                    className={`flex-shrink-0 w-8 h-8 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border
                      ${isFavorite(product.id) 
                        ? 'bg-red-50 text-red-500 border-red-100 scale-105 shadow-red-100' 
                        : 'bg-white text-gray-400 border-gray-200 hover:text-red-500 hover:bg-red-50 hover:scale-105'}`}
                    title={isFavorite(product.id) ? "ลบออกจากรายการที่ถูกใจ" : "เพิ่มลงรายการที่ถูกใจ"}
                  >
                    <i className={`${isFavorite(product.id) ? 'fa-solid' : 'fa-regular'} fa-heart text-sm sm:text-base`}></i>
                  </button>
                </div>
              </div>

              {/* Star Rating & Sold Count */}
              <div className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-500 mb-3">
                <i className="fa-solid fa-star text-yellow-400"></i>
                <span className="font-bold text-gray-700">4.9</span>
                <span className="mx-1 text-gray-300">|</span>
                <span>ขายแล้ว 120 ชิ้น</span>
              </div>

              {/* Title Header */}
              <div className="mb-4">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-800 leading-snug">{product.name}</h1>
              </div>
              
              <div className="bg-[#D4F1BB]/20 border border-[#D4F1BB]/50 rounded-2xl p-5 mb-8 flex items-center gap-4">
                <p className="text-4xl font-black text-[#16A085] tracking-tight">
                  {selectedVariant ? formatPrice(selectedVariant.priceMinor) : (
                    product.variants.length > 1 
                      ? `${formatPrice(Math.min(...product.variants.map(v => v.priceMinor)))}`
                      : formatPrice(product.variants[0].priceMinor)
                  )}
                </p>
                {selectedVariant && selectedVariant.stock <= 5 && selectedVariant.stock > 0 && (
                  <span className="bg-red-50 text-red-500 border border-red-200 text-xs font-bold px-2 py-1 rounded-lg">เหลือน้อย!</span>
                )}
              </div>

              {/* Variants */}
              <div className="mb-8">
                <h3 className="text-sm font-bold text-gray-700 mb-3 block">ตัวเลือกสินค้า: {selectedVariant ? <span className="text-[#16A085] ml-2">{selectedVariant.name}</span> : ""}</h3>
                <div className="flex flex-wrap gap-3">
                  {product.variants.map(variant => {
                    const isSelected = selectedVariant?.id === variant.id;
                    const isOutOfStock = variant.stock <= 0;
                    return (
                      <button 
                        key={variant.id}
                        disabled={isOutOfStock}
                        onClick={() => {
                          setSelectedVariant(variant);
                          if (quantity > variant.stock) setQuantity(variant.stock);
                        }}
                        className={`px-5 py-2.5 rounded-xl border-2 text-sm font-bold transition-all shadow-sm
                          ${isOutOfStock ? "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed shadow-none" : 
                            isSelected ? "border-[#16A085] bg-white text-[#16A085] ring-2 ring-[#16A085]/20" : "border-gray-100 bg-white text-gray-600 hover:border-[#16A085]/50 hover:text-[#16A085]"
                          }`}
                      >
                        {variant.name} {isOutOfStock && "(หมด)"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quantity */}
              <div className="mb-10 flex flex-col gap-3">
                <h3 className="text-sm font-bold text-gray-700 block">จำนวน:</h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-1 shadow-inner w-max">
                    <button 
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-500 hover:text-[#16A085] transition disabled:opacity-50"
                      disabled={quantity <= 1}
                    >
                      <i className="fa-solid fa-minus text-sm"></i>
                    </button>
                    <span className="w-12 text-center font-bold text-gray-800 text-lg">{quantity}</span>
                    <button 
                      onClick={() => {
                        const max = selectedVariant ? selectedVariant.stock : 999;
                        setQuantity(Math.min(max, quantity + 1));
                      }}
                      className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-500 hover:text-[#16A085] transition disabled:opacity-50"
                      disabled={selectedVariant ? quantity >= selectedVariant.stock : false}
                    >
                      <i className="fa-solid fa-plus text-sm"></i>
                    </button>
                  </div>
                  <span className="text-sm text-gray-400 font-medium">
                    {selectedVariant ? `มีสินค้าทั้งหมด ${selectedVariant.stock} ชิ้น` : "กรุณาเลือกตัวเลือกเพื่อดูจำนวนสินค้า"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 mt-auto">
                <button 
                  onClick={handleAddToCart}
                  className="flex-1 bg-white hover:bg-gray-50 text-[#16A085] border-2 border-[#16A085] shadow-sm hover:shadow font-bold py-4 rounded-full transition-all flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-cart-plus text-lg"></i> เพิ่มลงตะกร้า
                </button>
                <button 
                  onClick={() => {
                    if(handleAddToCart()) {
                      router.push(`/checkout?shopId=${product.shopId}`);
                    }
                  }}
                  className="flex-1 btn-minimal text-white shadow-md font-bold py-4 rounded-full transition-all flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-bag-shopping text-lg"></i> ซื้อสินค้าตอนนี้
                </button>
              </div>

            </div>
          </div>
        </div>

        {/* Shop Info & Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#D4F1BB]/50 flex items-center justify-center text-[#16A085]">
                  <i className="fa-solid fa-file-lines"></i>
                </div>
                รายละเอียดสินค้า
              </h3>
              <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-line leading-relaxed">
                {product.description}
              </div>
            </div>
            
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              <h3 className="text-xl font-bold text-gray-800 mb-6 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#D4F1BB]/50 flex items-center justify-center text-[#16A085]">
                    <i className="fa-solid fa-star"></i>
                  </div>
                  รีวิวจากผู้ซื้อ ({loadingReviews ? '...' : reviews.length})
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handleReviewClick} className="text-sm bg-white border border-[#16A085] text-[#16A085] hover:bg-[#D4F1BB]/30 font-bold px-4 py-1.5 rounded-full transition-all flex items-center gap-2">
                    <i className="fa-solid fa-pen"></i> เขียนรีวิว
                  </button>
                  {reviews.length > 0 && <span className="text-sm text-[#16A085] font-bold cursor-pointer hover:underline">ดูทั้งหมด</span>}
                </div>
              </h3>
              <div className="divide-y divide-gray-50">
                {loadingReviews ? (
                  <div className="py-10 text-center">
                    <i className="fa-solid fa-spinner fa-spin text-2xl text-[#16A085]"></i>
                  </div>
                ) : reviews.length > 0 ? (
                  reviews.map((review) => (
                    <div key={review.id} className="py-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-gradient-bg text-white rounded-full flex items-center justify-center text-sm font-bold shadow-inner">U</div>
                        <div>
                          <p className="text-sm font-bold text-gray-800">ผู้ซื้อที่ซ่อนชื่อ</p>
                          <div className="flex text-yellow-400 text-xs mt-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <i key={i} className={`fa-solid fa-star ${i < review.rating ? '' : 'text-gray-200'}`}></i>
                            ))}
                          </div>
                        </div>
                        <span className="ml-auto text-xs text-gray-400 font-medium">
                          {new Date(review.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      {review.text && <p className="text-sm text-gray-600 mb-2 pl-13">{review.text}</p>}
                      {review.images && review.images.length > 0 && (
                        <div className="flex gap-2 pl-13 mt-2">
                          {review.images.map((img) => (
                            <img key={img.id} src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/reviews/${review.id}/images/${img.id}`} alt="Review image" className="w-16 h-16 object-cover rounded-lg border border-gray-100" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-10 text-center text-gray-500">
                    <i className="fa-regular fa-comment-dots text-3xl mb-3 text-gray-300"></i>
                    <p className="text-sm font-bold">ยังไม่มีรีวิว</p>
                    <p className="text-xs mt-1">เป็นคนแรกที่รีวิวสินค้านี้สิ!</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Shop Card */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 sticky top-24">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-[#16A085] text-white rounded-2xl flex items-center justify-center text-2xl shadow-inner">
                  <i className="fa-solid fa-store"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">{product.shopName}</h3>
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 font-medium">
                    <i className="fa-solid fa-location-dot text-red-400"></i> จ.ปทุมธานี
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-center text-sm mb-6">
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 shadow-inner">
                  <p className="text-gray-500 text-xs mb-1 font-medium">สินค้าทั้งหมด</p>
                  <p className="font-black text-[#16A085] text-lg">12</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 shadow-inner">
                  <p className="text-gray-500 text-xs mb-1 font-medium">คะแนนร้าน</p>
                  <p className="font-black text-[#16A085] text-lg">4.9</p>
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                <Link href={`/shops/${product.shopId}`} className="w-full bg-white border-2 border-gray-200 hover:border-[#16A085] hover:text-[#16A085] text-gray-700 font-bold py-3.5 rounded-full text-sm transition text-center flex items-center justify-center gap-2 shadow-sm hover:shadow">
                  <i className="fa-solid fa-shop"></i> ไปที่ร้านค้า
                </Link>
                <Link href={`/chat`} className="w-full bg-[#D4F1BB]/30 text-[#16A085] hover:bg-[#D4F1BB]/60 font-bold py-3.5 rounded-full text-sm transition text-center flex items-center justify-center gap-2 shadow-sm hover:shadow">
                  <i className="fa-regular fa-message"></i> แชทกับร้าน
                </Link>
              </div>
            </div>
          </div>

        </div>

      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
