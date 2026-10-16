"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { bannerApi, BannerDto } from "@/lib/api";

export default function HeroSlider() {
  const [slides, setSlides] = useState<BannerDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    const fetchBanners = async () => {
      try {
        const { items } = await bannerApi.getPublicBanners();
        setSlides(items.length > 0 ? items : [
          // Fallback to default if no banners in DB
          { id: '1', imageUrl: "/images/banner01.png", title: "มหกรรมสินค้าชุมชน มรว.", subtitle: "รวมของดีของเด่น ส่งตรงจากวิสาหกิจชุมชนสู่ผู้บริโภค", tag: "โปรโมชันเด่น", linkUrl: "/products", displayOrder: 1, isActive: true, createdAt: new Date().toISOString() },
          { id: '2', imageUrl: "/images/banner02.png", title: "หัตถศิลป์และภูมิปัญญาท้องถิ่น", subtitle: "งานจักสานและผ้าทอมือประณีต สร้างรายได้ยั่งยืนสู่ชุมชน", tag: "งานฝีมือคุณภาพ", linkUrl: "/products", displayOrder: 2, isActive: true, createdAt: new Date().toISOString() },
          { id: '3', imageUrl: "/images/banner03.png", title: "นวัตกรรมและงานวิจัย มรว.", subtitle: "ยกระดับผลิตภัณฑ์ชุมชนด้วยเทคโนโลยีและมาตรฐานระดับสากล", tag: "นวัตกรรม มรว.", linkUrl: "/products", displayOrder: 3, isActive: true, createdAt: new Date().toISOString() }
        ]);
      } catch (error) {
        console.error("Failed to fetch banners:", error);
        // Fallback to default if API fails
        setSlides([
          { id: '1', imageUrl: "/images/banner01.png", title: "มหกรรมสินค้าชุมชน มรว.", subtitle: "รวมของดีของเด่น ส่งตรงจากวิสาหกิจชุมชนสู่ผู้บริโภค", tag: "โปรโมชันเด่น", linkUrl: "/products", displayOrder: 1, isActive: true, createdAt: new Date().toISOString() },
          { id: '2', imageUrl: "/images/banner02.png", title: "หัตถศิลป์และภูมิปัญญาท้องถิ่น", subtitle: "งานจักสานและผ้าทอมือประณีต สร้างรายได้ยั่งยืนสู่ชุมชน", tag: "งานฝีมือคุณภาพ", linkUrl: "/products", displayOrder: 2, isActive: true, createdAt: new Date().toISOString() },
          { id: '3', imageUrl: "/images/banner03.png", title: "นวัตกรรมและงานวิจัย มรว.", subtitle: "ยกระดับผลิตภัณฑ์ชุมชนด้วยเทคโนโลยีและมาตรฐานระดับสากล", tag: "นวัตกรรม มรว.", linkUrl: "/products", displayOrder: 3, isActive: true, createdAt: new Date().toISOString() }
        ]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchBanners();
  }, []);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);

  const SLIDE_DURATION = 5000; // 5 seconds per slide

  const next = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrent((c) => (c + 1) % slides.length);
    setProgress(0);
  }, [slides.length]);

  const prev = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrent((c) => (c - 1 + slides.length) % slides.length);
    setProgress(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return; // No need to auto-play if 1 or 0 slides

    const timer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          next();
          return 0;
        }
        return p + (100 / (SLIDE_DURATION / 50)); // Update every 50ms
      });
    }, 50);

    return () => clearInterval(timer);
  }, [next, isLoading, slides.length]);

  const handleDotClick = (index: number) => {
    setCurrent(index);
    setProgress(0);
  };

  if (isLoading || slides.length === 0) return (
    <section className="relative z-10 w-full overflow-hidden group bg-gray-900 aspect-[16/10] sm:aspect-[16/9] lg:aspect-[21/9] xl:aspect-[1920/750] animate-pulse">
    </section>
  );

  return (
    <section className="relative z-10 w-full overflow-hidden group bg-gray-900 aspect-[16/10] sm:aspect-[16/9] lg:aspect-[21/9] xl:aspect-[1920/750]">
      
      {/* Slides Container */}
      <div 
        className="flex h-full w-full relative transition-transform duration-700 ease-in-out will-change-transform" 
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {slides.map((slide, i) => {
          const hasText = Boolean(slide.title || slide.subtitle || slide.tag);
          return (
            <div key={i} className="w-full h-full flex-shrink-0 relative">
              {/* Dark overlay only when text is present */}
              {hasText && (
                <div className="absolute inset-0 bg-black/30 z-10 transition-opacity duration-700 pointer-events-none" />
              )}
              
              <img 
                src={slide.imageUrl} 
                alt={slide.title || "Banner"} 
                className="w-full h-full object-cover" 
                loading={i === 0 ? "eager" : "lazy"}
              />
              
              {/* Slide Content (Optimized for mobile & responsive) */}
              {hasText && (
                <div className="absolute inset-0 z-20 flex items-center justify-start pointer-events-none">
                  <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 md:px-12 lg:px-20">
                    <div className={`p-2.5 sm:p-5 md:p-8 lg:p-12 max-w-[75%] sm:max-w-md md:max-w-xl bg-black/30 backdrop-blur-sm sm:backdrop-blur-md border border-white/20 rounded-xl sm:rounded-2xl md:rounded-[2rem] shadow-xl sm:shadow-2xl transition-all duration-1000 transform ${i === current ? 'translate-y-0 opacity-100' : 'translate-y-6 sm:translate-y-10 opacity-0'}`}>
                      {slide.tag && (
                        <span className="inline-block bg-[#16A085] text-white px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-[9px] sm:text-xs font-bold uppercase tracking-wider mb-1 sm:mb-2.5 md:mb-4 shadow-sm">
                          {slide.tag}
                        </span>
                      )}
                      {slide.title && (
                        <h2 className="text-xs sm:text-xl md:text-3xl lg:text-4xl xl:text-5xl font-bold sm:font-black text-white mb-0.5 sm:mb-2 md:mb-4 leading-tight drop-shadow-md line-clamp-1 sm:line-clamp-none">
                          {slide.title}
                        </h2>
                      )}
                      {slide.subtitle && (
                        <p className="text-[10px] sm:text-xs md:text-sm lg:text-base text-white/90 font-normal sm:font-medium mb-1.5 sm:mb-3 md:mb-6 leading-tight sm:leading-relaxed drop-shadow-sm line-clamp-1 sm:line-clamp-none">
                          {slide.subtitle}
                        </p>
                      )}
                      <Link href={slide.linkUrl || "/products"} className="pointer-events-auto inline-flex bg-white text-gray-900 hover:bg-[#16A085] hover:text-white font-bold px-2.5 py-1 sm:px-5 sm:py-2 md:px-7 md:py-3 rounded-full transition-all duration-300 shadow-md transform hover:-translate-y-0.5 items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-xs md:text-sm lg:text-base w-max">
                        เลือกชมสินค้า <i className="fa-solid fa-arrow-right text-[8px] sm:text-xs"></i>
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Clickable area if no text block */}
              {!hasText && (
                <Link href={slide.linkUrl || "/products"} className="absolute inset-0 z-20"></Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation Arrows */}
      {slides.length > 1 && (
        <>
          <button 
            onClick={prev} 
            className="absolute left-2 sm:left-6 lg:left-12 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/30 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 opacity-0 group-hover:opacity-100 z-30 transform hover:scale-110"
          >
            <i className="fa-solid fa-chevron-left text-xs sm:text-base"></i>
          </button>
          <button 
            onClick={next} 
            className="absolute right-2 sm:right-6 lg:right-12 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/30 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 opacity-0 group-hover:opacity-100 z-30 transform hover:scale-110"
          >
            <i className="fa-solid fa-chevron-right text-xs sm:text-base"></i>
          </button>
        </>
      )}

      {/* Modern Progress Indicators */}
      {slides.length > 1 && (
        <div className="absolute bottom-2 sm:bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2.5 z-30 bg-black/20 backdrop-blur-sm p-1 sm:p-2 rounded-full border border-white/10">
          {slides.map((_, i) => (
            <button 
              key={i} 
              onClick={() => handleDotClick(i)} 
              className="group relative h-1 sm:h-1.5 md:h-2 w-6 sm:w-10 md:w-14 rounded-full bg-white/30 overflow-hidden transition-all duration-300"
            >
              {/* Background track for unselected */}
              <div className={`absolute inset-0 bg-white/50 transition-opacity duration-300 ${i === current ? 'opacity-0' : 'group-hover:opacity-100'}`}></div>
              
              {/* Progress fill for active slide */}
              {i === current && (
                <div 
                  className="absolute top-0 left-0 h-full bg-white rounded-full transition-all ease-linear"
                  style={{ width: `${progress}%` }}
                ></div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}