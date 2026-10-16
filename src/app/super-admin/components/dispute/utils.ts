import { DisputeAdminDto } from "@/lib/api";

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่");

export const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-";

export const formatMoney = (minor: number | null, currency = "THB"): string =>
  minor === null ? "-" : `${(minor / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} ${currency === "THB" ? "บาท" : currency}`;

export function verdictBadge(dispute: DisputeAdminDto) {
  if (dispute.verdict === "BUYER_WINS") {
    return { label: "ตัดสินให้ผู้ซื้อ · รอคืนเงิน", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  if (dispute.verdict === "SHOP_WINS") {
    return { label: "ตัดสินให้ร้านค้า", cls: "bg-green-50 text-green-700 border-green-200" };
  }
  return { label: "รอตัดสิน", cls: "bg-red-50 text-red-600 border-red-200" };
}
