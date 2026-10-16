import React, { useMemo, useState } from "react";
import { adminChatApi, AdminChatMessageDto } from "@/lib/api";
import { errorMessage, formatDateTime } from "./utils";
import { LazyFile } from "./LazyFile";

export function ChatHistory({
  roomId,
  buyerId,
}: {
  roomId: string;
  buyerId: string | null;
}) {
  const [messages, setMessages] = useState<AdminChatMessageDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (cursor?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminChatApi.listMessages(roomId, cursor);
      setMessages((prev) => [...(prev ?? []), ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ordered = useMemo(
    () => [...(messages ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  // Two parties only: with the buyer known (after break-glass) name them; otherwise A / B by first appearance.
  const senderIds = useMemo(() => Array.from(new Set(ordered.map((m) => m.senderId))), [ordered]);
  const labelOf = (senderId: string): string => {
    if (buyerId) return senderId === buyerId ? "ผู้ซื้อ" : "ร้านค้า";
    return `ฝ่าย ${String.fromCharCode(65 + senderIds.indexOf(senderId))}`;
  };

  if (messages === null) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          การเปิดอ่านแชทจะถูกบันทึกใน audit log (เฉพาะว่าใครเปิดห้องไหนเมื่อไหร่ ไม่เก็บเนื้อหา) และอ่านได้เฉพาะตอนที่ข้อพิพาทยังเปิดอยู่
        </p>
        <button
          type="button"
          onClick={() => load()}
          disabled={busy}
          className="px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-60"
        >
          <i className={busy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-comments"}></i> เปิดอ่านประวัติแชทของคู่กรณี
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {nextCursor && (
        <button
          type="button"
          onClick={() => load(nextCursor)}
          disabled={busy}
          className="mb-3 text-xs font-bold text-blue-600 hover:underline disabled:opacity-60"
        >
          {busy ? "กำลังโหลด..." : "โหลดข้อความที่เก่ากว่า"}
        </button>
      )}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="max-h-72 overflow-y-auto space-y-3 bg-gray-50 rounded-xl p-4 border border-gray-100">
        {ordered.length === 0 && <p className="text-xs text-gray-400 text-center">ยังไม่มีข้อความในห้องนี้</p>}
        {ordered.map((m) => {
          const label = labelOf(m.senderId);
          const isBuyer = label === "ผู้ซื้อ" || label === "ฝ่าย A";
          return (
            <div key={m.id} className={`flex flex-col ${isBuyer ? "items-start" : "items-end"}`}>
              <span className="text-[10px] font-bold text-gray-400 mb-0.5">
                {label} · {formatDateTime(m.createdAt)}
              </span>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${isBuyer ? "bg-white border border-gray-200" : "bg-indigo-50 border border-indigo-100"}`}>
                {m.content || (m.fileId ? "" : <span className="text-gray-400">(ไม่มีข้อความ)</span>)}
                {m.fileId && (
                  <div className="mt-2">
                    <LazyFile label="ดูรูปที่แนบ" load={() => adminChatApi.readAttachment(roomId, m.fileId as string)} />
                  </div>
                )}
              </div>
              {(m.editedAt || m.unsentAt) && (
                <span className="text-[10px] text-orange-500 mt-0.5">
                  {m.unsentAt ? "ผู้ส่งยกเลิกข้อความนี้แล้ว (เห็นเฉพาะแอดมิน)" : "แก้ไขแล้ว"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
