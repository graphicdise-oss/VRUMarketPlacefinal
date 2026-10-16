"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { categoryApi, CategoryDto } from "@/lib/api";

import { getDynamicStyle } from "@/lib/category-styles";

export default function CategoryMenu() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    categoryApi.list()
      .then(res => setCategories(res.items.slice(0, 13)))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <section className="relative -mt-8 sm:-mt-12 z-30">
      <div className="bg-white/80 backdrop-blur-xl p-4 sm:p-6 md:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-black text-gray-800 text-lg flex items-center gap-2">
            หมวดหมู่สินค้า <i className="fa-solid fa-layer-group text-gray-300 text-sm"></i>
          </h3>
        </div>
        
        {isLoading ? (
          <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-6 gap-4 sm:gap-6 md:gap-8 justify-items-center">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center min-w-[76px] sm:min-w-[96px] animate-pulse">
                <div className="w-16 h-16 sm:w-20 sm:h-20 md:w-22 md:h-22 lg:w-24 lg:h-24 bg-gray-200 rounded-2xl sm:rounded-3xl mb-3"></div>
                <div className="w-14 sm:w-16 h-3.5 bg-gray-200 rounded-md"></div>
              </div>
            ))}
          </div>
        ) : (
          <motion.div 
            className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-6 gap-4 sm:gap-6 md:gap-8 justify-items-center"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.05 }
              }
            }}
          >
            {categories.map((cat) => {
              const styling = getDynamicStyle(cat.name);
              const bgClass = styling.bgColor;
              const iconColor = styling.textColor;
              const hoverBg = styling.hoverBg;
              const isBold = styling.isBold;

              return (
                <motion.div 
                  key={cat.id} 
                  variants={{
                    hidden: { opacity: 0, scale: 0.8, y: 20 },
                    visible: { 
                      opacity: 1, 
                      scale: 1, 
                      y: 0,
                      transition: { type: "spring", stiffness: 300, damping: 20 }
                    }
                  }}
                >
                  <Link 
                    href={`/products?category=${cat.id}`} 
                    className="flex flex-col items-center group min-w-[76px] sm:min-w-[96px] max-w-[130px]"
                  >
                    <div className={`w-16 h-16 sm:w-20 sm:h-20 md:w-22 md:h-22 lg:w-24 lg:h-24 ${bgClass} rounded-2xl sm:rounded-3xl flex items-center justify-center text-2xl sm:text-3xl md:text-4xl lg:text-[2.5rem] transition-all duration-300 ease-out transform group-hover:-translate-y-2 group-hover:shadow-xl ${hoverBg} relative overflow-hidden shadow-sm`}>
                      {/* Glass reflection effect */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-0 group-hover:opacity-100 transform -translate-x-full group-hover:translate-x-full transition-all duration-700"></div>
                      
                      <i className={`fa-solid ${styling.icon} ${iconColor} group-hover:text-white transition-colors duration-300 relative z-10`}></i>
                    </div>
                    <span className={`text-[11px] sm:text-xs md:text-sm mt-2.5 sm:mt-3 text-center text-gray-700 group-hover:text-[#16A085] transition-colors leading-snug line-clamp-1 ${isBold ? "font-bold text-gray-900" : "font-medium"}`}>
                      {cat.name}
                    </span>
                  </Link>
                </motion.div>
              )
            })}
            
            <motion.div
              variants={{
                hidden: { opacity: 0, scale: 0.8, y: 20 },
                visible: { 
                  opacity: 1, 
                  scale: 1, 
                  y: 0,
                  transition: { type: "spring", stiffness: 300, damping: 20 }
                }
              }}
            >
              <Link 
                href={`/products?category=ALL`} 
                className="flex flex-col items-center group min-w-[76px] sm:min-w-[96px] max-w-[130px]"
              >
                <div className={`w-16 h-16 sm:w-20 sm:h-20 md:w-22 md:h-22 lg:w-24 lg:h-24 bg-gray-100 rounded-2xl sm:rounded-3xl flex items-center justify-center text-2xl sm:text-3xl md:text-4xl lg:text-[2.5rem] transition-all duration-300 ease-out transform group-hover:-translate-y-2 group-hover:shadow-xl hover:bg-[#16A085] relative overflow-hidden shadow-sm`}>
                  <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-0 group-hover:opacity-100 transform -translate-x-full group-hover:translate-x-full transition-all duration-700"></div>
                  <i className={`fa-solid fa-border-all text-gray-500 group-hover:text-white transition-colors duration-300 relative z-10`}></i>
                </div>
                <span className="text-[11px] sm:text-xs md:text-sm mt-2.5 sm:mt-3 text-center text-gray-700 group-hover:text-[#16A085] transition-colors font-medium">
                  ทั้งหมด
                </span>
              </Link>
            </motion.div>
          </motion.div>
        )}
      </div>
    </section>
  );
}