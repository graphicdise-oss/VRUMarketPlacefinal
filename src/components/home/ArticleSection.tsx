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
      <section className="bg-white rounded-[2rem] sm:rounded-[3rem] shadow-sm border border-gray-100 p-6 sm:p-10 md:p-16 relative overflow-hidden animate-pulse">
        <div className="h-10 bg-gray-200 rounded w-48 mb-4"></div>
        <div className="h-6 bg-gray-200 rounded w-full max-w-lg mb-10"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[1, 2, 3].map(i => (
            <div key={i} className="aspect-[4/3] bg-gray-200 rounded-3xl"></div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-[2rem] sm:rounded-[3rem] shadow-sm border border-gray-100 p-6 sm:p-10 md:p-16 relative overflow-hidden">
      {/* Decorative Background Element */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[#D4F1BB]/30 to-transparent rounded-bl-full pointer-events-none"></div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 md:mb-14 relative z-10 gap-6">
        <div className="max-w-2xl">
          <span className="text-[#16A085] font-black tracking-widest text-[10px] uppercase mb-2 block">เรื่องราวจากชุมชน</span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-black text-gray-900 leading-tight mb-4">
            เรื่องราวจากชุมชน <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#16A085] to-[#117A65]">สู่ผลิตภัณฑ์ท้องถิ่น</span>
          </h2>
          <p className="text-gray-500 text-sm md:text-base font-medium leading-relaxed max-w-lg">
            อ่านเรื่องราวความเป็นมาของผลิตภัณฑ์ท้องถิ่น บทสัมภาษณ์ผู้ผลิต และผลงานวิจัยจากมหาวิทยาลัยราชภัฏวไลยอลงกรณ์
          </p>
        </div>
        <Link href="/articles" className="hidden md:flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white transition-all px-8 py-4 rounded-full font-bold text-sm shadow-md hover:shadow-lg transform hover:-translate-y-1">
          อ่านบทความทั้งหมด <i className="fa-solid fa-arrow-right"></i>
        </Link>
      </div>

      {articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center z-10 relative bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
          <div className="w-20 h-20 bg-white shadow-sm rounded-full flex items-center justify-center mb-5 text-[#16A085]">
            <i className="fa-regular fa-newspaper text-3xl"></i>
          </div>
          <h3 className="text-xl font-black text-gray-800 mb-2">ยังไม่มีบทความในขณะนี้</h3>
          <p className="text-gray-500 text-sm max-w-sm font-medium">
            เรื่องราวจากชุมชน บทสัมภาษณ์ และผลงานวิจัยใหม่ๆ จะถูกนำมาแสดงที่นี่ในเร็วๆ นี้
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
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
                  <span className="flex items-center gap-1.5"><i className="fa-regular fa-calendar text-[#16A085]"></i> {new Date(article.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="flex items-center gap-1.5"><i className="fa-regular fa-user text-[#16A085]"></i> {article.authorName}</span>
                </div>
                <h3 className="font-black text-gray-900 text-xl leading-snug mb-3 group-hover:text-[#16A085] transition-colors line-clamp-2">
                  {article.title}
                </h3>
                <p className="text-sm text-gray-500 font-medium leading-relaxed line-clamp-2 mb-4">
                  {article.excerpt}
                </p>
                
                <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-bold text-[#16A085] group-hover:text-gray-900 transition-colors">อ่านต่อ</span>
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-[#16A085] group-hover:text-white transition-all transform group-hover:translate-x-1">
                    <i className="fa-solid fa-arrow-right text-xs"></i>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      
      <div className="text-center mt-10 md:hidden relative z-10">
        <Link href="/articles" className="block w-full bg-gray-900 text-white transition-all px-8 py-4 rounded-full font-bold text-sm shadow-md">
          อ่านบทความทั้งหมด
        </Link>
      </div>
    </section>
  );
}