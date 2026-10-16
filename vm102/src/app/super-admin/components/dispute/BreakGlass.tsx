import React, { useState } from "react";
import { DisputeAdminDto, DisputeBreakGlassDto, disputeAdminApi } from "@/lib/api";
import { errorMessage, formatDateTime, formatMoney } from "./utils";
import { ReasonField, MIN_REASON } from "./ReasonField";
import { LazyFile } from "./LazyFile";

export function BreakGlass({
  dispute,
  revealed,
  revealReason,
  onRevealed,
}: {
  dispute: DisputeAdminDto;
  revealed: DisputeBreakGlassDto | null;
  revealReason: string;
  onRevealed: (data: DisputeBreakGlassDto, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await disputeAdminApi.breakGlass(dispute.id, reason.trim());
      onRevealed(data, reason.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!revealed) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          ชื่อ ที่อยู่ เบอร์โทร และสลิปโอนเงินถูกซ่อนไว้ตามปกติ (I5) การเปิดดูต้องระบุเหตุผล และจะถูกบันทึกเป็น <b>DISPUTE_IDENTITY_REVEALED</b> ใช้ได้เฉพาะตอนที่ข้อพิพาทยังเปิดอยู่
        </p>
        <ReasonField value={reason} onChange={setReason} placeholder="เหตุผลที่ต้องดูข้อมูลส่วนตัว เช่น ต้องตรวจที่อยู่จัดส่งจริงเทียบกับที่ผู้ซื้อร้องเรียน" max={500} />
        <button
          type="button"
          onClick={reveal}
          disabled={busy || reason.trim().length < MIN_REASON}
          className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className={busy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-unlock"}></i> เปิดดูข้อมูลส่วนตัว (Break-glass)
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  const { order, paymentSlips } = revealed;
  const address = [
    order.houseNumber,
    order.villageNumber ? `หมู่ ${order.villageNumber}` : null,
    order.alley ? `ซอย ${order.alley}` : null,
    order.road ? `ถนน ${order.road}` : null,
    order.subdistrictName,
    order.districtName,
    order.provinceName,
    order.postalCode,
  ]
    .filter(Boolean)
    .join(" ");

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-100 text-sm">
      <span className="text-gray-500 font-bold shrink-0">{k}</span>
      <span className="text-gray-800 text-right break-words">{v}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
        <i className="fa-solid fa-eye mr-1"></i> กำลังแสดงข้อมูลส่วนตัว — จะปิดเข้าถึงทันทีเมื่อข้อพิพาทปิด
      </div>
      <div>
        {row("ผู้รับ", order.recipientName)}
        {row("เบอร์โทร", order.phone)}
        {row("ที่อยู่จัดส่ง", address)}
        {row("สถานะออเดอร์", order.displayStatus)}
        {row("ยอดรวม", formatMoney(order.totalAmountMinor, order.currency))}
        {row("ขนส่ง / เลขพัสดุ", `${order.shippingCarrierName ?? "-"} / ${order.trackingNumber ?? "-"}`)}
        {row("วันที่จัดส่ง", formatDateTime(order.shippedAt))}
        {order.refundAccountType &&
          row(
            "บัญชีรับเงินคืน",
            order.refundAccountType === "PROMPTPAY"
              ? `พร้อมเพย์ ${order.refundPromptPayId ?? "-"}`
              : `${order.refundBankName ?? ""} ${order.refundBankAccountNumber ?? ""} (${order.refundBankAccountName ?? ""})`,
          )}
      </div>

      <div>
        <p className="text-xs font-bold text-gray-500 mb-2">รายการสินค้า</p>
        <ul className="space-y-1">
          {order.items.map((it) => (
            <li key={it.id} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
              <span>
                {it.productNameAtPurchase} <span className="text-gray-400">({it.variantNameAtPurchase})</span> × {it.quantity}
              </span>
              <span className="font-bold">{formatMoney(it.priceAtPurchase * it.quantity, it.currency)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-bold text-gray-500 mb-2">สลิปการโอนเงิน ({paymentSlips.length})</p>
        {paymentSlips.length === 0 && <p className="text-xs text-gray-400">ผู้ซื้อยังไม่ได้อัปโหลดสลิป</p>}
        <div className="space-y-3">
          {paymentSlips.map((slip, i) => (
            <div key={slip.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                <span className="font-bold text-gray-700">สลิปที่ {i + 1}</span>
                <span className="text-gray-400">{formatDateTime(slip.createdAt)}</span>
                {slip.rejectedAt && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100">ร้านปฏิเสธ: {slip.rejectionReason}</span>}
                {slip.supersededAt && !slip.rejectedAt && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">รอบก่อนหน้า</span>}
              </div>
              <LazyFile label="ดูสลิป (บันทึกใน audit log)" load={() => disputeAdminApi.readSlip(dispute.id, slip.id, revealReason)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
