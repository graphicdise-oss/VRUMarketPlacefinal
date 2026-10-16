import React, { useState } from "react";
import { DisputeAdminDto, DisputeBreakGlassDto, disputeAdminApi } from "@/lib/api";
import { formatDateTime, verdictBadge } from "./utils";
import { LazyFile } from "./LazyFile";
import { ChatHistory } from "./ChatHistory";
import { BreakGlass } from "./BreakGlass";
import { RulingPanel } from "./RulingPanel";

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <h4 className="font-black text-gray-800 mb-4 flex items-center gap-2 text-sm">
        <i className={`${icon} text-gray-400`}></i> {title}
      </h4>
      {children}
    </section>
  );
}

export function DisputeDetailModal({
  initial,
  onClose,
  onChanged,
}: {
  initial: DisputeAdminDto;
  onClose: () => void;
  onChanged: (updated: DisputeAdminDto) => void;
}) {
  const [dispute, setDispute] = useState(initial);
  const [revealed, setRevealed] = useState<DisputeBreakGlassDto | null>(null);
  const [revealReason, setRevealReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const badge = verdictBadge(dispute);

  const handleRuled = (updated: DisputeAdminDto) => {
    setDispute(updated);
    onChanged(updated);
    setNotice(
      updated.closedAt
        ? "บันทึกคำตัดสินแล้ว — ข้อพิพาทนี้ปิดและจะหายจากคิว"
        : "บันทึกคำตัดสินแล้ว — ข้อพิพาทนี้ยังอยู่ในคิวจนกว่ากระบวนการคืนเงินจะจบ",
    );
  };

  const evidenceLabel = (submitterId: string): string => {
    if (!revealed) return "ไฟล์แนบ";
    return submitterId === revealed.order.buyerId ? "ผู้ซื้อแนบ" : "ร้านค้าแนบ";
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto backdrop-blur-sm">
      <div className="bg-gray-50 rounded-3xl w-full max-w-4xl my-6 overflow-hidden shadow-2xl">
        <div className="bg-gray-900 p-6 flex justify-between items-start text-white">
          <div>
            <h3 className="font-black text-2xl mb-1 flex items-center gap-2">
              <i className="fa-solid fa-scale-unbalanced text-amber-400"></i> ข้อพิพาท
            </h3>
            <p className="text-gray-400 text-xs font-mono break-all">Order: {dispute.orderId}</p>
            <p className="text-gray-400 text-xs mt-1">เปิดเมื่อ {formatDateTime(dispute.createdAt)}</p>
          </div>
          <div className="flex items-start gap-4">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="ปิด">
              <i className="fa-solid fa-xmark text-xl"></i>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {notice && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-medium rounded-xl px-4 py-3">
              <i className="fa-solid fa-circle-check mr-2"></i>
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Section title="ฝั่งผู้ซื้อ (ผู้ร้องเรียน)" icon="fa-solid fa-user">
              <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 leading-relaxed whitespace-pre-wrap">{dispute.reason}</p>
            </Section>
            <Section title="ฝั่งร้านค้า (คำชี้แจง)" icon="fa-solid fa-store">
              {dispute.shopResponse ? (
                <>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-xl border border-gray-100 leading-relaxed whitespace-pre-wrap">{dispute.shopResponse}</p>
                  <p className="text-[11px] text-gray-400 mt-2">ตอบเมื่อ {formatDateTime(dispute.respondedAt)}</p>
                </>
              ) : (
                <p className="text-sm text-gray-400">ร้านค้ายังไม่ได้ตอบกลับ</p>
              )}
            </Section>
          </div>

          <Section title={`หลักฐานที่แนบ (${dispute.evidence.length})`} icon="fa-solid fa-paperclip">
            {dispute.evidence.length === 0 ? (
              <p className="text-sm text-gray-400">ไม่มีหลักฐานแนบ</p>
            ) : (
              <>
                <p className="text-[11px] text-gray-400 mb-3">การเปิดดูหลักฐานแต่ละครั้งถูกบันทึกใน audit log (DISPUTE_EVIDENCE_VIEWED)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {dispute.evidence.map((ev) => (
                    <div key={ev.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[11px] font-bold text-gray-500 mb-2">
                        {evidenceLabel(ev.submitterId)} · {ev.fileName} · {(ev.fileSize / 1024).toFixed(0)} KB
                      </p>
                      <LazyFile label="ดูหลักฐาน" load={() => disputeAdminApi.readEvidence(dispute.id, ev.id)} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>

          <Section title="ประวัติแชทระหว่างคู่กรณี" icon="fa-solid fa-comments">
            {dispute.chatRoomId ? (
              <ChatHistory roomId={dispute.chatRoomId} buyerId={revealed?.order.buyerId ?? null} />
            ) : (
              <p className="text-sm text-gray-400">ผู้ซื้อกับร้านค้าไม่เคยเปิดห้องแชทคุยกัน</p>
            )}
          </Section>

          <Section title="ข้อมูลส่วนตัวและสลิปโอนเงิน" icon="fa-solid fa-user-lock">
            <BreakGlass
              dispute={dispute}
              revealed={revealed}
              revealReason={revealReason}
              onRevealed={(data, reason) => {
                setRevealed(data);
                setRevealReason(reason);
              }}
            />
          </Section>

          <Section title="คำตัดสิน" icon="fa-solid fa-gavel">
            <RulingPanel dispute={dispute} onRuled={handleRuled} />
          </Section>
        </div>
      </div>
    </div>
  );
}
