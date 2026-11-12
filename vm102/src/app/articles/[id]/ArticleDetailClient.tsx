"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { articleApi, Article } from "@/lib/api-modules/article";
import { sanitizeArticleHtml } from "@/lib/sanitize-html";
import { useToast } from "@/components/ui/Toast";

export default function ArticleDetailClient({ articleId }: { articleId: string }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const handleShareFacebook = () => {
    if (typeof window === "undefined") return;
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank", "width=600,height=400");
  };

  const handleShareTwitter = () => {
    if (typeof window === "undefined" || !article) return;
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(article.title);
    window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, "_blank", "width=600,height=400");
  };

  const handleShareLine = () => {
    if (typeof window === "undefined") return;
    const url = encodeURIComponent(window.location.href);
    window.open(`https://social-plugins.line.me/lineit/share?url=${url}`, "_blank", "width=600,height=400");
  };

  const handleCopyLink = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    showToast("คัดลอกลิงก์บทความเรียบร้อยแล้ว!", "success");
  };

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        const data = await articleApi.getById(articleId);
        setArticle(data);
      } catch (error) {
        console.error("Failed to fetch article:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchArticle();
  }, [articleId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i>
        </main>
        <Footer />
        <MobileNav />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-700">ไม่พบบทความ</h2>
            <Link href="/articles" className="text-[#16A085] hover:underline mt-4 inline-block">กลับไปหน้าบทความ</Link>
          </div>
        </main>
        <Footer />
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-4xl mx-auto w-full px-3 sm:px-4 pt-4 sm:pt-6 pb-24 md:pb-12">
        <Breadcrumb items={[
          { label: "บทความชุมชน", href: "/articles" },
          { label: article.title }
        ]} />

        <article className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="w-full h-[220px] sm:h-[300px] md:h-[400px] relative">
            <img src={article.image || 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=1200&q=80'} alt={article.title} className="w-full h-full object-cover" />
            <div className="absolute top-4 left-4">
              <span className="bg-[#16A085] text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-md">
                {article.category}
              </span>
            </div>
          </div>
          
          <div className="p-4 sm:p-6 md:p-10">
            <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-gray-800 mb-4 sm:mb-6 leading-snug">{article.title}</h1>
            
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-8 pb-8 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-[#16A085]">
                  <i className="fa-solid fa-user"></i>
                </div>
                <span className="font-bold text-gray-700">{article.authorName}</span>
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1">
                <i className="fa-regular fa-calendar"></i> {new Date(article.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            
            <div 
              className="prose prose-lg max-w-none text-gray-600 leading-relaxed whitespace-pre-line" 
              dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content) }} 
            />
            
            {/* Share Buttons */}
            <div className="mt-12 pt-8 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <p className="font-bold text-gray-800 text-sm sm:text-base">แชร์บทความนี้:</p>
              <div className="flex gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={handleShareFacebook}
                  className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition flex items-center justify-center text-lg cursor-pointer shadow-2xs"
                  title="แชร์ไปยัง Facebook"
                  aria-label="แชร์ไปยัง Facebook"
                >
                  <i className="fa-brands fa-facebook-f"></i>
                </button>
                <button
                  type="button"
                  onClick={handleShareTwitter}
                  className="w-10 h-10 rounded-full bg-sky-50 text-sky-500 hover:bg-sky-500 hover:text-white transition flex items-center justify-center text-lg cursor-pointer shadow-2xs"
                  title="แชร์ไปยัง X (Twitter)"
                  aria-label="แชร์ไปยัง X (Twitter)"
                >
                  <i className="fa-brands fa-x-twitter"></i>
                </button>
                <button
                  type="button"
                  onClick={handleShareLine}
                  className="w-10 h-10 rounded-full bg-green-50 text-green-500 hover:bg-green-500 hover:text-white transition flex items-center justify-center text-lg cursor-pointer shadow-2xs"
                  title="แชร์ไปยัง LINE"
                  aria-label="แชร์ไปยัง LINE"
                >
                  <i className="fa-brands fa-line"></i>
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-10 h-10 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition flex items-center justify-center text-base cursor-pointer shadow-2xs"
                  title="คัดลอกลิงก์"
                  aria-label="คัดลอกลิงก์"
                >
                  <i className="fa-solid fa-link"></i>
                </button>
              </div>
            </div>
          </div>
        </article>

      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
