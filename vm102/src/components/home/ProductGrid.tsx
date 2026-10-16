"use client";

import { useState, useEffect } from "react";
import ProductCard from "./ProductCard";
import ProductCardSkeleton from "./ProductCardSkeleton";
import ProductModal from "@/components/product/ProductModal";
import { Product } from "@/types";
import Link from "next/link";
import { productApi, communityApi } from "@/lib/api";
import { mapPublicProductDto } from "@/lib/product-mapper";

export default function ProductGrid() {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      productApi.listPublic(),
      // Community names are best-effort: a failure here must not hide the products.
      communityApi.list().then((r) => r.items).catch(() => []),
    ]).then(([res, communities]) => {
      if (res.items && res.items.length > 0) {
        const communityNameById = new Map(communities.map((c) => [c.id, c.name]));
        setProducts(res.items.slice(0, 8).map((p) => mapPublicProductDto(p, communityNameById.get(p.communityId) ?? "")));
      } else {
        setProducts([]);
      }
    }).catch(err => {
      console.error("Failed to load products", err);
      setProducts([]);
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

  return (
    <>
      <section className="mb-10">
        <div className="flex flex-col md:flex-row justify-between md:items-end mb-8 gap-4">
          <div>
            <span className="text-[#16A085] font-black tracking-widest text-[10px] uppercase mb-1 block">สินค้ายอดฮิต</span>
            <h2 className="text-2xl md:text-3xl font-black text-gray-800 flex items-center gap-2">
              สินค้าชุมชนแนะนำ
            </h2>
          </div>
        </div>
        
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white/60 rounded-3xl border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-white shadow-sm rounded-full flex items-center justify-center mb-5 text-[#16A085]">
              <i className="fa-solid fa-basket-shopping text-3xl"></i>
            </div>
            <h3 className="text-xl font-black text-gray-800 mb-2">ยังไม่มีสินค้าแนะนำในขณะนี้</h3>
            <p className="text-gray-500 text-sm max-w-sm font-medium">
              สินค้าชุมชนคุณภาพและผลิตภัณฑ์ใหม่ๆ จะถูกนำมาแสดงที่นี่ในเร็วๆ นี้
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 sm:gap-6">
            {products.map((product) => (
              <div key={product.id}>
                <ProductCard product={product} onViewDetail={setSelectedProduct} />
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 text-center">
          <Link href="/products" className="inline-block bg-white border-2 border-gray-200 text-gray-600 hover:border-[#16A085] hover:text-[#16A085] font-bold px-8 py-3.5 rounded-full transition-all duration-300 shadow-sm hover:shadow-md">
            ดูสินค้าทั้งหมด <i className="fa-solid fa-arrow-right ml-1"></i>
          </Link>
        </div>
      </section>
      
      {selectedProduct && (
        <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </>
  );
}