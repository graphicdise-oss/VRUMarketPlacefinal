"use client";

import React, { useState, useMemo } from "react";
import ProductImageLightbox from "@/components/product/ProductImageLightbox";

interface ProductDescriptionProps {
  description?: string;
  className?: string;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string };

/**
 * Parses a product description string into text and image blocks.
 * Supports:
 * 1. Markdown image syntax: ![alt text](https://example.com/image.jpg)
 * 2. HTML img tags: <img src="https://example.com/image.jpg" alt="..." />
 * 3. Standalone image URLs on their own lines: https://example.com/image.png
 */
export function parseProductDescription(raw?: string): ContentBlock[] {
  if (!raw) return [];

  const imageRegex =
    /(!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^\s\)]+)\)|<img[^>]+src=["']((?:https?:\/\/|\/)[^"']+)["'][^>]*>|^(https?:\/\/\S+\.(?:png|jpe?g|webp|gif|svg)(?:\?\S*)?)$)/gim;

  const blocks: ContentBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = raw.slice(lastIndex, match.index);
      if (textChunk.trim()) {
        blocks.push({ type: "text", text: textChunk });
      }
    }

    let src = "";
    let alt = "";

    if (match[1]?.startsWith("![")) {
      alt = match[2] || "ภาพรายละเอียดสินค้า";
      src = match[3] || "";
    } else if (match[1]?.startsWith("<img")) {
      src = match[4] || "";
      const altMatch = /alt=["']([^"']*)["']/i.exec(match[0]);
      alt = altMatch ? altMatch[1] : "ภาพรายละเอียดสินค้า";
    } else if (match[5]) {
      src = match[5];
      alt = "ภาพรายละเอียดสินค้า";
    }

    if (src) {
      blocks.push({ type: "image", src, alt });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    const remainingText = raw.slice(lastIndex);
    if (remainingText.trim()) {
      blocks.push({ type: "text", text: remainingText });
    }
  }

  if (blocks.length === 0 && raw.trim()) {
    blocks.push({ type: "text", text: raw });
  }

  return blocks;
}

export default function ProductDescription({
  description,
  className = "",
}: ProductDescriptionProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const blocks = useMemo(() => parseProductDescription(description), [description]);

  const allImages = useMemo(() => {
    return blocks
      .filter((b): b is { type: "image"; src: string; alt: string } => b.type === "image")
      .map((b) => b.src);
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <p className="text-gray-400 italic text-xs sm:text-sm">
        ไม่มีรายละเอียดสินค้าเพิ่มเติม
      </p>
    );
  }

  return (
    <>
      <div className={`space-y-3 sm:space-y-4 ${className}`}>
        {blocks.map((block, idx) => {
          if (block.type === "image") {
            const imageIndex = allImages.indexOf(block.src);
            return (
              <div
                key={idx}
                onClick={() => setLightboxIndex(imageIndex >= 0 ? imageIndex : 0)}
                className="my-3 rounded-2xl sm:rounded-3xl overflow-hidden border border-gray-100 bg-gray-50/50 shadow-2xs max-w-2xl group relative cursor-zoom-in transition-all hover:border-[#16A085]/40 hover:shadow-md"
                title="คลิกเพื่อดูภาพขนาดใหญ่"
              >
                <img
                  src={block.src}
                  alt={block.alt}
                  loading="lazy"
                  className="w-full h-auto object-contain max-h-[700px] transition-transform duration-300 group-hover:scale-[1.01]"
                />
                <div className="absolute bottom-2.5 right-2.5 bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 shadow-sm">
                  <i className="fa-solid fa-magnifying-glass-plus text-xs"></i>
                  <span>คลิกเพื่อขยายภาพ</span>
                </div>
              </div>
            );
          }
          return (
            <div
              key={idx}
              className="prose prose-sm max-w-none text-gray-600 whitespace-pre-line leading-relaxed text-xs sm:text-sm"
            >
              {block.text}
            </div>
          );
        })}
      </div>

      {/* Shopee-style Lightbox Modal for Description Images */}
      {lightboxIndex !== null && (
        <ProductImageLightbox
          isOpen={true}
          onClose={() => setLightboxIndex(null)}
          images={allImages}
          initialIndex={lightboxIndex}
          productTitle="ภาพรายละเอียดสินค้า"
        />
      )}
    </>
  );
}
