"use client";

import React, { useCallback, useEffect, useState } from "react";
import { DisputeAdminDto, disputeAdminApi } from "@/lib/api";
import { errorMessage, formatDateTime, verdictBadge } from "./dispute/utils";
import { DisputeDetailModal } from "./dispute/DisputeDetailModal";

type QueueFilter = "ALL" | "AWAITING" | "RULED";

export default function DisputesTab() {
  const [disputes, setDisputes] = useState<DisputeAdminDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [selected, setSelected] = useState<DisputeAdminDto | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await disputeAdminApi.getOpen(cursor);
      setDisputes((prev) => (cursor ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChanged = (updated: DisputeAdminDto) => {
    // SHOP_WINS closes the dispute and drops it from the queue; BUYER_WINS stays until its refund loop ends.
    setDisputes((prev) => (updated.closedAt ? prev.filter((d) => d.id !== updated.id) : prev.map((d) => (d.id === updated.id ? updated : d))));
  };

  const visible = disputes.filter((d) => (filter === "ALL" ? true : filter === "AWAITING" ? d.verdict === null : d.verdict !== null));
  const awaitingCount = disputes.filter((d) => d.verdict === null).length;

  const filters: { value: QueueFilter; label: string }[] = [
    { value: "ALL", label: `ทั้งหมด (${disputes.length})` },
    { value: "AWAITING", label: `รอตัดสิน (${awaitingCount})` },
    { value: "RULED", label: `ตัดสินแล้ว รอคืนเงิน (${disputes.length - awaitingCount})` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <i className="fa-solid fa-gavel text-gray-300"></i> ข้อพิพาทที่เปิดอยู่ทุกชุมชน
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            แอดมินชุมชนตัดสินในขั้นแรก ส่วน Super Admin ตัดสินแทนได้ หรือกลับคำตัดสินที่ตัดสินไปแล้ว (ไม่มีการอุทธรณ์จากผู้ใช้)
          </p>
        </div>
        <button
          onClick={() => load()}
          disabled={isLoading}
          className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm flex items-center gap-2 disabled:opacity-60"
        >
          <i className={`fa-solid fa-rotate ${isLoading ? "fa-spin" : ""}`}></i> รีเฟรช
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-full text-xs font-bold border transition ${filter === f.value ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
              <tr>
                <th className="px-6 py-5">รหัสคำสั่งซื้อ</th>
                <th className="px-6 py-5">เหตุผลที่ร้องเรียน</th>
                <th className="px-6 py-5">ร้านตอบแล้ว</th>
                <th className="px-6 py-5">สถานะ</th>
                <th className="px-6 py-5">วันที่เปิด</th>
                <th className="px-6 py-5 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && disputes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    <i className="fa-solid fa-spinner fa-spin mr-2"></i> กำลังโหลด...
                  </td>
                </tr>
              ) : (
                visible.map((d) => {
                  const badge = verdictBadge(d);
                  return (
                    <tr key={d.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-5 font-bold text-gray-800 font-mono bg-gray-50/50">{d.orderId.substring(0, 8)}...</td>
                      <td className="px-6 py-5 max-w-xs">
                        <span className="text-gray-700 font-medium line-clamp-2">{d.reason}</span>
                      </td>
                      <td className="px-6 py-5">
                        {d.respondedAt ? (
                          <span className="text-green-600 font-bold text-xs">ตอบแล้ว</span>
                        ) : (
                          <span className="text-gray-400 text-xs">ยังไม่ตอบ</span>
                        )}
                      </td>
                      <td className="px-6 py-5">
                        <span className={`text-xs font-bold px-3 py-1.5 rounded-full border whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-6 py-5 text-gray-600 font-medium whitespace-nowrap">{formatDateTime(d.createdAt)}</td>
                      <td className="px-6 py-5 text-center">
                        <button
                          onClick={() => setSelected(d)}
                          className="bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white border border-orange-100 font-bold py-2.5 px-5 rounded-xl text-xs transition-colors shadow-sm inline-flex items-center gap-2"
                        >
                          <i className="fa-solid fa-magnifying-glass"></i> ตรวจสอบ
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
              {!isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    ไม่มีข้อพิพาทในคิว
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div className="p-4 border-t border-gray-100 text-center">
            <button onClick={() => load(nextCursor)} disabled={isLoading} className="text-sm font-bold text-blue-600 hover:underline disabled:opacity-60">
              โหลดเพิ่ม
            </button>
          </div>
        )}
      </div>

      {selected && (
        <DisputeDetailModal
          key={selected.id}
          initial={selected}
          onClose={() => setSelected(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
