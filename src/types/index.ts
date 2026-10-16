// TypeScript type definitions for VRU Marketplace
// Aligned with Backend schema (CLAUDE.md + FRONTEND-NOTES.md)

// ─── Enums ───────────────────────────────────────────────

export type UserRole = "USER" | "SUPER_ADMIN";

export type OrderStatus =
  | "AWAITING_SHIPPING_QUOTE"   // รอร้านใส่ค่าส่ง (24 ชม.)
  | "AWAITING_PAYMENT"          // รอผู้ซื้อโอนเงิน (24 ชม.)
  | "PAYMENT_SUBMITTED"         // รอร้านยืนยันเงินเข้า (3 วัน)
  | "PAID"                      // ชำระเงินแล้ว รอจัดส่ง
  | "SHIPPED"                   // กำลังจัดส่ง
  | "COMPLETED"                 // เสร็จสิ้น
  | "CANCELLED"                 // ยกเลิก
  | "FROZEN"                    // แช่แข็ง (ร้านถูกระงับ)
  | "REFUND_ORDERED"            // รอร้านคืนเงิน (7 วัน)
  | "REFUNDED"                  // คืนเงินแล้ว
  | "DISPUTED";                 // ข้อพิพาทเปิดอยู่

export type ShopApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";

export type ProductModerationStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ProductPublishStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

export type DisputeStatus = "OPEN" | "RESOLVED_BUYER" | "RESOLVED_SELLER" | "ESCALATED" | "CLOSED";

// ─── User & Auth ─────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  emailVerified: boolean;
  isBanned: boolean;
  shopId?: string;         // ถ้ามีร้าน (1 คน = 1 ร้าน)
  adminCommunityIds?: string[]; // ชุมชนที่เป็นแอดมิน
  createdAt: string;
}

// ─── Community ───────────────────────────────────────────

export interface Community {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  createdAt: string;
}

// ─── Shop ────────────────────────────────────────────────

export interface PaymentChannel {
  type: "BANK_TRANSFER" | "PROMPTPAY_QR";
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  qrImageUrl?: string;
}

export interface Shop {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  coverImageUrl?: string;
  ownerId: string;
  communityId: string;
  communityName?: string;
  approvalStatus: ShopApprovalStatus;
  paymentChannels: PaymentChannel[];
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

// ─── Product & Variant ──────────────────────────────────

export interface ProductVariant {
  id: string;
  name: string;            // เช่น "สีแดง / ไซส์ L"
  priceMinor: number;      // สตางค์ (integer)
  stock: number;
  sku?: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  images: string[];         // สูงสุด 10 รูป
  shopId: string;
  shopName: string;
  communityId: string;
  communityName?: string;
  categoryId: string;
  categoryName?: string;
  variants: ProductVariant[];
  publishStatus: ProductPublishStatus;
  moderationStatus: ProductModerationStatus;
  status?: string;
  rating?: number;
  soldCount?: number;
  views: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Category ────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  icon: string;
  bgColor: string;
  textColor: string;
  hoverBg: string;
  isBold?: boolean;
}

// ─── Address ─────────────────────────────────────────────
// ชื่อผู้รับ + เบอร์โทรอยู่ที่ที่อยู่ ไม่ใช่บน User

export interface Address {
  id: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  subdistrictPostalCodeId: string;
  postalCode: string;
  subdistrictId: string;
  subdistrictNameTh: string;
  districtId: string;
  districtNameTh: string;
  provinceId: string;
  provinceNameTh: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Cart ────────────────────────────────────────────────

export interface CartItem {
  id: string;               // unique key for cart
  productId: string;
  variantId: string;
  variantName: string;
  name: string;              // ชื่อสินค้า
  priceMinor: number;        // สตางค์
  image: string;
  qty: number;
  shopId: string;
  shopName: string;
  orderable?: boolean;
}

// ─── Order ───────────────────────────────────────────────
// ราคาและที่อยู่เป็น snapshot ห้ามดึงจาก Product/User ปัจจุบัน

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string;
  productNameAtPurchase: string;
  variantNameAtPurchase: string;
  priceAtPurchaseMinor: number;   // สตางค์ snapshot
  qty: number;
  imageAtPurchase: string;
}

export interface OrderAddressSnapshot {
  recipientName: string;
  phone: string;
  addressLine: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export interface Order {
  id: string;
  buyerId: string;
  shopId: string;
  shopName: string;
  status: OrderStatus;
  items: OrderItem[];
  shippingAddress: OrderAddressSnapshot;
  shippingCostMinor?: number;       // ร้านใส่ทีหลัง อาจ null
  totalAmountMinor?: number;         // ยังไม่มีค่าตอนสร้าง
  discountAmountMinor?: number;     // ส่วนลดคูปอง
  couponId?: string;
  couponCode?: string;
  slipImageUrl?: string;
  shippingSlipUrl?: string;          // สลิป / ใบเสร็จจัดส่งพัสดุ
  sellerConfirmedAt?: string;        // ห้ามใช้ paidAt
  sellerConfirmedBy?: string;
  shippingProvider?: string;
  trackingNumber?: string;
  rejectionReason?: string;          // เหตุผลปฏิเสธค่าส่ง
  // นาฬิกาสามเรือน
  shippingQuoteDeadline?: string;    // เรือนที่ 1
  paymentDeadline?: string;          // เรือนที่ 2
  confirmationDeadline?: string;     // เรือนที่ 3
  createdAt: string;
  shippedAt?: string;
  completedAt?: string;
}

// ─── Dispute ─────────────────────────────────────────────

export interface Dispute {
  id: string;
  orderId: string;
  buyerId: string;
  shopId: string;
  reason: string;
  evidenceUrls: string[];    // บังคับแนบหลักฐาน
  status: DisputeStatus;
  resolution?: string;
  resolvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─── Chat ────────────────────────────────────────────────
// ห้องผูกกับ (ผู้ซื้อ × ร้าน) ไม่ผูกกับ orderId

export interface ChatRoom {
  id: string;
  participantIds: string[];
  shopId: string;
  shopName: string;
  shopAvatarUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderType: "BUYER" | "SELLER";
  content: string;
  imageUrl?: string;
  createdAt: string;
  isRead: boolean;
}

// ─── Notification ────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "ORDER_STATUS" | "DISPUTE_RESULT" | "PRODUCT_APPROVED" | "PRODUCT_REJECTED" | "SHOP_APPROVED" | "GENERAL";
  referenceId?: string;
  isRead: boolean;
  createdAt: string;
}

// ─── Review ──────────────────────────────────────────────

export interface Review {
  id: string;
  orderId: string;
  productId: string;
  buyerId: string;
  buyerName: string;        // อาจเป็นค่าแทนถ้า user ลบบัญชี (PDPA)
  rating: number;           // 1-5
  comment: string;
  createdAt: string;
  lockedAt?: string;        // 7 วันหลังเขียน
}

// ─── Article (เดิม) ──────────────────────────────────────

export interface Article {
  id: string;
  title: string;
  description: string;
  content?: string;
  image: string;
  category: string;
  categoryColor: string;
  date: string;
  views: string;
}

// ─── Pagination (cursor-based) ───────────────────────────

export interface CursorPagination<T> {
  data: T[];
  nextCursor?: string;
  hasMore: boolean;
}

// ─── API Error Response (format เดียวทั้งระบบ) ──────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}