"use client";

import { useState, useEffect } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import ProductCard from "@/components/home/ProductCard";
import ProductCardSkeleton from "@/components/home/ProductCardSkeleton";
import ProductModal from "@/components/product/ProductModal";
import { StaggeredGrid, FadeIn } from "@/components/ui/Animations";

import { Product } from "@/types";
import { useSearchParams, useRouter } from "next/navigation";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { productApi, categoryApi, communityApi, CategoryDto, CommunityDto } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";

/** Backend caps `limit` at 50 per request; we follow the cursor to load everything. */
const FETCH_PAGE_SIZE = 50;
/** Safety cap on cursor follow-up requests (50 × 10 = 500 products). */
const MAX_FETCH_PAGES = 10;
/** Products shown per page in the grid (15 aligns with 5 cols on PC and 3 cols on tablet). */
const PAGE_SIZE = 15;

export default function ProductsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initCat = searchParams.get("category") || "ALL";
  const [activeCategory, setActiveCategory] = useState(initCat);
  const searchQuery = (searchParams.get("q") || searchParams.get("search") || "").trim();

  useEffect(() => {
    const cat = searchParams.get("category") || "ALL";
    setActiveCategory(cat);
  }, [searchParams]);

  const handleSelectCategory = (catId: string) => {
    setActiveCategory(catId);
    const params = new URLSearchParams(searchParams.toString());
    if (catId === "ALL") {
      params.delete("category");
    } else {
      params.set("category", catId);
    }
    const qs = params.toString();
    router.push(qs ? `/products?${qs}` : "/products", { scroll: false });
  };
  const [activeCommunity, setActiveCommunity] = useState("ALL");
  // Empty string = no bound (so expensive products are never hidden by default).
  const [priceRange, setPriceRange] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const hasPriceFilter = priceRange.min !== "" || priceRange.max !== "";
  const resetPrice = () => setPriceRange({ min: "", max: "" });
  type SortKey = "LATEST" | "POPULAR" | "PRICE_ASC" | "PRICE_DESC";
  const SORT_KEYS: SortKey[] = ["LATEST", "POPULAR", "PRICE_ASC", "PRICE_DESC"];
  const rawSort = searchParams.get("sort") as SortKey | null;
  const initSort: SortKey = rawSort && SORT_KEYS.includes(rawSort) ? rawSort : "LATEST";
  const [sortBy, setSortBy] = useState<SortKey>(initSort);
  const [page, setPage] = useState(1);

  const handleClearAllFilters = () => {
    setActiveCategory("ALL");
    setActiveCommunity("ALL");
    setSortBy("LATEST");
    resetPrice();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("category");
    params.delete("q");
    params.delete("search");
    const qs = params.toString();
    router.push(qs ? `/products?${qs}` : "/products", { scroll: false });
  };

  const hasAnyFilter = activeCategory !== "ALL" || activeCommunity !== "ALL" || hasPriceFilter || Boolean(searchQuery);
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  const [productList, setProductList] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [communitiesData, setCommunitiesData] = useState<CommunityDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileFilterDrawerOpen, setIsMobileFilterDrawerOpen] = useState(false);

  // Lock body scroll when mobile filter drawer is open
  useEffect(() => {
    if (isMobileFilterDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileFilterDrawerOpen]);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileFilterDrawerOpen) {
        setIsMobileFilterDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileFilterDrawerOpen]);

  useEffect(() => {
    categoryApi.list().then(res => setCategories(res.items)).catch(console.error);
    communityApi.list().then(res => setCommunitiesData(res.items)).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchProducts = async () => {
      setIsLoading(true);
      try {
        const isValidUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        
        const validCat = activeCategory !== "ALL" && isValidUUID(activeCategory) ? activeCategory : undefined;
        const validCom = activeCommunity !== "ALL" && isValidUUID(activeCommunity) ? activeCommunity : undefined;

        // The API is cursor-paginated, so follow the cursor until every product is loaded —
        // otherwise the price filter / sort would only apply to the first page.
        const collected: Product[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < MAX_FETCH_PAGES; i++) {
          const response = await productApi.listPublic({
            categoryId: validCat,
            communityId: validCom,
            cursor,
            limit: FETCH_PAGE_SIZE,
          });
          collected.push(...response.items.map((item) => mapPublicProductDto(item)));
          cursor = response.nextCursor;
          if (!cursor) break;
        }

        if (!cancelled) setProductList(collected);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [activeCategory, activeCommunity]);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, activeCommunity, priceRange, sortBy, searchQuery]);

  const communities = [
    { id: "ALL", name: "ทุกชุมชน" },
    ...communitiesData
  ];

  const communityNameById = new Map(communitiesData.map(c => [c.id, c.name]));

  // Matches the card's "เริ่มต้นที่" price: the cheapest option.
  // Returns null when the product has no priced variant.
  const lowestPrice = (p: Product): number | null =>
    p.variants && p.variants.length > 0 ? Math.min(...p.variants.map(v => v.priceMinor)) / 100 : null;

  const filteredProducts = productList
    .map(p => ({ ...p, communityName: communityNameById.get(p.communityId) ?? "" }))
    .filter(p => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = p.name?.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q);
        const matchShop = p.shopName?.toLowerCase().includes(q);
        const matchCat = p.categoryName?.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchShop && !matchCat) return false;
      }
      const priceNum = lowestPrice(p);
      if (hasPriceFilter) {
        if (priceNum === null) return false;
        const minPrice = priceRange.min === "" ? 0 : Number(priceRange.min);
        const maxPrice = priceRange.max === "" ? Infinity : Number(priceRange.max);
        if (priceNum < minPrice || priceNum > maxPrice) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aNull = lowestPrice(a) === null;
      const bNull = lowestPrice(b) === null;
      const aPrice = lowestPrice(a) ?? 0;
      const bPrice = lowestPrice(b) ?? 0;

      switch (sortBy) {
        case "PRICE_ASC":
          if (aNull !== bNull) return aNull ? 1 : -1; // unpriced last
          return aPrice !== bPrice ? aPrice - bPrice : a.name.localeCompare(b.name, "th");
        case "PRICE_DESC":
          if (aNull !== bNull) return aNull ? 1 : -1; // unpriced last
          return bPrice !== aPrice ? bPrice - aPrice : b.name.localeCompare(a.name, "th");
        case "POPULAR": {
          const aSold = a.soldCount ?? 0;
          const bSold = b.soldCount ?? 0;
          if (bSold !== aSold) return bSold - aSold;
          // Deterministic popularity score when sales are tied/zero
          const aScore = ((a.views || 0) * 10) + a.name.charCodeAt(0) + (a.name.length * 3);
          const bScore = ((b.views || 0) * 10) + b.name.charCodeAt(0) + (b.name.length * 3);
          return bScore - aScore;
        }
        case "LATEST":
        default: {
          const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (diff !== 0) return diff;
          return b.id.localeCompare(a.id);
        }
      }
    });

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeFilterCount =
    (activeCategory !== "ALL" ? 1 : 0) +
    (activeCommunity !== "ALL" ? 1 : 0) +
    (hasPriceFilter ? 1 : 0);

  const selectedCategoryName = categories.find((c) => c.id === activeCategory)?.name;
  const selectedCommunityName = communitiesData.find((c) => c.id === activeCommunity)?.name;

  const renderFilterSections = (scope: "desktop" | "mobile") => (
    <div className="space-y-6">
      {/* Category Filter */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-gray-700 text-sm flex items-center gap-1.5">
            <i className="fa-solid fa-shapes text-xs text-[#16A085]"></i>
            หมวดหมู่
          </h3>
          {activeCategory !== "ALL" && (
            <button
              type="button"
              onClick={() => handleSelectCategory("ALL")}
              className="text-[11px] text-[#16A085] hover:underline font-semibold cursor-pointer"
            >
              ล้าง
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1 pr-1 chat-scroll">
          <label
            className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors group ${
              activeCategory === "ALL"
                ? "bg-emerald-50 text-[#16A085] font-bold"
                : "hover:bg-gray-50 text-gray-600 hover:text-gray-900"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <input
                type="radio"
                name={`${scope}-category`}
                checked={activeCategory === "ALL"}
                onChange={() => handleSelectCategory("ALL")}
                className="w-4 h-4 text-[#16A085] focus:ring-[#16A085] border-gray-300 accent-[#16A085]"
              />
              <span className="text-sm truncate">ทั้งหมด</span>
            </div>
            {activeCategory === "ALL" && (
              <i className="fa-solid fa-check text-xs text-[#16A085]"></i>
            )}
          </label>
          {categories.filter(cat => cat.id !== "cat-7" && cat.name !== "ทั้งหมด").map(cat => (
            <label
              key={cat.id}
              className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors group ${
                activeCategory === cat.id
                  ? "bg-emerald-50 text-[#16A085] font-bold"
                  : "hover:bg-gray-50 text-gray-600 hover:text-gray-900"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <input
                  type="radio"
                  name={`${scope}-category`}
                  checked={activeCategory === cat.id}
                  onChange={() => handleSelectCategory(cat.id)}
                  className="w-4 h-4 text-[#16A085] focus:ring-[#16A085] border-gray-300 accent-[#16A085]"
                />
                <span className="text-sm truncate" title={cat.name}>{cat.name}</span>
              </div>
              {activeCategory === cat.id && (
                <i className="fa-solid fa-check text-xs text-[#16A085]"></i>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Community Filter */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-gray-700 text-sm flex items-center gap-1.5">
            <i className="fa-solid fa-location-dot text-xs text-[#16A085]"></i>
            ชุมชน / พื้นที่
          </h3>
          {activeCommunity !== "ALL" && (
            <button
              type="button"
              onClick={() => setActiveCommunity("ALL")}
              className="text-[11px] text-[#16A085] hover:underline font-semibold cursor-pointer"
            >
              ล้าง
            </button>
          )}
        </div>
        <div className="max-h-56 overflow-y-auto space-y-1 pr-1 chat-scroll">
          {communities.map(com => (
            <label
              key={com.id}
              className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors group ${
                activeCommunity === com.id
                  ? "bg-emerald-50 text-[#16A085] font-bold"
                  : "hover:bg-gray-50 text-gray-600 hover:text-gray-900"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <input
                  type="radio"
                  name={`${scope}-community`}
                  checked={activeCommunity === com.id}
                  onChange={() => setActiveCommunity(com.id)}
                  className="w-4 h-4 text-[#16A085] focus:ring-[#16A085] border-gray-300 accent-[#16A085]"
                />
                <span className="text-sm truncate" title={com.name}>{com.name}</span>
              </div>
              {activeCommunity === com.id && (
                <i className="fa-solid fa-check text-xs text-[#16A085]"></i>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Price Filter */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-bold text-gray-700 text-sm flex items-center gap-1.5">
            <i className="fa-solid fa-tag text-xs text-[#16A085]"></i>
            ช่วงราคา (บาท)
          </h3>
          {hasPriceFilter && (
            <button
              type="button"
              onClick={resetPrice}
              className="text-[11px] text-[#16A085] hover:underline font-semibold cursor-pointer"
            >
              รีเซ็ต
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">฿</span>
            <input
              type="number"
              min={0}
              value={priceRange.min}
              placeholder="ต่ำสุด"
              onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-6 pr-2 py-2 text-xs sm:text-sm focus:outline-none focus:border-[#16A085] focus:bg-white transition"
            />
          </div>
          <span className="text-gray-400 font-bold">-</span>
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">฿</span>
            <input
              type="number"
              min={0}
              value={priceRange.max}
              placeholder="สูงสุด"
              onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-6 pr-2 py-2 text-xs sm:text-sm focus:outline-none focus:border-[#16A085] focus:bg-white transition"
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 py-6 md:py-8">
        <Breadcrumb items={[{ label: "ผลิตภัณฑ์ชุมชน" }]} />
        
        {/* Page Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-black text-gray-800 mb-2">ผลิตภัณฑ์ชุมชน</h1>
          <p className="text-gray-500 max-w-2xl mx-auto text-sm sm:text-base">เลือกซื้อสินค้าคุณภาพจากชุมชน สนับสนุนรายได้สู่ท้องถิ่นและเป็นมิตรกับสิ่งแวดล้อม</p>
        </div>

        <div className="flex flex-col md:flex-row gap-5 lg:gap-8">
          
          {/* Sidebar Filters (Visible on left for Desktop, hidden on Mobile) */}
          <aside className="hidden md:block w-60 lg:w-64 flex-shrink-0">
            <div className="bg-white rounded-3xl p-4 sm:p-5 lg:p-6 shadow-sm border border-gray-100 sticky top-24">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-100">
                <div className="flex items-center gap-2 text-gray-800 font-bold text-base">
                  <i className="fa-solid fa-filter text-[#16A085]"></i> ตัวกรองสินค้า
                </div>
                {hasAnyFilter && (
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="text-xs text-[#16A085] hover:text-[#117a65] font-semibold flex items-center gap-1 hover:underline transition cursor-pointer"
                    title="ล้างตัวกรองทั้งหมด"
                  >
                    <i className="fa-solid fa-rotate-left text-[10px]"></i>
                    ล้างทั้งหมด
                  </button>
                )}
              </div>

              {renderFilterSections("desktop")}
            </div>
          </aside>

          {/* Product Grid Area */}
          <div className="flex-grow min-w-0">
            {/* Top Toolbar / Filter & Sorting */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-6 space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm font-bold text-gray-700">
                    พบสินค้าทั้งหมด <span className="text-[#16A085]">{filteredProducts.length}</span> รายการ
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {/* Mobile Filter Button (Visible only on mobile) */}
                  <button
                    type="button"
                    onClick={() => setIsMobileFilterDrawerOpen(true)}
                    className="md:hidden flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2 rounded-full border border-gray-200 bg-white hover:bg-emerald-50/50 hover:border-[#16A085] text-gray-700 text-sm font-semibold transition cursor-pointer shadow-xs active:scale-95"
                  >
                    <i className="fa-solid fa-filter text-[#16A085] text-xs"></i>
                    <span>ตัวกรอง</span>
                    {activeFilterCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-[#16A085] text-white text-[11px] font-bold flex items-center justify-center shadow-xs">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  {/* Sort Dropdown */}
                  <div className="flex-1 sm:flex-none">
                    <select
                      value={sortBy}
                      onChange={(e) => {
                        const newSort = e.target.value as "LATEST" | "POPULAR" | "PRICE_ASC" | "PRICE_DESC";
                        setSortBy(newSort);
                        const params = new URLSearchParams(searchParams.toString());
                        params.set("sort", newSort);
                        router.push(`?${params.toString()}`, { scroll: false });
                      }}
                      className="input-minimal bg-gray-50 border-gray-200 text-sm py-2 px-3 sm:px-4 rounded-full outline-none focus:border-[#16A085] cursor-pointer w-full text-center sm:text-left"
                    >
                      <option value="LATEST">เรียงตาม: ล่าสุด</option>
                      <option value="POPULAR">เรียงตาม: ยอดนิยม</option>
                      <option value="PRICE_ASC">เรียงตาม: ราคา (ต่ำไปสูง)</option>
                      <option value="PRICE_DESC">เรียงตาม: ราคา (สูงไปต่ำ)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Active Filter Chips / Tags */}
              {hasAnyFilter && (
                <div className="flex items-center gap-2 flex-wrap pt-2.5 border-t border-gray-100 text-xs">
                  <span className="text-gray-400 font-medium text-[11px]">ตัวกรองที่เลือก:</span>
                  
                  {searchQuery && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#16A085] border border-emerald-100 font-medium">
                      <i className="fa-solid fa-magnifying-glass text-[10px]"></i>
                      &ldquo;{searchQuery}&rdquo;
                      <button
                        type="button"
                        onClick={() => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.delete("q");
                          params.delete("search");
                          const qs = params.toString();
                          router.push(qs ? `/products?${qs}` : "/products", { scroll: false });
                        }}
                        className="text-gray-400 hover:text-red-500 transition ml-0.5"
                        title="ลบคำค้นหา"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  )}

                  {activeCategory !== "ALL" && selectedCategoryName && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#16A085] border border-emerald-100 font-medium">
                      หมวด: {selectedCategoryName}
                      <button
                        type="button"
                        onClick={() => handleSelectCategory("ALL")}
                        className="text-gray-400 hover:text-red-500 transition ml-0.5"
                        title="ล้างหมวดหมู่"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  )}

                  {activeCommunity !== "ALL" && selectedCommunityName && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#16A085] border border-emerald-100 font-medium">
                      ชุมชน: {selectedCommunityName}
                      <button
                        type="button"
                        onClick={() => setActiveCommunity("ALL")}
                        className="text-gray-400 hover:text-red-500 transition ml-0.5"
                        title="ล้างชุมชน"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  )}

                  {hasPriceFilter && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#16A085] border border-emerald-100 font-medium">
                      ราคา: ฿{priceRange.min || "0"} - ฿{priceRange.max || "ไม่จำกัด"}
                      <button
                        type="button"
                        onClick={resetPrice}
                        className="text-gray-400 hover:text-red-500 transition ml-0.5"
                        title="ล้างราคา"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="text-xs text-rose-500 hover:text-rose-700 font-semibold hover:underline ml-auto flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fa-solid fa-rotate-left text-[10px]"></i>
                    ล้างทั้งหมด
                  </button>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-3.5 lg:gap-5">
                {Array.from({ length: 15 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredProducts.length > 0 ? (
              <StaggeredGrid key={`${sortBy}-${page}-${activeCategory}-${activeCommunity}`} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4 md:gap-3.5 lg:gap-5">
                {pagedProducts.map((product) => (
                  <FadeIn key={product.id}>
                    <div onClick={() => setSelectedProduct(product)} className="cursor-pointer h-full">
                      <ProductCard product={product} />
                    </div>
                  </FadeIn>
                ))}
              </StaggeredGrid>
            ) : (
              <div className="bg-white rounded-3xl py-20 text-center border border-gray-100 shadow-sm">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-3xl">
                  <i className="fa-solid fa-box-open"></i>
                </div>
                <h3 className="text-lg font-bold text-gray-700 mb-2">ไม่พบสินค้า</h3>
                <p className="text-sm text-gray-500">ลองปรับเปลี่ยนเงื่อนไขการค้นหาใหม่</p>
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="mt-4 text-[#16A085] font-bold text-sm hover:underline"
                >
                  ล้างตัวกรองทั้งหมด
                </button>
              </div>
            )}

            {/* Pagination */}
            {!isLoading && totalPages > 1 && (
              <nav aria-label="เลือกหน้าสินค้า" className="flex justify-center mt-10 mb-8">
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    aria-label="หน้าก่อนหน้า"
                    disabled={currentPage === 1}
                    onClick={() => goToPage(currentPage - 1)}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white border border-gray-200 text-gray-500 hover:text-[#16A085] hover:border-[#16A085] transition shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-left"></i>
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-current={p === currentPage ? "page" : undefined}
                      onClick={() => goToPage(p)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition shadow-sm ${
                        p === currentPage
                          ? "bg-[#16A085] text-white shadow-md"
                          : "bg-white border border-gray-200 text-gray-500 hover:text-[#16A085] hover:border-[#16A085]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="หน้าถัดไป"
                    disabled={currentPage === totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white border border-gray-200 text-gray-500 hover:text-[#16A085] hover:border-[#16A085] transition shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <i className="fa-solid fa-chevron-right"></i>
                  </button>
                </div>
              </nav>
            )}
          </div>

        </div>

      </main>

      {/* Mobile Filter Slide-out Drawer */}
      {isMobileFilterDrawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-fade-in"
            onClick={() => setIsMobileFilterDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="fixed inset-y-0 right-0 w-[86%] max-w-sm bg-white shadow-2xl flex flex-col z-10 animate-slide-in-right">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/70 to-teal-50/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-white border border-emerald-100 text-[#16A085] flex items-center justify-center text-sm shadow-xs flex-shrink-0">
                  <i className="fa-solid fa-filter"></i>
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-base leading-tight">ตัวกรองสินค้า</h2>
                  <p className="text-[11px] text-gray-500">
                    {activeFilterCount > 0 ? `เลือกอยู่ ${activeFilterCount} เงื่อนไข` : "เลือกเงื่อนไขที่ต้องการ"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileFilterDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-700 flex items-center justify-center transition cursor-pointer flex-shrink-0 shadow-xs"
                aria-label="ปิดตัวกรอง"
              >
                <i className="fa-solid fa-xmark text-sm"></i>
              </button>
            </div>

            {/* Filter Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 overscroll-contain chat-scroll">
              {renderFilterSections("mobile")}
            </div>

            {/* Drawer Footer (Sticky Actions) */}
            <div className="p-4 border-t border-gray-100 bg-white/95 backdrop-blur-xs shadow-lg flex gap-2.5">
              <button
                type="button"
                onClick={handleClearAllFilters}
                disabled={!hasAnyFilter}
                className="flex-1 py-2.5 px-3 rounded-2xl border border-gray-200 text-gray-600 font-bold text-xs sm:text-sm hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-rotate-left text-xs"></i>
                ล้างทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setIsMobileFilterDrawerOpen(false)}
                className="flex-[2] py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#16A085] to-[#117a65] text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>ดูสินค้า</span>
                <span className="bg-white/25 px-2 py-0.5 rounded-full text-xs font-semibold">
                  {filteredProducts.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
      <MobileNav />
      {selectedProduct && <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
    </div>
  );
}
