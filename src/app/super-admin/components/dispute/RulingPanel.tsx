import React, { useState } from "react";
import { DisputeAdminDto, disputeAdminApi } from "@/lib/api";
import { errorMessage, formatDateTime } from "./utils";
import { ReasonField, MIN_REASON, MAX_REASON } from "./ReasonField";

type Verdict = "BUYER_WINS" | "SHOP_WINS";

export function RulingPanel({
  dispute,
  onRuled,
}: {
  dispute: DisputeAdminDto;
  onRuled: (updated: DisputeAdminDto) => void;
}) {
  const alreadyRuled = dispute.verdict !== null;
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (v: Verdict) => (v === "BUYER_WINS" ? "ผู้ซื้อ" : "ร้านค้า");
  const canSubmit = verdict !== null && reason.trim().length >= MIN_REASON && !busy;

  const submit = async () => {
    if (!verdict) return;
    const message = alreadyRuled
      ? `ยืนยันกลับคำตัดสินให้ "${label(verdict)}" ชนะ?\nคำตัดสินเดิมจะถูกเขียนทับ และคะแนนข้อพิพาทที่แพ้ของร้านจะปรับตามคำตัดสินใหม่`
      : `ยืนยันคำตัดสินให้ "${label(verdict)}" ชนะ?\nเหตุผลจะแสดงให้ทั้งสองฝ่ายเห็น และไม่มีขั้นตอนอุทธรณ์`;
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      const call = alreadyRuled ? disputeAdminApi.override : disputeAdminApi.rule;
      const result = await call(dispute.id, verdict, reason.trim());
      onRuled({ ...dispute, ...result });
      setVerdict(null);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {alreadyRuled && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm">
          <p className="text-xs font-bold text-gray-500 mb-1">คำตัดสินปัจจุบัน ({formatDateTime(dispute.ruledAt)})</p>
          <p className="font-bold text-gray-800">ให้{dispute.verdict === "BUYER_WINS" ? "ผู้ซื้อ" : "ร้านค้า"}ชนะ</p>
          <p className="text-gray-600 mt-1 whitespace-pre-wrap">{dispute.rulingReason}</p>
        </div>
      )}

      <div>
        <p className="text-xs font-bold text-gray-500 mb-2">
          {alreadyRuled ? "กลับคำตัดสิน (เฉพาะ Super Admin)" : "ตัดสินข้อพิพาท"}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setVerdict("SHOP_WINS")}
            className={`py-3 px-4 rounded-xl text-sm font-bold border-2 transition ${verdict === "SHOP_WINS" ? "bg-green-500 text-white border-green-500" : "bg-white text-green-600 border-green-300 hover:bg-green-50"}`}
          >
            <i className="fa-solid fa-store mr-2"></i> ให้ &quot;ร้านค้า&quot; ชนะ
          </button>
          <button
            type="button"
            onClick={() => setVerdict("BUYER_WINS")}
            className={`py-3 px-4 rounded-xl text-sm font-bold border-2 transition ${verdict === "BUYER_WINS" ? "bg-red-500 text-white border-red-500" : "bg-white text-red-600 border-red-300 hover:bg-red-50"}`}
          >
            <i className="fa-solid fa-user-check mr-2"></i> ให้ &quot;ผู้ซื้อ&quot; ชนะ (สั่งคืนเงิน)
          </button>
        </div>
      </div>

      <ReasonField value={reason} onChange={setReason} placeholder="เหตุผลของคำตัดสิน — ทั้งผู้ซื้อและร้านค้าจะเห็นข้อความนี้" max={MAX_REASON} />

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="w-full py-3 rounded-xl font-bold text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy && <i className="fa-solid fa-spinner fa-spin"></i>}
        {alreadyRuled ? "บันทึกการกลับคำตัดสิน" : "บันทึกคำตัดสิน"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <p className="text-[11px] text-gray-400 leading-relaxed">
        * ระบบไม่ได้ถือเงินไว้ หากผู้ซื้อชนะ ออเดอร์จะเข้าสถานะ &quot;สั่งคืนเงิน&quot; ให้ร้านโอนคืนเอง และนับเป็นข้อพิพาทที่ร้านแพ้ ส่วนกรณีร้านชนะ สถานะออเดอร์ไม่เปลี่ยน
      </p>
    </div>
  );
}
