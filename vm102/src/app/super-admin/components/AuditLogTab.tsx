"use client";

import React, { useState, useEffect, useCallback } from "react";
import { auditLogApi, AuditLogEntryDto } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  COMMUNITY_CREATED: { label: "สร้างชุมชนใหม่", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-users-viewfinder" },
  COMMUNITY_UPDATED: { label: "แก้ไขข้อมูลชุมชน", color: "bg-blue-50 text-blue-700 border-blue-200", icon: "fa-pen-to-square" },
  COMMUNITY_DELETED: { label: "ลบชุมชน", color: "bg-rose-50 text-rose-700 border-rose-200", icon: "fa-trash" },
  COMMUNITY_ADMIN_ASSIGNED: { label: "แต่งตั้งแอดมินชุมชน", color: "bg-purple-50 text-purple-700 border-purple-200", icon: "fa-user-shield" },
  COMMUNITY_ADMIN_REVOKED: { label: "ปลดแอดมินชุมชน", color: "bg-amber-50 text-amber-700 border-amber-200", icon: "fa-user-xmark" },
  USER_BANNED: { label: "ระงับบัญชีผู้ใช้", color: "bg-rose-50 text-rose-700 border-rose-200", icon: "fa-ban" },
  USER_UNBANNED: { label: "ปลดแบนผู้ใช้", color: "bg-teal-50 text-teal-700 border-teal-200", icon: "fa-unlock" },
  ACCOUNT_ERASED: { label: "ลบบัญชีถาวร (PDPA)", color: "bg-red-50 text-red-700 border-red-200", icon: "fa-user-slash" },
  SHOP_APPROVED: { label: "อนุมัติร้านค้า", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-store" },
  SHOP_REJECTED: { label: "ปฏิเสธร้านค้า", color: "bg-rose-50 text-rose-700 border-rose-200", icon: "fa-circle-xmark" },
  SHOP_SUSPENDED: { label: "ระงับร้านค้า", color: "bg-amber-50 text-amber-700 border-amber-200", icon: "fa-store-slash" },
  CATEGORY_CREATED: { label: "เพิ่มหมวดหมู่สินค้า", color: "bg-sky-50 text-sky-700 border-sky-200", icon: "fa-list" },
  CATEGORY_UPDATED: { label: "แก้ไขหมวดหมู่สินค้า", color: "bg-sky-50 text-sky-700 border-sky-200", icon: "fa-pen" },
  SHIPPING_CARRIER_CREATED: { label: "เพิ่มบริษัทขนส่ง", color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "fa-truck-fast" },
  SHIPPING_CARRIER_UPDATED: { label: "แก้ไขสถานะขนส่ง", color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "fa-truck" },
  AUDIT_LOG_VIEWED: { label: "เข้าตรวจสอบประวัติ", color: "bg-gray-100 text-gray-700 border-gray-200", icon: "fa-eye" },
};

export default function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLogEntryDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [searchTargetId, setSearchTargetId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const fetchLogs = useCallback(async (reset = false, cursorToUse?: string) => {
    setIsLoading(true);
    try {
      const params: { action?: string; targetId?: string; limit?: number; cursor?: string } = {
        limit: 30,
      };
      if (actionFilter !== "ALL") {
        params.action = actionFilter;
      }
      if (searchTargetId.trim()) {
        params.targetId = searchTargetId.trim();
      }
      if (!reset && cursorToUse) {
        params.cursor = cursorToUse;
      }

      const res = await auditLogApi.list(params);
      if (reset) {
        setLogs(res.items);
      } else {
        setLogs((prev) => (cursorToUse ? [...prev, ...res.items] : res.items));
      }
      setNextCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
    } finally {
      setIsLoading(false);
    }
  }, [actionFilter, searchTargetId]);

  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs(true);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <i className="fa-solid fa-clock-rotate-left text-[#16A085]"></i> บันทึกประวัติการกระทำ (Audit Log)
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            เก็บบันทึกประวัติการบริหารจัดการระบบและคำสั่งของผู้ดูแลระบบส่วนกลาง ตาม พ.ร.บ.คอมพิวเตอร์ ม.26
          </p>
        </div>
        <button
          onClick={() => fetchLogs(true)}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-full font-bold text-sm transition flex items-center gap-2 self-start md:self-auto"
        >
          <i className="fa-solid fa-arrows-rotate"></i> รีเฟรชข้อมูล
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <label className="text-sm font-bold text-gray-600 flex items-center gap-1.5">
            <i className="fa-solid fa-filter text-gray-400"></i> กรองตามกิจกรรม:
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:border-[#16A085]"
          >
            <option value="ALL">กิจกรรมทั้งหมด</option>
            <option value="COMMUNITY_CREATED">สร้างชุมชนใหม่</option>
            <option value="COMMUNITY_UPDATED">แก้ไขข้อมูลชุมชน</option>
            <option value="COMMUNITY_DELETED">ลบชุมชน</option>
            <option value="COMMUNITY_ADMIN_ASSIGNED">แต่งตั้งแอดมินชุมชน</option>
            <option value="COMMUNITY_ADMIN_REVOKED">ปลดแอดมินชุมชน</option>
            <option value="USER_BANNED">ระงับบัญชีผู้ใช้ (Ban)</option>
            <option value="USER_UNBANNED">ปลดแบนผู้ใช้</option>
            <option value="ACCOUNT_ERASED">ลบบัญชีถาวร (PDPA)</option>
            <option value="SHOP_APPROVED">อนุมัติร้านค้า</option>
            <option value="SHOP_REJECTED">ปฏิเสธร้านค้า</option>
            <option value="SHOP_SUSPENDED">ระงับร้านค้า</option>
            <option value="SHIPPING_CARRIER_CREATED">เพิ่มบริษัทขนส่ง</option>
            <option value="SHIPPING_CARRIER_UPDATED">แก้ไขบริษัทขนส่ง</option>
          </select>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full lg:w-96">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="ค้นหาด้วย Target ID / UUID..."
              value={searchTargetId}
              onChange={(e) => setSearchTargetId(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#16A085]"
            />
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-gray-400 text-xs"></i>
          </div>
          <button
            type="submit"
            className="bg-[#16A085] hover:bg-[#117A65] text-white px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap"
          >
            ค้นหา
          </button>
        </form>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">วัน-เวลา</th>
                <th className="px-6 py-4">กิจกรรม (Action)</th>
                <th className="px-6 py-4">เป้าหมาย (Target)</th>
                <th className="px-6 py-4">ผู้ดำเนินการ (Actor)</th>
                <th className="px-6 py-4">เหตุผล / บันทึกเพิ่มเติม</th>
                <th className="px-6 py-4">รหัสเป้าหมาย (Target ID)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400 font-medium">
                    <i className="fa-solid fa-circle-notch fa-spin mr-2"></i> กำลังโหลดประวัติการกระทำ...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400 font-medium">
                    ไม่พบรายการประวัติการกระทำตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const actionMeta = ACTION_LABELS[log.action] || {
                    label: log.action,
                    color: "bg-gray-100 text-gray-700 border-gray-200",
                    icon: "fa-terminal",
                  };

                  return (
                    <tr key={log.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${actionMeta.color}`}
                        >
                          <i className={`fa-solid ${actionMeta.icon} text-[11px]`}></i>
                          {actionMeta.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-700">
                        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">
                          {log.targetType || "SYSTEM"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 font-mono text-xs">
                        {log.actorUserId ? (
                          <span title={log.actorUserId}>
                            {log.actorUserId.slice(0, 8)}...{log.actorUserId.slice(-4)}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">SYSTEM (ระบบ)</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-700 max-w-[260px] truncate" title={log.reason || "-"}>
                        {log.reason ? (
                          <span className="text-gray-800 font-medium">{log.reason}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-400 font-mono text-xs" title={log.targetId || "-"}>
                        {log.targetId ? `${log.targetId.slice(0, 8)}...` : "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Load More Pagination */}
        {hasMore && (
          <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
            <button
              onClick={() => fetchLogs(false, nextCursor)}
              disabled={isLoading}
              className="bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 px-6 py-2 rounded-full font-bold text-xs shadow-sm transition disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> กำลังโหลด...
                </>
              ) : (
                "โหลดประวัติเพิ่มเติม"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
