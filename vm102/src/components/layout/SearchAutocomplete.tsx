"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { productApi } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/types";

// Curated Popular Community Search Terms
const POPULAR_SEARCH_TERMS = [
  "ผ้าขาวม้าทอมือ",
  "ผ้าไหมมัดหมี่",
  "ผ้าฝ้ายย้อมคราม",
  "ผ้าคลุมไหล่ทอมือ",
  "เสื้อผ้าฝ้ายพื้นเมือง",
  "กล้วยตากพลังงานแสงอาทิตย์",
  "ข้าวหอมมะลิอินทรีย์",
  "น้ำผึ้งแท้ดอกไม้ป่า",
  "ชาเกสรบัวหลวง",
  "น้ำพริกเผาโบราณ",
  "เมลอนหวานกรอบ",
  "ส้มโอขาวแตงกวา",
  "สบู่สมุนไพรเปลือกมังคุด",
  "เซรั่มน้ำมันมะพร้าวสกัดเย็น",
  "สเปรย์ตะไคร้หอมกันยุง",
  "บาล์มสมุนไพรไพลสด",
  "กระเป๋ากระจูดสาน",
  "ตะกร้าหวายหัตถกรรม",
  "กล่องทิชชู่จักสาน",
  "เทียนหอมอโรมาสมุนไพร",
];

