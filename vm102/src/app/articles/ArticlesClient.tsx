"use client";

import { useState, useEffect, useMemo } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Link from "next/link";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { articleApi, Article } from "@/lib/api-modules/article";

interface CategoryOption {
  name: string;
  icon: string;
}

const CATEGORIES: CategoryOption[] = [
  { name: "ทั้งหมด", icon: "fa-border-all" },
  { name: "ภูมิปัญญา", icon: "fa-book-open" },
  { name: "นวัตกรรม", icon: "fa-lightbulb" },
  { name: "เกษตรกรรม", icon: "fa-seedling" },
  { name: "สัมภาษณ์", icon: "fa-comments" },
  { name: "งานฝีมือ", icon: "fa-hand-sparkles" },
];

export default function ArticlesClient() {
  const [activeCategory, setActiveCategory] = useState("ทั้งหมด");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"LATEST" | "POPULAR">("LATEST");
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true);
      try {
        const res = await articleApi.list({
          category: activeCategory,
          search: searchQuery,
          limit: 100,
        });
        setArticles(res.items);
      } catch (error) {
        console.error("Failed to fetch articles:", error);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
      fetchArticles();
    }, 300);

    return () => clearTimeout(timer);
  }, [activeCategory, searchQuery]);

  const hasActiveFilter = activeCategory !== "ทั้งหมด" || searchQuery.trim().length > 0;

  const handleClearAll = () => {
    setActiveCategory("ทั้งหมด");
    setSearchQuery("");
  };

  const sortedArticles = useMemo(() => {
    const list = [...articles];
    if (sortBy === "LATEST") {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "POPULAR") {
      list.sort((a, b) => (b.tags?.length || 0) - (a.tags?.length || 0) || a.title.localeCompare(b.title, "th"));
    }
    return list;
  }, [articles, sortBy]);

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow w-full pb-16">
        {/* Hero Section */}
        <div className="bg-[#16A085] text-white py-12 md:py-16 px-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <i className="fa-solid fa-book-open-reader text-9xl"></i>
          </div>
          <div className="max-w-7xl mx-auto relative z-10 text-center">
            <h1 className="text-3xl md:text-5xl font-black mb-3 md:mb-4 tracking-tight">เรื่องราวจากชุมชน</h1>
            <p className="text-sm md:text-lg text-[#D4F1BB] max-w-2xl mx-auto font-medium">เปิดหน้าต่างแห่งความรู้ สัมผัสวิถีชีวิต ภูมิปัญญา และแรงบันดาลใจจากเครือข่ายชุมชน</p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-4 pt-4 sm:pt-6 pb-24 md:pb-10">
          <Breadcrumb items={[{ label: "บทความชุมชน" }]} />

          {/* Mobile Filter & Search Toolbar (Only visible on mobile/tablet < lg) */}
          <div className="lg:hidden mb-6 space-y-3">
            {/* Live Search Input */}
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
              <input
                type="text"
                placeholder="ค้นหาบทความชุมชน..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-10 py-3 bg-white border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085] shadow-2xs transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center justify-center transition cursor-pointer"
                  aria-label="ล้างคำค้นหา"
                >
                  <i className="fa-solid fa-xmark text-xs"></i>
                </button>
              )}
            </div>

            {/* Horizontal Scrollable Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto scroll-smooth hide-scrollbar touch-pan-x py-1">
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.name;
                return (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setActiveCategory(cat.name)}
                    className={`px-3.5 py-2 rounded-2xl text-xs sm:text-sm font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer shadow-2xs whitespace-nowrap ${
                      isActive
                        ? "bg-[#16A085] text-white shadow-sm ring-2 ring-[#16A085]/20"
                        : "bg-white text-gray-600 hover:bg-emerald-50/50 hover:text-[#16A085] border border-gray-200"
                    }`}
                  >
                    <i className={`fa-solid ${cat.icon} text-xs`}></i>
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-8">
            {/* Desktop Sidebar Filters (Hidden on Mobile, Visible on lg:) */}
            <aside className="hidden lg:block w-72 flex-shrink-0">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 sticky top-24 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-800 font-bold text-base">
                    <i className="fa-solid fa-filter text-[#16A085]"></i>
                    <span>ตัวกรองบทความ</span>
                  </div>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-xs text-[#16A085] hover:text-[#117a65] font-semibold flex items-center gap-1 hover:underline transition cursor-pointer"
                    >
                      <i className="fa-solid fa-rotate-left text-[10px]"></i>
                      ล้างทั้งหมด
                    </button>
                  )}
                </div>

                {/* Search in Desktop Sidebar */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    ค้นหาบทความ
                  </label>
                  <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                    <input
                      type="text"
                      placeholder="พิมพ์คำค้นหา..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085] focus:bg-white transition"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                        aria-label="ล้างคำค้นหา"
                      >
                        <i className="fa-solid fa-xmark text-xs"></i>
                      </button>
                    )}
                  </div>
                </div>

                {/* Category Options */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <i className="fa-solid fa-tags text-[#16A085]"></i>
                      หมวดหมู่เรื่องราว
                    </label>
                    {activeCategory !== "ทั้งหมด" && (
                      <button
                        type="button"
                        onClick={() => setActiveCategory("ทั้งหมด")}
                        className="text-[11px] text-gray-400 hover:text-[#16A085] hover:underline cursor-pointer"
                      >
                        รีเซ็ต
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {CATEGORIES.map((cat) => {
                      const isActive = activeCategory === cat.name;
                      return (
                        <button
                          key={cat.name}
                          type="button"
                          onClick={() => setActiveCategory(cat.name)}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
                            isActive
                              ? "bg-emerald-50 text-[#16A085] font-bold shadow-2xs border border-[#16A085]/20"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-transparent"
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <span
                              className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs transition-colors ${
                                isActive ? "bg-[#16A085] text-white" : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              <i className={`fa-solid ${cat.icon}`}></i>
                            </span>
                            <span>{cat.name}</span>
                          </span>
                          {isActive && <i className="fa-solid fa-check text-xs text-[#16A085]"></i>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>

            {/* Articles List */}
            <div className="flex-grow min-w-0">
              <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-gray-700 text-sm sm:text-base">
                    พบ <span className="text-[#16A085]">{loading ? "..." : sortedArticles.length}</span> บทความ
                  </p>
                  {hasActiveFilter && (
                    <span className="text-xs bg-emerald-50 text-[#16A085] px-2.5 py-1 rounded-full font-semibold border border-emerald-200/60 hidden sm:inline-flex items-center gap-1">
                      {activeCategory !== "ทั้งหมด" && `หมวด: ${activeCategory}`}
                      {activeCategory !== "ทั้งหมด" && searchQuery.trim() && " • "}
                      {searchQuery.trim() && `ค้นหา: "${searchQuery}"`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <span className="text-xs text-gray-400 font-bold hidden sm:inline">จัดเรียง:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "LATEST" | "POPULAR")}
                    aria-label="จัดเรียงบทความ"
                    className="bg-gray-50 border border-gray-200 text-xs sm:text-sm py-2 px-3 sm:px-4 rounded-xl outline-none focus:border-[#16A085] focus:ring-1 focus:ring-[#16A085] font-semibold text-gray-700 cursor-pointer"
                  >
                    <option value="LATEST">ล่าสุด</option>
                    <option value="POPULAR">ยอดฮิต</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="py-20 text-center">
                  <i className="fa-solid fa-spinner fa-spin text-3xl text-[#16A085]"></i>
                </div>
              ) : sortedArticles.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {sortedArticles.map((article) => (
                    <Link
                      href={`/articles/${article.id}`}
                      key={article.id}
                      className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden group hover:shadow-md transition-all flex flex-col block"
                    >
                      <div className="h-48 overflow-hidden relative">
                        <img
                          src={article.image || "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=800&q=80"}
                          alt={article.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        />
                        <span className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm text-[#16A085] text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
                          {article.category}
                        </span>
                      </div>
                      <div className="p-6 flex flex-col flex-grow">
                        <h3 className="font-bold text-xl text-gray-800 mb-3 group-hover:text-[#16A085] transition-colors line-clamp-2">
                          {article.title}
                        </h3>
                        <p className="text-sm text-gray-500 mb-4 line-clamp-2 flex-grow">{article.excerpt}</p>
                        <div className="flex items-center justify-between text-xs font-bold text-gray-400 mt-auto pt-4 border-t border-gray-50">
                          <span className="flex items-center gap-1.5">
                            <i className="fa-regular fa-user"></i> {article.authorName}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <i className="fa-regular fa-calendar"></i>{" "}
                            {new Date(article.createdAt).toLocaleDateString("th-TH", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-3xl py-16 px-6 text-center border border-gray-100 shadow-sm">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-2xl">
                    <i className="fa-solid fa-book-open"></i>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-700 mb-1">ไม่พบบทความที่ตรงกับเงื่อนไข</h3>
                  <p className="text-xs sm:text-sm text-gray-500 max-w-sm mx-auto mb-5">
                    ลองเปลี่ยนคำค้นหา หรือเลือกดูหมวดหมู่อื่นๆ เพื่อค้นพบเรื่องราวที่น่าสนใจ
                  </p>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-[#16A085] hover:bg-emerald-100 font-bold text-xs sm:text-sm rounded-xl transition cursor-pointer border border-emerald-200"
                    >
                      <i className="fa-solid fa-rotate-left text-xs"></i>
                      ล้างตัวกรองทั้งหมด
                    </button>
                  )}
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
