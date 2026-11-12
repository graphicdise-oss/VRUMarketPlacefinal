"use client";

import { useEffect, useState, useCallback, useRef } from "react";

export interface ProductImageLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  initialIndex?: number;
  productTitle?: string;
}

export default function ProductImageLightbox({
  isOpen,
  onClose,
  images,
  initialIndex = 0,
  productTitle,
}: ProductImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);

  // Sync initialIndex when modal opens or index changes
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, images.length - 1)));
    }
  }, [isOpen, initialIndex, images.length]);

  // Lock background scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const handlePrev = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  }, [images.length]);

  const handleNext = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  }, [images.length]);

  // Keyboard navigation: Left/Right arrows and Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  // Touch Swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
    touchStartX.current = null;
  };

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[currentIndex] || images[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="รูปภาพสินค้าขยายใหญ่"
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-5xl w-full max-h-[92vh] flex flex-col md:flex-row relative border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/90 hover:bg-white text-gray-600 hover:text-red-500 shadow-md flex items-center justify-center transition-all cursor-pointer active:scale-95"
          aria-label="ปิดหน้าต่างรูปภาพ"
          title="ปิด (Esc)"
        >
          <i className="fa-solid fa-xmark text-base sm:text-lg"></i>
        </button>

        {/* Center / Left Panel: Large High-Res Image Display */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="relative flex-1 bg-neutral-950 flex items-center justify-center min-h-[300px] sm:min-h-[420px] md:min-h-[550px] p-4 sm:p-6 group overflow-hidden"
        >
          <img
            key={currentImage}
            src={currentImage}
            alt={productTitle || `ภาพสินค้าที่ ${currentIndex + 1}`}
            className="max-h-[55vh] md:max-h-[72vh] max-w-full object-contain transition-transform duration-300 select-none animate-in fade-in duration-150"
          />

          {/* Navigation Arrows (Visible when > 1 image) */}
          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/50 hover:bg-[#16A085] text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-lg active:scale-90 cursor-pointer border border-white/20"
                aria-label="รูปก่อนหน้า"
                title="รูปก่อนหน้า (ลูกศรซ้าย)"
              >
                <i className="fa-solid fa-chevron-left text-sm sm:text-base"></i>
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-black/50 hover:bg-[#16A085] text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-lg active:scale-90 cursor-pointer border border-white/20"
                aria-label="รูปถัดไป"
                title="รูปถัดไป (ลูกศรขวา)"
              >
                <i className="fa-solid fa-chevron-right text-sm sm:text-base"></i>
              </button>
            </>
          )}

          {/* Image Counter Badge */}
          <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 bg-black/60 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-xs flex items-center gap-1.5 border border-white/10 pointer-events-none">
            <i className="fa-regular fa-image text-[11px] text-[#D4F1BB]"></i>
            <span>
              {currentIndex + 1} / {images.length}
            </span>
          </div>
        </div>

        {/* Right Panel: Shopee-style Thumbnails Gallery */}
        <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-gray-100 p-4 sm:p-5 flex flex-col justify-between flex-shrink-0">
          <div>
            {/* Product Header */}
            {productTitle && (
              <div className="mb-4 pr-8 md:pr-0">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#16A085] bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 inline-block mb-1.5">
                  ภาพสินค้า
                </span>
                <h3 className="font-bold text-gray-800 text-sm sm:text-base line-clamp-2 leading-snug">
                  {productTitle}
                </h3>
              </div>
            )}

            {/* Thumbnail Gallery Label */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                <i className="fa-solid fa-shapes text-[#16A085]"></i> รูปภาพทั้งหมด ({images.length})
              </span>
              <span className="text-[11px] text-gray-400 font-medium">คลิกเพื่อเลือกดู</span>
            </div>

            {/* Thumbnails Grid */}
            <div className="grid grid-cols-4 md:grid-cols-2 gap-2 sm:gap-2.5 overflow-y-auto max-h-[22vh] md:max-h-[50vh] p-0.5">
              {images.map((img, idx) => {
                const isActive = currentIndex === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={`aspect-square rounded-2xl overflow-hidden border-2 transition-all cursor-pointer relative bg-gray-50 ${
                      isActive
                        ? "border-[#16A085] ring-2 ring-[#16A085]/30 shadow-md scale-102"
                        : "border-gray-200 hover:border-gray-400 opacity-70 hover:opacity-100"
                    }`}
                    aria-label={`เลือกดูรูปภาพที่ ${idx + 1}`}
                  >
                    <img
                      src={img}
                      alt={`ภาพย่อที่ ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {isActive && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#16A085] text-white text-[9px] flex items-center justify-center shadow-xs">
                        <i className="fa-solid fa-check"></i>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Guide */}
          <div className="pt-3 border-t border-gray-100 text-[11px] text-gray-400 flex items-center justify-between hidden md:flex">
            <span>ใช้ปุ่ม ← → เพื่อเปลี่ยนภาพ</span>
            <span>กด Esc เพื่อปิด</span>
          </div>
        </div>
      </div>
    </div>
  );
}

