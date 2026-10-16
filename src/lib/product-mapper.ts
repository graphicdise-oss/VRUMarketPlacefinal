import type { Product } from "@/types";
import type { PublicProductDto, ProductDto } from "@/lib/api-modules/product";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

const FALLBACK_PRODUCT_IMAGE = "/images/products/thai_default.jpg";

function getFallbackImage(categoryName = ""): string {
  const cat = categoryName.toLowerCase();
  if (cat.includes('อาหารสด') || cat.includes('วัตถุดิบ')) return '/images/products/thai_salad.jpg';
  if (cat.includes('แปรรูป') || cat.includes('ขนม')) return '/images/products/thai_banana_chips.jpg';
  if (cat.includes('เครื่องดื่ม')) return '/images/products/thai_lotus_tea.jpg';
  if (cat.includes('เกษตร') || cat.includes('ผลิตผล')) return '/images/products/thai_rice.jpg';
  if (cat.includes('ฝีมือ') || cat.includes('ของที่ระลึก')) return '/images/products/thai_tissue_box.jpg';
  if (cat.includes('เสื้อผ้า') || cat.includes('เครื่องแต่งกาย')) return '/images/products/thai_silk_shawl.jpg';
  if (cat.includes('สุขภาพ') || cat.includes('ความงาม')) return '/images/products/thai_mangosteen_soap.jpg';
  if (cat.includes('ของใช้')) return '/images/products/thai_rattan_basket.jpg';
  if (cat.includes('นวัตกรรม')) return '/images/products/thai_lemongrass_spray.jpg';
  return FALLBACK_PRODUCT_IMAGE;
}

export function getProductFallbackImage(name = "", categoryName = "", description = ""): string {
  const n = name.toLowerCase();
  const c = categoryName.toLowerCase();
  const d = description.toLowerCase();

  // 1. High-priority exact item type matches by product NAME
  if (n.includes('สบู่')) return '/images/products/thai_mangosteen_soap.jpg';
  if (n.includes('เทียน')) return '/images/products/thai_candle.jpg';
  if (n.includes('น้ำพริก')) return '/images/products/thai_chili_paste.jpg';
  if (n.includes('ผ้าคลุมไหล่') || n.includes('ผ้าไหม')) return '/images/products/thai_silk_shawl.jpg';
  if (n.includes('เสื้อ')) return '/images/products/thai_shirt.jpg';
  if (n.includes('กล่องทิชชู่') || n.includes('ทิชชู่')) return '/images/products/thai_tissue_box.jpg';
  if (n.includes('กระเป๋า') || n.includes('กระจูด')) return '/images/products/thai_reed_bag.jpg';
  if (n.includes('ตะกร้า') || n.includes('หวาย')) return '/images/products/thai_rattan_basket.jpg';
  if (n.includes('กล้วย')) return '/images/products/thai_banana_chips.jpg';
  if (n.includes('ส้ม')) return '/images/products/thai_orange.jpg';
  if (n.includes('เมลอน') || n.includes('เมล่อน')) return '/images/products/thai_melon.jpg';
  if (n.includes('มัลเบอร์รี่') || n.includes('หม่อน')) return '/images/products/thai_mulberry_juice.jpg';
  if (n.includes('ชาเกสร') || (n.includes('ชา') && n.includes('บัว'))) return '/images/products/thai_lotus_tea.jpg';
  if (n.includes('คอมบูชา')) return '/images/products/thai_kombucha.jpg';
  if (n.includes('สเปรย์') || n.includes('กันยุง')) return '/images/products/thai_lemongrass_spray.jpg';
  if (n.includes('เซรั่ม')) return '/images/products/thai_coconut_serum.jpg';
  if (n.includes('สลัด') || n.includes('ผัก')) return '/images/products/thai_salad.jpg';
  if (n.includes('น้ำผึ้ง')) return '/images/products/thai_honey.jpg';
  if (n.includes('ข้าว')) return '/images/products/thai_rice.jpg';

  // 2. Fallbacks for seasonal prototypes by Category
  if (c.includes('อาหารสด') || c.includes('วัตถุดิบ')) return '/images/products/thai_salad.jpg';
  if (c.includes('แปรรูป') || c.includes('ขนม')) return '/images/products/thai_banana_chips.jpg';
  if (c.includes('เครื่องดื่ม')) return '/images/products/thai_lotus_tea.jpg';
  if (c.includes('เกษตร') || c.includes('ผลิตผล')) return '/images/products/thai_rice.jpg';
  if (c.includes('ฝีมือ') || c.includes('ของที่ระลึก')) return '/images/products/thai_tissue_box.jpg';
  if (c.includes('เสื้อผ้า') || c.includes('แต่งกาย')) return '/images/products/thai_silk_shawl.jpg';
  if (c.includes('สุขภาพ') || c.includes('ความงาม')) return '/images/products/thai_mangosteen_soap.jpg';
  if (c.includes('ของใช้')) return '/images/products/thai_rattan_basket.jpg';
  if (c.includes('นวัตกรรม')) return '/images/products/thai_lemongrass_spray.jpg';

  // 3. Fallbacks by Description if name is generic (e.g. สินค้าต้นแบบ)
  if (d.includes('ส้ม')) return '/images/products/thai_orange.jpg';
  if (d.includes('ข้าว')) return '/images/products/thai_rice.jpg';
  if (d.includes('ชา')) return '/images/products/thai_lotus_tea.jpg';

  return getFallbackImage(categoryName);
}

/** Maps the backend public product DTO into the UI's `Product` view-model. */
export function mapPublicProductDto(p: PublicProductDto, communityName = ""): Product {
  const fallbackImg = getProductFallbackImage(p.name, p.categoryNameTh, p.description);
  return {
    id: p.id,
    name: p.name,
    description: p.description || "",
    images:
      p.images && p.images.length > 0
        ? p.images.map((img) => `${API_BASE_URL}/products/${p.id}/images/${img.id}`)
        : [fallbackImg],
    shopId: p.shopId,
    shopName: p.shopName || "ร้านค้าชุมชน",
    communityId: p.communityId,
    communityName,
    categoryId: p.categoryId,
    categoryName: p.categoryNameTh || "สินค้าทั่วไป",
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      priceMinor: v.priceAmountMinor,
      stock: v.stock,
    })),
    publishStatus: "PUBLISHED",
    moderationStatus: "APPROVED",
    createdAt: p.createdAt,
    updatedAt: p.createdAt,
    views: 0,
    soldCount: p.soldCount ?? 0,
  };
}

/** Maps the backend seller product DTO into the UI's `Product` view-model. */
export function mapProductDto(p: ProductDto): Product {
  const fallbackImg = getProductFallbackImage(p.name, "", p.description);
  return {
    id: p.id,
    name: p.name,
    description: p.description || "",
    images:
      p.images && p.images.length > 0
        ? p.images.map((img) => `${API_BASE_URL}/products/${p.id}/images/${img.id}`)
        : [fallbackImg],
    shopId: p.shopId,
    shopName: "ร้านค้าของคุณ", // Might need to be fetched separately if needed
    communityId: "", // Seller endpoint does not return this natively
    communityName: "",
    categoryId: p.categoryId,
    categoryName: "หมวดหมู่", 
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      priceMinor: v.priceAmountMinor,
      stock: v.stock,
    })),
    publishStatus: p.shopPublishStatus,
    moderationStatus: p.moderationStatus,
    createdAt: p.createdAt,
    updatedAt: p.createdAt,
    views: 0,
    soldCount: (p.variants ?? []).reduce((sum, v) => sum + (v.soldCount ?? 0), 0),
  };
}
