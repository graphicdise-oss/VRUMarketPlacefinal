"use client";

import React, { useState, useEffect } from "react";
import { CommunityDto, CommunityAdminEntryDto, communityApi, communityAdminApi, superAdminApi, ApiRequestError } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export default function AdminsTab() {
  const [communities, setCommunities] = useState<CommunityDto[]>([]);
  const [selectedCommunityForAdmins, setSelectedCommunityForAdmins] = useState<string>("");
  const [communityAdmins, setCommunityAdmins] = useState<CommunityAdminEntryDto[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
  
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminCommunity, setNewAdminCommunity] = useState("");

  const [isAddSuperAdminOpen, setIsAddSuperAdminOpen] = useState(false);
  const [newSuperAdminEmail, setNewSuperAdminEmail] = useState("");
  const [isSubmittingSuperAdmin, setIsSubmittingSuperAdmin] = useState(false);

  useEffect(() => {
    const fetchCommunities = async () => {
      try {
        const res = await communityApi.list({ limit: 100 });
        setCommunities(res.items);
      } catch (err) {
        console.error("Failed to load communities:", err);
      }
    };
    fetchCommunities();
  }, []);

  useEffect(() => {
    const fetchAdmins = async () => {
      if (!selectedCommunityForAdmins) {
        setCommunityAdmins([]);
        return;
      }
      setIsLoadingAdmins(true);
      try {
        const res = await communityAdminApi.list(selectedCommunityForAdmins);
        setCommunityAdmins(res.items);
      } catch (err) {
        console.error("Failed to load admins:", err);
      } finally {
        setIsLoadingAdmins(false);
      }
    };
    fetchAdmins();
  }, [selectedCommunityForAdmins]);

  const handleAddAdmin = async () => {
    if (!newAdminName.trim() || !newAdminCommunity.trim()) {
      alert("กรุณากรอกอีเมลและเลือกชุมชน");
      return;
    }
    try {
      const user = await superAdminApi.searchUserByEmail(newAdminName.trim());
      await communityAdminApi.assign(newAdminCommunity, user.id);
      alert("แต่งตั้งแอดมินสำเร็จ");
      setIsAddAdminOpen(false);
      setNewAdminName("");
      if (selectedCommunityForAdmins === newAdminCommunity) {
         setCommunityAdmins([{
           userId: user.id,
           email: user.email,
           assignedAt: new Date().toISOString(),
           assignedBy: "me",
           bannedAt: null
         }, ...communityAdmins]);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && (err.statusCode === 400 || err.statusCode === 404)) {
        alert("ไม่พบผู้ใช้งานด้วยอีเมลนี้ หรืออีเมลไม่ถูกต้อง");
      } else {
        alert("ไม่สามารถแต่งตั้งได้: " + getErrorMessage(err, "Unknown error"));
      }
    }
  };

  const handleRemoveAdmin = async (userId: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ที่จะถอดถอนสิทธิ์แอดมินท่านนี้?")) return;
    try {
      await communityAdminApi.revoke(selectedCommunityForAdmins, userId);
      setCommunityAdmins(communityAdmins.filter(a => a.userId !== userId));
    } catch (err) {
      alert("ไม่สามารถถอดถอนได้: " + getErrorMessage(err));
    }
  };

  const handleAddSuperAdmin = async () => {
    if (!newSuperAdminEmail.trim()) {
      alert("กรุณากรอกอีเมล");
      return;
    }
    setIsSubmittingSuperAdmin(true);
    try {
      const res = await superAdminApi.appointSuperAdmin(newSuperAdminEmail.trim());
      alert(`แต่งตั้งผู้ดูแลระบบสูงสุดสำเร็จ! (รหัสบัญชี: ${res.userId})`);
      setIsAddSuperAdminOpen(false);
      setNewSuperAdminEmail("");
    } catch (err) {
      alert("ไม่สามารถแต่งตั้งได้: " + getErrorMessage(err));
    } finally {
      setIsSubmittingSuperAdmin(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <i className="fa-solid fa-user-shield text-gray-300"></i> จัดการผู้ดูแลระบบ
          </h2>
          <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            <select 
              value={selectedCommunityForAdmins}
              onChange={(e) => setSelectedCommunityForAdmins(e.target.value)}
              className="border border-gray-200 rounded-full px-4 py-3 bg-gray-50 focus:outline-none focus:border-[#16A085] flex-grow sm:w-56"
            >
              <option value="">-- เลือกชุมชน --</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={() => { setIsAddAdminOpen(true); setNewAdminCommunity(selectedCommunityForAdmins); }} className="bg-gray-900 text-white px-5 py-3 rounded-full text-sm font-bold shadow-md hover:bg-gray-800 transition-all flex items-center justify-center gap-2 whitespace-nowrap">
              <i className="fa-solid fa-user-plus text-[#16A085]"></i> แต่งตั้งแอดมินชุมชน
            </button>
            <button onClick={() => setIsAddSuperAdminOpen(true)} className="bg-indigo-600 text-white px-5 py-3 rounded-full text-sm font-bold shadow-md hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 whitespace-nowrap">
              <i className="fa-solid fa-crown text-amber-300"></i> แต่งตั้ง Super Admin
            </button>
          </div>
        </div>
        
        {!selectedCommunityForAdmins ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-16 text-center text-gray-400">
            <i className="fa-solid fa-building-user text-5xl mb-4 text-gray-200"></i>
            <p className="font-bold">กรุณาเลือกชุมชนเพื่อดูรายชื่อแอดมิน</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-5">อีเมล (แอดมิน)</th>
                    <th className="px-6 py-5">วันที่แต่งตั้ง</th>
                    <th className="px-6 py-5 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isLoadingAdmins ? (
                    <tr><td colSpan={3} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
                  ) : communityAdmins.map(admin => (
                    <tr key={admin.userId} className={`hover:bg-gray-50/50 transition-colors ${admin.bannedAt ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center font-bold">
                            {admin.email.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-800 text-base">{admin.email}</span>
                            {admin.bannedAt && <span className="text-xs text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-full w-max mt-1">ถูกระงับบัญชีทั่วไปแล้ว</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-gray-600 font-medium">
                        <span className="bg-gray-100 px-3 py-1.5 rounded-lg text-gray-700 flex items-center w-max gap-2">
                          <i className="fa-solid fa-calendar text-gray-400"></i> {new Date(admin.assignedAt).toLocaleDateString('th-TH')}
                        </span>
                      </td>
                      <td className="px-6 py-5 flex justify-center gap-2">
                        <button onClick={() => handleRemoveAdmin(admin.userId)} className="bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 font-bold py-2 px-5 rounded-xl text-xs transition-colors">
                          ถอดถอนสิทธิ์
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!isLoadingAdmins && communityAdmins.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-8 text-gray-400">ไม่พบรายชื่อแอดมินในชุมชนนี้</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Admin Modal */}
      {isAddAdminOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-xl text-gray-800">แต่งตั้งแอดมินชุมชน</h3>
              <button onClick={() => setIsAddAdminOpen(false)} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">อีเมลของผู้ใช้</label>
                <input type="email" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} placeholder="เช่น user@example.com" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085]" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชุมชนที่รับผิดชอบ</label>
                <select value={newAdminCommunity} onChange={e => setNewAdminCommunity(e.target.value)} className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085]">
                  <option value="">-- เลือกชุมชน --</option>
                  {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setIsAddAdminOpen(false)} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition">ยกเลิก</button>
              <button onClick={handleAddAdmin} className="px-5 py-2.5 font-bold text-white bg-gray-900 hover:bg-gray-800 rounded-xl shadow-md transition">แต่งตั้ง</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Super Admin Modal */}
      {isAddSuperAdminOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                  <i className="fa-solid fa-crown text-amber-500"></i>
                </div>
                <h3 className="font-bold text-xl text-gray-800">แต่งตั้ง Super Admin</h3>
              </div>
              <button onClick={() => setIsAddSuperAdminOpen(false)} className="text-gray-400 hover:text-red-500">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-900">
                  <i className="fa-solid fa-triangle-exclamation"></i> ข้อกำหนดผู้ดูแลระบบสูงสุด (Super Admin)
                </p>
                <p>• ผู้ใช้ต้องสมัครสมาชิกและยืนยันอีเมลแล้วเท่านั้น</p>
                <p>• ผู้ใช้ต้องไม่มีร้านค้าที่กำลังเปิดขายอยู่</p>
                <p>• สิทธิ์ Super Admin จะครอบคลุมการจัดการทุกชุมชนในระบบ</p>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">อีเมลของผู้ใช้ที่ต้องการแต่งตั้ง</label>
                <input
                  type="email"
                  value={newSuperAdminEmail}
                  onChange={e => setNewSuperAdminEmail(e.target.value)}
                  placeholder="เช่น superadmin@vru.ac.th"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button
                onClick={() => setIsAddSuperAdminOpen(false)}
                className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition"
                disabled={isSubmittingSuperAdmin}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleAddSuperAdmin}
                disabled={isSubmittingSuperAdmin}
                className="px-5 py-2.5 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition flex items-center gap-2"
              >
                {isSubmittingSuperAdmin ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> กำลังดำเนินการ...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-crown text-amber-300"></i> ยืนยันแต่งตั้ง
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