// Trending keywords when input is empty
const TRENDING_KEYWORDS = [
  "ผ้าขาวม้า",
  "สบู่สมุนไพร",
  "น้ำผึ้งแท้",
  "ข้าวอินทรีย์",
  "ชาเกสรบัว",
  "กระเป๋ากระจูด",
];

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <span key={i} className="text-[#16A085] font-black underline decoration-[#16A085]/40">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function SearchAutocomplete() {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductsLoaded, setIsProductsLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync keyword from URL search parameters if on /products
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q") || params.get("search") || "";
      if (pathname.startsWith("/products")) {
        setQuery(q);
      } else {
        setQuery("");
      }
    }
  }, [pathname]);

  // Debounce search input (200ms) for snappy response
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Lazy-load public products for instant live search
  const loadProducts = async () => {
    if (isProductsLoaded) return;
    try {
      const res = await productApi.listPublic({ limit: 60 });
      if (res?.items) {
        setProducts(res.items.map((item) => mapPublicProductDto(item)));
        setIsProductsLoaded(true);
      }
    } catch (err) {
      console.error("Failed to load search autocomplete products:", err);
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Section 1: Top 3 Search Query Suggestions
  const querySuggestions = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery.toLowerCase();
    const results: string[] = [];
    const seen = new Set<string>();

    // 1. Check curated popular terms
    for (const term of POPULAR_SEARCH_TERMS) {
      if (term.toLowerCase().includes(q) && !seen.has(term.toLowerCase())) {
        seen.add(term.toLowerCase());
        results.push(term);
        if (results.length >= 3) break;
      }
    }

    // 2. Check product names
    if (results.length < 3) {
      for (const p of products) {
        if (p.name.toLowerCase().includes(q) && !seen.has(p.name.toLowerCase())) {
          seen.add(p.name.toLowerCase());
          results.push(p.name);
          if (results.length >= 3) break;
        }
      }
    }

    return results.slice(0, 3);
  }, [debouncedQuery, products]);

  // Section 2: Top 3-4 Product Previews
  const productSuggestions = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery.toLowerCase();

    return products
      .filter((p) => {
        const matchName = p.name?.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q);
        const matchShop = p.shopName?.toLowerCase().includes(q);
        const matchCat = p.categoryName?.toLowerCase().includes(q);
        return matchName || matchDesc || matchShop || matchCat;
      })
      .slice(0, 4);
  }, [debouncedQuery, products]);

  // Total matching count
  const totalMatchesCount = useMemo(() => {
    if (!debouncedQuery) return 0;
    const q = debouncedQuery.toLowerCase();
    return products.filter((p) => {
      return (
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.shopName?.toLowerCase().includes(q) ||
        p.categoryName?.toLowerCase().includes(q)
      );
    }).length;
  }, [debouncedQuery, products]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    setIsOpen(false);
    if (trimmed) {
      router.push(`/products?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/products");
    }
  };

  const handleSelectQuery = (keyword: string) => {
    setQuery(keyword);
    setIsOpen(false);
    router.push(`/products?q=${encodeURIComponent(keyword)}`);
  };

  const handleSelectProduct = (productId: string) => {
    setIsOpen(false);
    router.push(`/products/${productId}`);
  };

  return (
    <div ref={containerRef} className="w-full relative">
      {/* Search Bar Input Form */}
      <form onSubmit={handleSubmit} className="w-full relative flex items-center input-minimal rounded-full overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            setIsOpen(true);
            loadProducts();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            loadProducts();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsOpen(false);
            }
          }}
          placeholder="ค้นหาสินค้าชุมชน..."
          className="w-full pl-4 md:pl-5 pr-11 py-2 md:py-2.5 text-gray-800 text-xs md:text-sm focus:outline-none bg-transparent"
        />
        <button
          type="submit"
          aria-label="ค้นหา"
          className="absolute right-1.5 top-1.5 bottom-1.5 w-8 md:w-9 flex items-center justify-center bg-[#D4F1BB] text-[#16A085] hover:bg-[#A9DCA4] transition rounded-full cursor-pointer shadow-2xs"
        >
          <i className="fa-solid fa-magnifying-glass text-xs"></i>
        </button>
      </form>

      {/* Hybrid Suggestions Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[60] animate-in fade-in slide-in-from-top-2 duration-150">
          {query.trim() === "" ? (
            /* Trending Searches when focused but empty */
            <div className="p-3.5 sm:p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 mb-2.5">
                <i className="fa-solid fa-fire text-amber-500"></i>
                <span>คำค้นหายอดนิยม</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TRENDING_KEYWORDS.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => handleSelectQuery(kw)}
                    className="text-xs bg-gray-50 hover:bg-[#D4F1BB]/30 hover:text-[#16A085] text-gray-600 px-3 py-1.5 rounded-full transition border border-gray-100 flex items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>{kw}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : querySuggestions.length === 0 && productSuggestions.length === 0 ? (
            /* Empty state when no matches */
            <div className="p-6 text-center text-gray-400">
              <i className="fa-solid fa-magnifying-glass text-2xl mb-2 text-gray-300 block"></i>
              <p className="text-xs font-bold text-gray-600">ไม่พบคำค้นหาหรือสินค้าที่ตรงกับ &ldquo;{query}&rdquo;</p>
              <p className="text-[11px] text-gray-400 mt-1">ลองค้นหาด้วยคำอื่น เช่น ผ้า, สบู่, ข้าว, กล้วย, ชา</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
              {/* ท่อนบน (3 รายการ): แนะนำ "คำค้นหายอดนิยม" ที่มีคำนี้ */}
              {querySuggestions.length > 0 && (
                <div className="p-2 sm:p-2.5">
                  <div className="px-3 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <i className="fa-solid fa-magnifying-glass text-[10px] text-[#16A085]"></i>
                      คำค้นหาแนะนำ
                    </span>
                    <span className="text-[10px] text-gray-400 font-normal">กดเพื่อค้นหา</span>
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {querySuggestions.map((term, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectQuery(term)}
                        className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-gray-700 hover:bg-[#D4F1BB]/20 hover:text-[#16A085] transition group cursor-pointer"
                      >
                        <i className="fa-solid fa-magnifying-glass text-gray-300 group-hover:text-[#16A085] text-xs transition"></i>
                        <span className="flex-1 truncate font-medium">{highlightMatch(term, debouncedQuery)}</span>
                        <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition"></i>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ท่อนล่าง (3-4 รายการ): แสดงสินค้าที่ตรงกับคำค้นหาพร้อมรูปและราคา */}
              {productSuggestions.length > 0 && (
                <div className="p-2 sm:p-2.5 bg-gray-50/40">
                  <div className="px-3 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <i className="fa-solid fa-bag-shopping text-[10px] text-[#16A085]"></i>
                      สินค้าที่เกี่ยวข้อง
                    </span>
                    <span className="text-[10px] text-gray-400 font-normal">คลิกเพื่อดูสินค้า</span>
                  </div>
                  <div className="space-y-1 mt-1">
                    {productSuggestions.map((p) => {
                      const minPrice = p.variants?.length > 0 ? Math.min(...p.variants.map((v) => v.priceMinor)) : 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectProduct(p.id)}
                          className="w-full text-left flex items-center gap-3 p-2 rounded-xl hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-100 transition group cursor-pointer"
                        >
                          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-100">
                            <img
                              src={p.images[0] || "/placeholder.png"}
                              alt={p.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-gray-800 truncate group-hover:text-[#16A085] transition">
                              {highlightMatch(p.name, debouncedQuery)}
                            </h4>
                            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 truncate mt-0.5">
                              {p.shopName && <span>{p.shopName}</span>}
                              {p.communityName && (
                                <>
                                  <span>•</span>
                                  <span>{p.communityName}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xs sm:text-sm font-black text-[#16A085]">
                              {formatPrice(minPrice)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* แถวล่างสุด (Footer): ดูผลการค้นหาทั้งหมด */}
              <div className="p-2 sm:p-2.5 bg-gray-50 border-t border-gray-100 text-center">
                <button
                  type="button"
                  onClick={() => handleSelectQuery(debouncedQuery)}
                  className="w-full py-2 px-3 text-xs font-bold text-[#16A085] hover:text-[#117a65] hover:bg-[#D4F1BB]/30 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>ดูผลการค้นหาทั้งหมดสำหรับ &ldquo;{debouncedQuery}&rdquo;</span>
                  {totalMatchesCount > 0 && (
                    <span className="bg-[#16A085] text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                      {totalMatchesCount}
                    </span>
                  )}
                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
