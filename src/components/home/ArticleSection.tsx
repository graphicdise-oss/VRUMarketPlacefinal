"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { articleApi, Article } from "@/lib/api-modules/article";

export default function ArticleSection() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchArticles = async () => {
      try {
        const res = await articleApi.list({ limit: 3 });
        setArticles(res.items);
      } catch (error) {
        console.error("Failed to fetch articles:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchArticles();
  }, []);

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl sm:rounded-[3rem] shadow-sm border border-gray-100 p-4 sm:p-10 md:p-16 relative overflow-hidden animate-pulse">
        <div className="h-6 sm:h-10 bg-gray-200 rounded w-36 sm:w-48 mb-3 sm:mb-4"></div>
        <div className="h-4 sm:h-6 bg-gray-200 rounded w-full max-w-lg mb-6 sm:mb-10 hidden sm:block"></div>

        {/* Mobile Skeleton: Compact Tiles */}
        <div className="flex md:hidden flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl"></div>
          ))}
        </div>

        {/* Desktop Skeleton */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="aspect-[4/3] bg-gray-200 rounded-3xl"></div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl sm:rounded-[3rem] shadow-sm border border-gray-100 p-4 sm:p-10 md:p-16 relative overflow-hidden">
      {/* Decorative Background Element */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[#D4F1BB]/30 to-transparent rounded-bl-full pointer-events-none"></div>

      {/* Section Header */}
      <div className="flex items-center justify-between gap-3 mb-4 sm:mb-8 md:mb-14 relative z-10">
        <div className="max-w-2xl">
          <span className="text-[#16A085] font-black tracking-widest text-[9px] sm:text-[10px] uppercase mb-1 sm:mb-2 block">
            เรื่องราวจากชุมชน
          </span>
          <h2 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-gray-900 leading-tight mb-1 sm:mb-4">
            <span className="block">เรื่องราวจากชุมชน</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#16A085] to-[#117A65]">
              สู่ผลิตภัณฑ์ท้องถิ่น
            </span>
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm md:text-base font-medium leading-relaxed max-w-lg hidden sm:block">
            อ่านเรื่องราวความเป็นมาของผลิตภัณฑ์ท้องถิ่น บทสัมภาษณ์ผู้ผลิต และผลงานวิจัยจากมหาวิทยาลัยราชภัฏวไลยอลงกรณ์
          </p>
        </div>

        {/* Mobile "View All" link */}
        <Link
          href="/articles"
          className="inline-flex items-center gap-1 text-xs font-bold text-[#16A085] md:hidden flex-shrink-0 hover:underline"
        >
          <span>ดูทั้งหมด</span>
          <i className="fa-solid fa-chevron-right text-[10px]"></i>
        </Link>

        {/* Desktop "View All" button */}
        <Link
          href="/articles"
          className="hidden md:flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white transition-all px-8 py-4 rounded-full font-bold text-sm shadow-md hover:shadow-lg transform hover:-translate-y-1 flex-shrink-0"
        >
          อ่านบทความทั้งหมด <i className="fa-solid fa-arrow-right"></i>
        </Link>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 sm:py-16 px-4 text-center z-10 relative bg-gray-50/50 rounded-2xl sm:rounded-3xl border border-dashed border-gray-200">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white shadow-sm rounded-full flex items-center justify-center mb-3 sm:mb-5 text-[#16A085]">
            <i className="fa-regular fa-newspaper text-2xl sm:text-3xl"></i>
          </div>
          <h3 className="text-lg sm:text-xl font-black text-gray-800 mb-1 sm:mb-2">ยังไม่มีบทความในขณะนี้</h3>
          <p className="text-gray-500 text-xs sm:text-sm max-w-sm font-medium">
            เรื่องราวจากชุมชน บทสัมภาษณ์ และผลงานวิจัยใหม่ๆ จะถูกนำมาแสดงที่นี่ในเร็วๆ นี้
          </p>
        </div>
      ) : (
        <>
          {/* Mobile View: Compact Horizontal Tile List (Pattern 2) */}
          <div className="flex md:hidden flex-col gap-2.5 relative z-10">
            {articles.map((article) => (
              <Link
                href={`/articles/${article.id}`}
                key={article.id}
                className="group bg-gray-50/60 hover:bg-white active:scale-[0.99] p-2.5 rounded-2xl border border-gray-100 shadow-2xs hover:shadow-sm transition-all flex items-center gap-3"
              >
                {/* Left: Compact Thumbnail Image */}
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                  {article.image ? (
                    <img
                      src={article.image}
                      alt={article.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-[10px]">
                      ไม่มีรูปภาพ
                    </div>
                  )}
                  <span className="absolute top-1 left-1 bg-black/65 backdrop-blur-xs text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase leading-none">
                    {article.category}
                  </span>
                </div>

                {/* Right: Article Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-semibold mb-1">
                      <span className="flex items-center gap-1">
                        <i className="fa-regular fa-calendar text-[#16A085] text-[9px]"></i>
                        {new Date(article.createdAt).toLocaleDateString("th-TH", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                      </span>
                      <span>•</span>
                      <span className="truncate max-w-[110px]">{article.authorName}</span>
                    </div>

                    <h3 className="font-bold text-gray-900 text-xs sm:text-sm leading-snug line-clamp-2 group-hover:text-[#16A085] transition-colors">
                      {article.title}
                    </h3>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-bold text-[#16A085] mt-1.5 pt-1 border-t border-gray-100/80">
                    <span className="group-hover:underline">อ่านต่อ</span>
                    <i className="fa-solid fa-arrow-right text-[8px] group-hover:translate-x-1 transition-transform"></i>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop View: Rich 3-Column Magazine Grid */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
            {articles.map((article) => (
              <Link href={`/articles/${article.id}`} key={article.id} className="group flex flex-col">
                <div className="relative aspect-[4/3] rounded-3xl overflow-hidden mb-6 shadow-sm group-hover:shadow-xl transition-all duration-500 bg-gray-100">
                  <div className="absolute inset-0 bg-gray-900/10 group-hover:bg-transparent transition-colors duration-500 z-10"></div>
                  {article.image ? (
                    <img
                      src={article.image}
                      alt={article.title}
                      className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 ease-in-out"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">ไม่มีรูปภาพ</div>
                  )}
                  <div className="absolute top-4 left-4 z-20">
                    <span className="bg-white/90 backdrop-blur-sm text-gray-900 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-wider shadow-sm">
                      {article.category}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col flex-grow">
                  <div className="flex items-center gap-4 text-xs font-bold text-gray-400 mb-3">
                    <span className="flex items-center gap-1.5">
                      <i className="fa-regular fa-calendar text-[#16A085]"></i>{" "}
                      {new Date(article.createdAt).toLocaleDateString("th-TH", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="fa-regular fa-user text-[#16A085]"></i> {article.authorName}
                    </span>
                  </div>
                  <h3 className="font-black text-gray-900 text-xl leading-snug mb-3 group-hover:text-[#16A085] transition-colors line-clamp-2">
                    {article.title}
                  </h3>
                  <p className="text-sm text-gray-500 font-medium leading-relaxed line-clamp-2 mb-4">
                    {article.excerpt}
                  </p>

                  <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-sm font-bold text-[#16A085] group-hover:text-gray-900 transition-colors">
                      อ่านต่อ
                    </span>
                    <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-[#16A085] group-hover:text-white transition-all transform group-hover:translate-x-1">
                      <i className="fa-solid fa-arrow-right text-xs"></i>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Mobile Bottom Button (Clean border style) */}
      <div className="text-center mt-4 md:hidden relative z-10">
        <Link
          href="/articles"
          className="inline-flex items-center justify-center gap-1.5 w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-200/90 py-2.5 rounded-xl font-bold text-xs shadow-2xs hover:border-[#16A085] hover:text-[#16A085] transition-all"
        >
          <span>ดูบทความทั้งหมด</span>
          <i className="fa-solid fa-arrow-right text-[10px]"></i>
        </Link>
      </div>
    </section>
  );
}