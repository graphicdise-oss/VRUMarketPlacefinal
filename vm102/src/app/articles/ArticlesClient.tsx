"use client";

import { useState, useEffect } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Link from "next/link";
import Image from "next/image";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { articleApi, Article } from "@/lib/api-modules/article";

const CATEGORIES = ["ทั้งหมด", "ภูมิปัญญา", "นวัตกรรม", "เกษตรกรรม", "สัมภาษณ์", "งานฝีมือ"];

export default function ArticlesClient() {
  const [activeCategory, setActiveCategory] = useState("ทั้งหมด");
  const [searchQuery, setSearchQuery] = useState("");
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

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow w-full">
        {/* Hero Section */}
        <div className="bg-[#16A085] text-white py-16 px-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <i className="fa-solid fa-book-open-reader text-9xl"></i>
          </div>
          <div className="max-w-7xl mx-auto relative z-10 text-center">
            <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight">เรื่องราวจากชุมชน</h1>
            <p className="text-lg text-[#D4F1BB] max-w-2xl mx-auto font-medium">เปิดหน้าต่างแห่งความรู้ สัมผัสวิถีชีวิต ภูมิปัญญา และแรงบันดาลใจจากเครือข่ายชุมชน</p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
          <Breadcrumb items={[{ label: "บทความชุมชน" }]} />
          
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar Filters */}
            <aside className="w-full lg:w-72 flex-shrink-0">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 lg:sticky lg:top-24">
                <div className="mb-6 relative">
                  <input 
                    type="text" 
                    placeholder="ค้นหาบทความ..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-50 border-none rounded-full pl-5 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085] transition" 
                  />
                  <i className="fa-solid fa-magnifying-glass absolute right-4 top-3.5 text-gray-400"></i>
                </div>

                <div>
                  <h3 className="font-bold text-gray-700 mb-4 text-sm flex items-center gap-2">
                    <i className="fa-solid fa-tags text-[#16A085]"></i> หมวดหมู่เรื่องราว
                  </h3>
                  <div className="flex flex-col gap-2">
                    {CATEGORIES.map(cat => (
                      <button 
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`text-left px-4 py-2.5 rounded-2xl text-sm font-bold transition-all ${
                          activeCategory === cat 
                            ? "bg-[#D4F1BB]/30 text-[#16A085]" 
                            : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            {/* Articles List */}
            <div className="flex-grow">
              <div className="mb-6 flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <p className="font-bold text-gray-700">พบ <span className="text-[#16A085]">{loading ? '...' : articles.length}</span> บทความ</p>
                <div className="flex gap-2">
                  <select className="input-minimal bg-gray-50 border-gray-200 text-sm py-2 px-4 rounded-full outline-none focus:border-[#16A085]">
                    <option>ล่าสุด</option>
                    <option>ยอดฮิต</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="py-20 text-center">
                  <i className="fa-solid fa-spinner fa-spin text-3xl text-[#16A085]"></i>
                </div>
              ) : articles.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {articles.map(article => (
                    <Link href={`/articles/${article.id}`} key={article.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden group hover:shadow-md transition-all flex flex-col block">
                      <div className="h-48 overflow-hidden relative">
                        <img src={article.image || 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=800&q=80'} alt={article.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
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
                          <span className="flex items-center gap-1.5"><i className="fa-regular fa-user"></i> {article.authorName}</span>
                          <span className="flex items-center gap-1.5"><i className="fa-regular fa-calendar"></i> {new Date(article.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-3xl py-20 text-center border border-gray-100 shadow-sm">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-3xl">
                    <i className="fa-regular fa-face-frown-open"></i>
                  </div>
                  <h3 className="text-lg font-bold text-gray-700 mb-2">ไม่พบบทความ</h3>
                  <p className="text-sm text-gray-500">ลองค้นหาด้วยคำอื่น หรือเลือกหมวดหมู่อื่นดูสิครับ</p>
                  <button onClick={() => { setActiveCategory("ทั้งหมด"); setSearchQuery(""); }} className="mt-4 text-[#16A085] font-bold text-sm hover:underline">
                    ล้างตัวกรองทั้งหมด
                  </button>
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
