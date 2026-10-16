"use client";

import React, { useState } from "react";
import { superAdminApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export default function BroadcastTab() {
  const [audience, setAudience] = useState("ALL");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!message.trim()) {
      setError("กรุณากรอกข้อความประกาศ");
      return;
    }
    
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await superAdminApi.broadcastNotification(audience, message);
      setSuccess(true);
      setMessage(""); // clear after sending
    } catch (err) {
      setError(getErrorMessage(err, "เกิดข้อผิดพลาดในการส่งประกาศ"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 md:p-10 shadow-sm border border-gray-100">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-800 tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-bullhorn text-xl"></i>
            </div>
            กระจายข่าวสาร (Broadcast)
          </h2>
          <p className="text-sm text-gray-500 mt-2 font-medium">ส่งประกาศแจ้งเตือนไปยังผู้ใช้งานในระบบ (System Announcement)</p>
        </div>
      </div>
      
      <div className="max-w-2xl bg-gray-50 p-6 rounded-2xl border border-gray-100">
        <div className="space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium border border-red-100">
              <i className="fa-solid fa-circle-exclamation mr-2"></i>
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl text-sm font-medium border border-emerald-100">
              <i className="fa-solid fa-circle-check mr-2"></i>
              ส่งประกาศแจ้งเตือนสำเร็จ
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">กลุ่มเป้าหมาย</label>
            <select 
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              disabled={loading}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="ALL">ผู้ใช้งานทั้งหมด (All Users)</option>
              <option value="SELLERS">เฉพาะร้านค้า (Sellers Only)</option>
              <option value="COMMUNITY_ADMINS">เฉพาะผู้ดูแลชุมชน (Community Admins)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">ข้อความประกาศ</label>
            <textarea 
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={loading}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[150px] text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder="พิมพ์ข้อความประกาศที่นี่..."
            ></textarea>
          </div>
          <div className="pt-2">
            <button 
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 disabled:bg-indigo-300 disabled:cursor-not-allowed"
            >
              {loading ? (
                <i className="fa-solid fa-spinner fa-spin"></i>
              ) : (
                <i className="fa-solid fa-paper-plane"></i>
              )}
              {loading ? "กำลังส่ง..." : "ส่งประกาศ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
