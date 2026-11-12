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
import { formatPrice, getErrorMessage } from "@/lib/utils";
import { useFavorite } from "@/lib/favorite-context";
import ProductDescription from "@/components/product/ProductDescription";
import ProductCard from "@/components/home/ProductCard";
import ProductImageLightbox from "@/components/product/ProductImageLightbox";

export default function ProductDetailClient({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const handlePrevImage = useCallback(() => {
    if (!product || product.images.length <= 1) return;
    setActiveImage((prev) => (prev > 0 ? prev - 1 : product.images.length - 1));
  }, [product]);

  const handleNextImage = useCallback(() => {
    if (!product || product.images.length <= 1) return;
    setActiveImage((prev) => (prev < product.images.length - 1 ? prev + 1 : 0));
  }, [product]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        handleNextImage();
      } else {
        handlePrevImage();
      }
    }
    touchStartX.current = null;
  };

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
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [, setLoadingRelated] = useState(false);
  const [allReviewsModalOpen, setAllReviewsModalOpen] = useState(false);
  const [allReviews, setAllReviews] = useState<Review[]>([]);
  const [loadingAllReviews, setLoadingAllReviews] = useState(false);
  const [selectedStarFilter, setSelectedStarFilter] = useState<number | null>(null);
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false);
  const [previewReviewImage, setPreviewReviewImage] = useState<string | null>(null);
  const { addToCart } = useCart();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorite();

  useEffect(() => {
    if (!product) return;
    const fetchRelated = async () => {
      setLoadingRelated(true);
      try {
        const res = await productApi.listPublic({ categoryId: product.categoryId, limit: 8 });
        let filtered = res.items.filter((item) => item.id !== product.id);

        if (filtered.length < 4) {
          const fallbackRes = await productApi.listPublic({ limit: 8 });
          const extra = fallbackRes.items.filter(
            (item) => item.id !== product.id && !filtered.some((f) => f.id === item.id)
          );
          filtered = [...filtered, ...extra];
        }

        const mapped = filtered.slice(0, 4).map((item) => mapPublicProductDto(item, ""));
        setRelatedProducts(mapped);
      } catch (err) {
        console.error("Failed to fetch related products:", err);
      } finally {
        setLoadingRelated(false);
      }
    };
    fetchRelated();
  }, [product]);

  const handleOpenAllReviews = async () => {
    if (!product) return;
    setAllReviewsModalOpen(true);
    setLoadingAllReviews(true);
    try {
      const res = await reviewApi.listForShop(product.shopId, { limit: 50 });
      setAllReviews(res.items);
    } catch (err) {
      console.error("Failed to fetch all reviews:", err);
      setAllReviews(reviews);
    } finally {
      setLoadingAllReviews(false);
    }
  };

  const baseReviews = allReviews.length > 0 ? allReviews : reviews;
  const photoReviewCount = baseReviews.filter((r) => r.images && r.images.length > 0).length;

  const filteredReviews = baseReviews.filter((rev) => {
    if (onlyWithPhotos && (!rev.images || rev.images.length === 0)) {
      return false;
    }
    if (selectedStarFilter !== null && rev.rating !== selectedStarFilter) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    const fetchProduct = async () => {
      setIsLoading(true);
      try {
        const p = await productApi.getPublicById(productId);

        // Community name is best-effort: a failed lookup must not break the product page.
        const community = await communityApi.getById(p.communityId).catch(() => null);
        const mappedProduct: Product = mapPublicProductDto(p, community?.name ?? "");

        setProduct(mappedProduct);
        if (mappedProduct.variants && mappedProduct.variants.length > 0) {
          const firstInStock = mappedProduct.variants.find((v) => v.stock > 0) || mappedProduct.variants[0];
          setSelectedVariant(firstInStock);
        }
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

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      showToast("กรุณาเข้าสู่ระบบเพื่อสั่งซื้อสินค้า");
      router.push("/login");
      return false;
    }

    if (!user?.emailVerified) {
      showToast("กรุณายืนยันอีเมลของคุณก่อนเพิ่มสินค้าลงตะกร้า", "error");
      router.push("/verify-email");
      return false;
    }

    if (user?.adminCommunityIds?.length || user?.role === 'SUPER_ADMIN') {
      showToast("ไม่สามารถทำรายการสั่งซื้อได้เนื่องจากคุณอยู่ในสิทธิ์ผู้ดูแลระบบ", "error");
      return false;
    }

    const variantToUse = selectedVariant || (product?.variants ? (product.variants.find((v) => v.stock > 0) || product.variants[0]) : null);

    if (!variantToUse) {
      showToast("กรุณาเลือกตัวเลือกสินค้าก่อน", "error");
      return false;
    }

    if (!product) return false;

    try {
      await addToCart({
        productId: product.id,
        shopId: product.shopId,
        shopName: product.shopName,
        variantId: variantToUse.id,
        name: product.name,
        variantName: variantToUse.name,
        priceMinor: variantToUse.priceMinor,
        qty: quantity,
        image: product.images[0]
      });
      showToast(`เพิ่ม "${product.name}" (${variantToUse.name}) ${quantity} ชิ้นลงตะกร้าแล้ว`);
      return true;
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "ไม่สามารถเพิ่มสินค้าลงตะกร้าได้"), "error");
      return false;
    }
  };

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
      <main className="flex-grow max-w-6xl mx-auto w-full px-3 sm:px-4 py-3 sm:py-6 md:py-8 pb-28 sm:pb-8">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-3.5 sm:p-6 md:p-10 mb-4 sm:mb-8">
          <div className="flex flex-col md:flex-row gap-5 md:gap-10">

            {/* Gallery (Shopee/Lazada style with thumbnail strip, swipe & arrows) */}
            <div className="md:w-5/12 flex flex-col gap-2.5 sm:gap-3">
              {/* Main Image with Navigation Arrows & Touch Swipe */}
              <div
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={() => setIsLightboxOpen(true)}
                className="aspect-square rounded-2xl sm:rounded-3xl overflow-hidden border border-gray-100 bg-gray-50 shadow-xs relative group select-none cursor-zoom-in"
                title="คลิกเพื่อดูภาพขยายแบบเต็มจอ"
              >
                {/* Floating Back Button (Shopee / Lazada style) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof window !== "undefined" && window.history.length > 1) {
                      router.back();
                    } else {
                      router.push("/products");
                    }
                  }}
                  aria-label="ย้อนกลับ"
                  title="ย้อนกลับ"
                  className="absolute top-2.5 sm:top-3.5 left-2.5 sm:left-3.5 z-20 w-8 h-8 sm:w-9.5 sm:h-9.5 rounded-full bg-white/90 hover:bg-white text-gray-700 hover:text-[#16A085] backdrop-blur-md shadow-md flex items-center justify-center transition-all active:scale-95 border border-white/60 cursor-pointer"
                >
                  <i className="fa-solid fa-arrow-left text-xs sm:text-sm"></i>
                </button>

                {/* Zoom hint badge */}
                <div className="absolute top-2.5 sm:top-3.5 right-2.5 sm:right-3.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-md text-white text-[10px] sm:text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1.5 pointer-events-none">
                  <i className="fa-solid fa-magnifying-glass-plus text-xs text-[#D4F1BB]"></i>
                  <span>คลิกดูภาพขยาย</span>
                </div>

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
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrevImage();
                      }}
                      className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/90 hover:bg-white text-gray-700 hover:text-[#16A085] shadow-md flex items-center justify-center transition-all opacity-90 sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110 active:scale-95 z-20"
                    >
                      <i className="fa-solid fa-chevron-left text-xs sm:text-sm"></i>
                    </button>
                    <button
                      type="button"
                      aria-label="รูปถัดไป"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNextImage();
                      }}
                      className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/90 hover:bg-white text-gray-700 hover:text-[#16A085] shadow-md flex items-center justify-center transition-all opacity-90 sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110 active:scale-95 z-20"
                    >
                      <i className="fa-solid fa-chevron-right text-xs sm:text-sm"></i>
                    </button>

                    {/* Image index counter badge */}
                    <div className="absolute bottom-2.5 right-2.5 sm:bottom-3 sm:right-3 bg-black/60 backdrop-blur-sm text-white text-[10px] sm:text-[11px] font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full shadow-xs pointer-events-none z-10">
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
                    className="w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#16A085] flex items-center justify-center text-xs transition shadow-2xs disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-left text-[9px] sm:text-[10px]"></i>
                  </button>

                  {/* Thumbnails scroll container */}
                  <div
                    ref={thumbnailsRef}
                    className="flex gap-2 sm:gap-2.5 overflow-x-auto hide-scrollbar py-1 px-1 scroll-smooth flex-grow"
                  >
                    {product.images.map((img, idx) => {
                      const isActive = activeImage === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveImage(idx)}
                          onMouseEnter={() => setActiveImage(idx)}
                          className={`w-13 h-13 sm:w-18 sm:h-18 flex-shrink-0 rounded-xl sm:rounded-2xl overflow-hidden transition-all duration-200 cursor-pointer ${isActive
                              ? "border-2 border-[#16A085] shadow-xs ring-2 ring-[#16A085]/20 scale-105"
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
                    className="w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-[#16A085] flex items-center justify-center text-xs transition shadow-2xs disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-right text-[9px] sm:text-[10px]"></i>
                  </button>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="md:w-7/12 flex flex-col">
              {/* Top Row: Community/Category Badges on left, Social Share & Wishlist on top-right */}
              <div className="flex items-center justify-between gap-2 mb-2 w-full">
                {/* Left Badges */}
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  {product.communityName && (
                    <span className="bg-[#D4F1BB]/60 text-[#16A085] text-xs font-bold px-3 py-1 rounded-full shadow-2xs max-w-[200px] sm:max-w-xs truncate" title={product.communityName}>
                      {product.communityName}
                    </span>
                  )}
                  {product.categoryId === "cat-5" && (
                    <span className="bg-[#16A085] text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-2xs whitespace-nowrap">
                      นวัตกรรม มรว.
                    </span>
                  )}
                </div>

                {/* Top-Right Actions: Mobile Share + Desktop Share Cluster + Wishlist */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto">
                  {/* Mobile Share Button (Single compact button with native share / copy link) */}
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    title="แชร์สินค้านี้"
                    className="md:hidden w-8 h-8 rounded-full bg-gray-100 hover:bg-[#D4F1BB]/50 text-gray-700 hover:text-[#16A085] transition-all flex items-center justify-center text-xs active:scale-95 shadow-2xs"
                  >
                    <i className="fa-solid fa-share-nodes"></i>
                  </button>

                  {/* Desktop Share pill cluster (visible on md+) */}
                  <div className="hidden md:flex items-center gap-1 bg-gray-50/90 hover:bg-gray-50 p-1 rounded-full border border-gray-200/80 shadow-2xs">
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
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
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
                    className={`flex-shrink-0 w-8 h-8 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xs border
                      ${isFavorite(product.id)
                        ? 'bg-red-50 text-red-500 border-red-100 scale-105 shadow-red-100'
                        : 'bg-white text-gray-400 border-gray-200 hover:text-red-500 hover:bg-red-50 hover:scale-105'}`}
                    title={isFavorite(product.id) ? "ลบออกจากรายการที่ถูกใจ" : "เพิ่มลงรายการที่ถูกใจ"}
                  >
                    <i className={`${isFavorite(product.id) ? 'fa-solid' : 'fa-regular'} fa-heart text-xs sm:text-base`}></i>
                  </button>
                </div>
              </div>

              {/* Star Rating & Sold Count */}
              <div className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-500 mb-2 sm:mb-3">
                <i className="fa-solid fa-star text-yellow-400"></i>
                <span className="font-bold text-gray-700">4.9</span>
                <span className="mx-1 text-gray-300">|</span>
                <span>ขายแล้ว 120 ชิ้น</span>
              </div>

              {/* Title Header */}
              <div className="mb-3 sm:mb-4">
                <h1 className="text-lg sm:text-2xl md:text-3xl font-bold text-gray-800 leading-snug">{product.name}</h1>
              </div>

              {/* Price Banner */}
              <div className="bg-[#D4F1BB]/20 border border-[#D4F1BB]/50 rounded-xl sm:rounded-2xl p-3 sm:p-5 mb-4 sm:mb-8 flex items-center gap-3 sm:gap-4">
                <p className="text-2xl sm:text-4xl font-black text-[#16A085] tracking-tight">
                  {selectedVariant ? formatPrice(selectedVariant.priceMinor) : (
                    product.variants.length > 1
                      ? `${formatPrice(Math.min(...product.variants.map(v => v.priceMinor)))}`
                      : formatPrice(product.variants[0].priceMinor)
                  )}
                </p>
                {selectedVariant && selectedVariant.stock <= 5 && selectedVariant.stock > 0 && (
                  <span className="bg-red-50 text-red-500 border border-red-200 text-[10px] sm:text-xs font-bold px-2 py-0.5 sm:py-1 rounded-lg">เหลือน้อย!</span>
                )}
              </div>

              {/* Variants */}
              <div className="mb-4 sm:mb-8">
                <h3 className="text-xs sm:text-sm font-bold text-gray-700 mb-2 sm:mb-3 block">
                  ตัวเลือกสินค้า: {selectedVariant ? <span className="text-[#16A085] ml-1 sm:ml-2">{selectedVariant.name}</span> : ""}
                </h3>
                <div className="flex flex-wrap gap-2 sm:gap-3">
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
                        className={`px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-xl border-2 text-xs sm:text-sm font-bold transition-all shadow-2xs
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
              <div className="mb-5 sm:mb-10 flex flex-col gap-2 sm:gap-3">
                <h3 className="text-xs sm:text-sm font-bold text-gray-700 block">จำนวน:</h3>
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-0.5 sm:p-1 shadow-inner w-max">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white shadow-2xs flex items-center justify-center text-gray-500 hover:text-[#16A085] transition disabled:opacity-50"
                      disabled={quantity <= 1}
                    >
                      <i className="fa-solid fa-minus text-xs sm:text-sm"></i>
                    </button>
                    <span className="w-10 sm:w-12 text-center font-bold text-gray-800 text-sm sm:text-lg">{quantity}</span>
                    <button
                      onClick={() => {
                        const max = selectedVariant ? selectedVariant.stock : 999;
                        setQuantity(Math.min(max, quantity + 1));
                      }}
                      className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white shadow-2xs flex items-center justify-center text-gray-500 hover:text-[#16A085] transition disabled:opacity-50"
                      disabled={selectedVariant ? quantity >= selectedVariant.stock : false}
                    >
                      <i className="fa-solid fa-plus text-xs sm:text-sm"></i>
                    </button>
                  </div>
                  <span className="text-xs sm:text-sm text-gray-400 font-medium">
                    {selectedVariant ? `มีสินค้าทั้งหมด ${selectedVariant.stock} ชิ้น` : "กรุณาเลือกตัวเลือกเพื่อดูจำนวนสินค้า"}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-4 mt-auto">
                <button
                  onClick={handleAddToCart}
                  className="flex-1 bg-white hover:bg-gray-50 text-[#16A085] border-2 border-[#16A085] shadow-xs hover:shadow-sm font-bold py-3 sm:py-4 rounded-xl sm:rounded-full transition-all flex items-center justify-center gap-2 text-sm sm:text-base active:scale-98"
                >
                  <i className="fa-solid fa-cart-plus text-base sm:text-lg"></i> เพิ่มลงตะกร้า
                </button>
                <button
                  onClick={async () => {
                    if (await handleAddToCart()) {
                      router.push("/checkout");
                    }
                  }}
                  className="flex-1 btn-minimal text-white shadow-sm hover:shadow-md font-bold py-3 sm:py-4 rounded-xl sm:rounded-full transition-all flex items-center justify-center gap-2 text-sm sm:text-base active:scale-98"
                >
                  <i className="fa-solid fa-bag-shopping text-base sm:text-lg"></i> ซื้อสินค้าตอนนี้
                </button>
              </div>

            </div>
          </div>
        </div>

        {/* Shop Info & Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
          <div className="lg:col-span-2 space-y-4 sm:space-y-8">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-4 sm:p-6 md:p-8">
              <h3 className="text-base sm:text-xl font-bold text-gray-800 mb-3 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#D4F1BB]/50 flex items-center justify-center text-[#16A085] text-xs sm:text-sm">
                  <i className="fa-solid fa-file-lines"></i>
                </div>
                รายละเอียดสินค้า
              </h3>
              <ProductDescription description={product.description} />
            </div>

            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-4 sm:p-6 md:p-8">
              <h3 className="text-base sm:text-xl font-bold text-gray-800 mb-4 sm:mb-6 flex justify-between items-center">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#D4F1BB]/50 flex items-center justify-center text-[#16A085] text-xs sm:text-sm">
                    <i className="fa-solid fa-star"></i>
                  </div>
                  รีวิวจากผู้ซื้อ ({loadingReviews ? '...' : reviews.length})
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <button onClick={handleReviewClick} className="text-xs sm:text-sm bg-white border border-[#16A085] text-[#16A085] hover:bg-[#D4F1BB]/30 font-bold px-3 sm:px-4 py-1 sm:py-1.5 rounded-full transition-all flex items-center gap-1.5">
                    <i className="fa-solid fa-pen text-[10px] sm:text-xs"></i> เขียนรีวิว
                  </button>
                  {reviews.length > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenAllReviews}
                      className="text-xs sm:text-sm text-[#16A085] font-bold hover:underline cursor-pointer bg-transparent border-none p-0 flex items-center gap-1"
                    >
                      ดูทั้งหมด <i className="fa-solid fa-chevron-right text-[10px]"></i>
                    </button>
                  )}
                </div>
              </h3>
              <div className="divide-y divide-gray-50">
                {loadingReviews ? (
                  <div className="py-10 text-center">
                    <i className="fa-solid fa-spinner fa-spin text-2xl text-[#16A085]"></i>
                  </div>
                ) : reviews.length > 0 ? (
                  reviews.map((review) => (
                    <div key={review.id} className="py-3.5 sm:py-5">
                      <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-bg text-white rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shadow-inner">U</div>
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-gray-800">ผู้ซื้อที่ซ่อนชื่อ</p>
                          <div className="flex text-yellow-400 text-[10px] sm:text-xs mt-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <i key={i} className={`fa-solid fa-star ${i < review.rating ? '' : 'text-gray-200'}`}></i>
                            ))}
                          </div>
                        </div>
                        <span className="ml-auto text-[10px] sm:text-xs text-gray-400 font-medium">
                          {new Date(review.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      {review.text && <p className="text-xs sm:text-sm text-gray-600 mb-2 pl-10.5 sm:pl-13">{review.text}</p>}
                      {review.images && review.images.length > 0 && (
                        <div className="flex gap-2 pl-10.5 sm:pl-13 mt-2 flex-wrap">
                          {review.images.map((img) => {
                            const imgUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/reviews/${review.id}/images/${img.id}`;
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => setPreviewReviewImage(imgUrl)}
                                className="focus:outline-hidden rounded-lg overflow-hidden border border-gray-100 hover:opacity-90 transition cursor-zoom-in shadow-2xs group"
                                title="คลิกเพื่อดูรูปภาพขนาดใหญ่"
                              >
                                <img
                                  src={imgUrl}
                                  alt="Review image"
                                  className="w-14 h-14 sm:w-16 sm:h-16 object-cover group-hover:scale-105 transition-transform duration-200"
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-8 sm:py-10 text-center text-gray-500">
                    <i className="fa-regular fa-comment-dots text-2xl sm:text-3xl mb-2 sm:mb-3 text-gray-300"></i>
                    <p className="text-xs sm:text-sm font-bold">ยังไม่มีรีวิว</p>
                    <p className="text-[11px] sm:text-xs mt-1">เป็นคนแรกที่รีวิวสินค้านี้สิ!</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Shop Card */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-4 sm:p-6 md:p-8 sticky top-24">
              <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#16A085] text-white rounded-xl sm:rounded-2xl flex items-center justify-center text-xl sm:text-2xl shadow-inner flex-shrink-0">
                  <i className="fa-solid fa-store"></i>
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-800 text-base sm:text-lg truncate">{product.shopName}</h3>
                  <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500 font-medium">
                    <i className="fa-solid fa-location-dot text-red-400"></i> จ.ปทุมธานี
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 text-center text-sm mb-4 sm:mb-6">
                <div className="bg-gray-50 p-2.5 sm:p-3 rounded-xl border border-gray-100 shadow-inner">
                  <p className="text-gray-500 text-[11px] sm:text-xs mb-0.5 font-medium">สินค้าทั้งหมด</p>
                  <p className="font-black text-[#16A085] text-base sm:text-lg">12</p>
                </div>
                <div className="bg-gray-50 p-2.5 sm:p-3 rounded-xl border border-gray-100 shadow-inner">
                  <p className="text-gray-500 text-[11px] sm:text-xs mb-0.5 font-medium">คะแนนร้าน</p>
                  <p className="font-black text-[#16A085] text-base sm:text-lg">4.9</p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 sm:gap-3">
                <Link href={`/shops/${product.shopId}`} className="w-full bg-white border-2 border-gray-200 hover:border-[#16A085] hover:text-[#16A085] text-gray-700 font-bold py-2.5 sm:py-3 rounded-full text-xs sm:text-sm transition text-center flex items-center justify-center gap-1.5 sm:gap-2 shadow-2xs hover:shadow-xs active:scale-95">
                  <i className="fa-solid fa-shop text-xs sm:text-sm"></i> ไปที่ร้านค้า
                </Link>
                <Link href={`/chat?shopId=${product.shopId}`} className="w-full bg-[#D4F1BB]/30 text-[#16A085] hover:bg-[#D4F1BB]/60 font-bold py-2.5 sm:py-3 rounded-full text-xs sm:text-sm transition text-center flex items-center justify-center gap-1.5 sm:gap-2 shadow-2xs hover:shadow-xs active:scale-95">
                  <i className="fa-regular fa-message text-xs sm:text-sm"></i> แชทกับร้าน
                </Link>
              </div>
            </div>
          </div>

        </div>

        {/* สินค้าที่คุณอาจจะสนใจ (4 รายการ เชื่อมโยงข้อมูลจริง) */}
        {relatedProducts.length > 0 && (
          <section className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-gray-200/70">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div>
                <span className="text-[10px] sm:text-[11px] font-bold text-[#16A085] tracking-wider uppercase block mb-0.5">
                  RECOMMENDED FOR YOU
                </span>
                <h3 className="text-lg sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <i className="fa-solid fa-sparkles text-amber-500 text-base sm:text-xl"></i>
                  สินค้าที่คุณอาจจะสนใจ
                </h3>
              </div>
              <Link
                href={`/products?category=${product.categoryId}`}
                className="text-xs sm:text-sm font-bold text-[#16A085] hover:text-[#117A65] hover:underline flex items-center gap-1 transition"
              >
                ดูสินค้าทั้งหมด <i className="fa-solid fa-chevron-right text-[10px]"></i>
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
              {relatedProducts.map((relProduct) => (
                <ProductCard key={relProduct.id} product={relProduct} />
              ))}
            </div>
          </section>
        )}

      </main>

      {/* Modal รีวิวทั้งหมดจากผู้ซื้อ */}
      {allReviewsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-800 text-base sm:text-lg flex items-center gap-2">
                  <i className="fa-solid fa-star text-yellow-400"></i>
                  รีวิวทั้งหมดจากผู้ซื้อ
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  คะแนนร้าน 4.9 • ทั้งหมด {allReviews.length > 0 ? allReviews.length : reviews.length} รีวิว
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllReviewsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center transition cursor-pointer"
                aria-label="ปิด"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="px-4 py-2.5 bg-gray-50/70 border-b border-gray-100 flex items-center gap-2 overflow-x-auto hide-scrollbar">
              <button
                type="button"
                onClick={() => {
                  setSelectedStarFilter(null);
                  setOnlyWithPhotos(false);
                }}
                className={`px-3 py-1 rounded-full text-xs font-bold transition flex-shrink-0 cursor-pointer ${
                  selectedStarFilter === null && !onlyWithPhotos
                    ? "bg-[#16A085] text-white shadow-xs"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                ทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setOnlyWithPhotos((prev) => !prev)}
                className={`px-2.5 py-1 rounded-full text-xs font-bold transition flex-shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  onlyWithPhotos
                    ? "bg-[#16A085] text-white shadow-xs"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                <i className="fa-regular fa-image text-[11px]"></i>
                <span>มีรูปภาพ</span>
                {photoReviewCount > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                      onlyWithPhotos ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {photoReviewCount}
                  </span>
                )}
              </button>
              {[5, 4, 3, 2, 1].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setSelectedStarFilter(selectedStarFilter === star ? null : star)}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold transition flex-shrink-0 cursor-pointer flex items-center gap-1 ${
                    selectedStarFilter === star
                      ? "bg-[#16A085] text-white shadow-xs"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  <span>{star}</span>
                  <i className="fa-solid fa-star text-yellow-400 text-[10px]"></i>
                </button>
              ))}
            </div>

            {/* Reviews List */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-grow divide-y divide-gray-100 hide-scrollbar">
              {loadingAllReviews ? (
                <div className="py-12 text-center text-[#16A085]">
                  <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                  <p className="text-xs text-gray-400 mt-2">กำลังโหลดรีวิวทั้งหมด...</p>
                </div>
              ) : filteredReviews.length > 0 ? (
                filteredReviews.map((rev) => (
                  <div key={rev.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className="w-8 h-8 bg-gradient-bg text-white rounded-full flex items-center justify-center text-xs font-bold shadow-inner">
                        U
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-800">ผู้ซื้อที่ซ่อนชื่อ</p>
                        <div className="flex text-yellow-400 text-[10px] mt-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <i key={i} className={`fa-solid fa-star ${i < rev.rating ? "" : "text-gray-200"}`}></i>
                          ))}
                        </div>
                      </div>
                      <span className="ml-auto text-[10px] text-gray-400 font-medium">
                        {new Date(rev.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    {rev.text && <p className="text-xs text-gray-600 pl-10.5 leading-relaxed">{rev.text}</p>}
                    {rev.images && rev.images.length > 0 && (
                      <div className="flex gap-2 pl-10.5 mt-2 flex-wrap">
                        {rev.images.map((img) => {
                          const imgUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/reviews/${rev.id}/images/${img.id}`;
                          return (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => setPreviewReviewImage(imgUrl)}
                              className="focus:outline-hidden rounded-lg overflow-hidden border border-gray-100 hover:opacity-90 transition cursor-zoom-in shadow-2xs group"
                              title="คลิกเพื่อดูรูปภาพขนาดใหญ่"
                            >
                              <img
                                src={imgUrl}
                                alt="Review"
                                className="w-14 h-14 object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-gray-400">
                  <i className="fa-regular fa-comment-dots text-3xl text-gray-300 mb-2"></i>
                  <p className="text-xs">ไม่พบรีวิวในตัวกรองนี้</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox ขยายรูปรีวิว */}
      {previewReviewImage && (
        <div
          className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setPreviewReviewImage(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setPreviewReviewImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl font-bold cursor-pointer w-8 h-8 flex items-center justify-center"
              aria-label="ปิดรูปภาพ"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
            <img
              src={previewReviewImage}
              alt="Enlarged review photo"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
      {/* Shopee-style Lightbox Popup สำหรับรูปสินค้า */}
      {product && (
        <ProductImageLightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          images={product.images}
          initialIndex={activeImage}
          productTitle={product.name}
        />
      )}
      <Footer />
      <MobileNav />
    </div>
  );
}
