/**
 * Utility functions for VRU Marketplace
 * เงินทุกฟิลด์เก็บเป็น "สตางค์" (integer) ตาม Backend spec
 */

/**
 * แปลงราคาจากสตางค์ (integer) เป็นบาท พร้อม format
 * @param amountMinor - จำนวนเงินหน่วยสตางค์ (เช่น 19950 = 199.50 บาท)
 */
export const formatPrice = (amountMinor: number): string => {
  const baht = amountMinor / 100;
  return "฿" + baht.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * แปลงราคาจากสตางค์เป็นบาท (ตัวเลขล้วน ไม่มีสัญลักษณ์)
 */
export const minorToBaht = (amountMinor: number): number => {
  return amountMinor / 100;
};

/**
 * แปลงราคาจากบาทเป็นสตางค์
 */
export const bahtToMinor = (baht: number): number => {
  return Math.round(baht * 100);
};

/**
 * นับถอยหลังจาก deadline → แสดงเป็น "XX ชม. XX นาที"
 */
export const formatCountdown = (deadline: string): string => {
  const now = new Date().getTime();
  const target = new Date(deadline).getTime();
  const diff = target - now;

  if (diff <= 0) return "หมดเวลาแล้ว";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  return `${minutes} นาที`;
};

/**
 * คำนวณเปอร์เซ็นต์เวลาที่เหลือ (ใช้สำหรับ progress bar)
 */
export const getCountdownPercentage = (deadline: string, totalHours: number): number => {
  const now = new Date().getTime();
  const target = new Date(deadline).getTime();
  const diff = target - now;
  const total = totalHours * 60 * 60 * 1000;

  if (diff <= 0) return 0;
  return Math.min(100, Math.max(0, (diff / total) * 100));
};

/**
 * Format วันที่เป็นภาษาไทย
 */
export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

/**
 * Format วันที่ + เวลา เป็นภาษาไทย
 */
export const formatDateTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * Format เป็นเวลาสัมพัทธ์ เช่น "3 นาทีที่แล้ว"
 */
export const formatRelativeTime = (dateStr: string): string => {
  const now = new Date().getTime();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  if (days < 7) return `${days} วันที่แล้ว`;
  return formatDate(dateStr);
};

/**
 * แปลง OrderStatus เป็นข้อความภาษาไทย
 */
export const getOrderStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    AWAITING_SHIPPING_QUOTE: "รอร้านแจ้งค่าส่ง",
    AWAITING_PAYMENT: "รอชำระเงิน",
    PAYMENT_SUBMITTED: "รอร้านยืนยัน",
    PAID: "ชำระแล้ว รอจัดส่ง",
    SHIPPED: "กำลังจัดส่ง",
    COMPLETED: "เสร็จสิ้น",
    CANCELLED: "ยกเลิกแล้ว",
    FROZEN: "แช่แข็ง (รอตรวจสอบ)",
    REFUND_ORDERED: "รอร้านคืนเงิน",
    REFUNDED: "คืนเงินแล้ว",
    DISPUTED: "ข้อพิพาทเปิดอยู่",
  };
  return labels[status] || status;
};

/**
 * แปลง OrderStatus เป็นสี (Tailwind class)
 */
export const getOrderStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    AWAITING_SHIPPING_QUOTE: "text-yellow-600 bg-yellow-50",
    AWAITING_PAYMENT: "text-orange-600 bg-orange-50",
    PAYMENT_SUBMITTED: "text-blue-600 bg-blue-50",
    PAID: "text-indigo-600 bg-indigo-50",
    SHIPPED: "text-purple-600 bg-purple-50",
    COMPLETED: "text-green-600 bg-green-50",
    CANCELLED: "text-gray-500 bg-gray-100",
    FROZEN: "text-red-600 bg-red-50",
    REFUND_ORDERED: "text-rose-600 bg-rose-50",
    REFUNDED: "text-teal-700 bg-teal-50",
    DISPUTED: "text-amber-700 bg-amber-50",
  };
  return colors[status] || "text-gray-500 bg-gray-100";
};

/**
 * Truncate ข้อความ
 */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
};

/**
 * สร้าง unique cart item key
 */
export const getCartItemKey = (productId: string, variantId: string): string => {
  return `${productId}-${variantId}`;
};

/**
 * ดึงข้อความ error จากค่า unknown ที่ถูก throw (แทนการใช้ `catch (e: any)`)
 */
export const getErrorMessage = (err: unknown, fallback = "Unknown error"): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
};
