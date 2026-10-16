"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  CommunityDto,
  communityApi,
  CommunityRequestDto,
  communityRequestApi,
  communityAdminApi,
  CommunityAdminEntryDto,
  shopApi,
  PublicShopDto,
} from "@/lib/api";
import { getErrorMessage, formatDateTime } from "@/lib/utils";

interface CommunityDetailState {
  community: CommunityDto;
  admins: CommunityAdminEntryDto[];
  shops: PublicShopDto[];
  isLoading: boolean;
}

export default function CommunitiesTab() {
  const [communities, setCommunities] = useState<CommunityDto[]>([]);
  const [isLoadingCommunities, setIsLoadingCommunities] = useState(true);
  const [communitySearch, setCommunitySearch] = useState("");

  // Stats cache for each community: { [communityId]: { shopCount: number, adminsCount: number, adminEmails: string[] } }
  const [communityStats, setCommunityStats] = useState<
    Record<string, { shopCount: number; adminsCount: number; adminEmails: string[] }>
  >({});

  // Add Modal State
  const [isAddCommunityOpen, setIsAddCommunityOpen] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityLocation, setNewCommunityLocation] = useState("");
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);

  // Edit Modal State
  const [isEditCommunityOpen, setIsEditCommunityOpen] = useState(false);
  const [editingCommunityId, setEditingCommunityId] = useState("");
  const [editCommunityName, setEditCommunityName] = useState("");
  const [editCommunityLocation, setEditCommunityLocation] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // View Details Modal State
  const [detailModal, setDetailModal] = useState<CommunityDetailState | null>(null);

  // Pending Requests State
  const [pendingRequests, setPendingRequests] = useState<CommunityRequestDto[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);

  const fetchCommunities = useCallback(async () => {
    setIsLoadingCommunities(true);
    try {
      const res = await communityApi.list({ limit: 100 });
      setCommunities(res.items);

      // Concurrently fetch shop counts & admins for loaded communities
      const statsMap: Record<string, { shopCount: number; adminsCount: number; adminEmails: string[] }> = {};
      await Promise.allSettled(
        res.items.map(async (com) => {
          try {
            const [shopRes, adminRes] = await Promise.all([
              shopApi.listPublic({ communityId: com.id, limit: 100 }),
              communityAdminApi.list(com.id),
            ]);
            statsMap[com.id] = {
              shopCount: shopRes.items.length,
              adminsCount: adminRes.items.length,
              adminEmails: adminRes.items.map((a) => a.email),
            };
          } catch {
            statsMap[com.id] = { shopCount: 0, adminsCount: 0, adminEmails: [] };
          }
        })
      );
      setCommunityStats(statsMap);
    } catch (err) {
      console.error("Failed to load communities:", err);
    } finally {
      setIsLoadingCommunities(false);
    }
  }, []);

  const fetchPendingRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const res = await communityRequestApi.listPending();
      setPendingRequests(res.items);
    } catch (err) {
      // 401 = session expired / not logged in; user must log in again, so skip the noisy error.
      if ((err as { statusCode?: number })?.statusCode !== 401) {
        console.error("Failed to load requests:", err);
      }
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    fetchCommunities();
    fetchPendingRequests();
  }, [fetchCommunities, fetchPendingRequests]);

  const handleAddCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommunityName.trim()) {
      alert("กรุณากรอกชื่อชุมชน");
      return;
    }
    setIsSubmittingAdd(true);
    try {
      const res = await communityApi.create(newCommunityName.trim(), newCommunityLocation.trim() || null);
      setCommunities([res, ...communities]);
      setNewCommunityName("");
      setNewCommunityLocation("");
      setIsAddCommunityOpen(false);
      alert(`สร้างชุมชน "${res.name}" สำเร็จเรียบร้อยแล้ว`);
    } catch (err) {
      alert("ไม่สามารถสร้างชุมชนได้: " + getErrorMessage(err));
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  const openEditModal = (com: CommunityDto) => {
    setEditingCommunityId(com.id);
    setEditCommunityName(com.name);
    setEditCommunityLocation(com.description || "");
    setIsEditCommunityOpen(true);
  };

  const handleEditCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCommunityName.trim()) {
      alert("กรุณากรอกชื่อชุมชน");
      return;
    }
    setIsSubmittingEdit(true);
    try {
      const res = await communityApi.update(editingCommunityId, editCommunityName.trim(), editCommunityLocation.trim() || null);
      setCommunities(communities.map((c) => (c.id === editingCommunityId ? res : c)));
      setIsEditCommunityOpen(false);
      alert(`แก้ไขข้อมูลชุมชน "${res.name}" สำเร็จเรียบร้อยแล้ว`);
    } catch (err) {
      alert("ไม่สามารถแก้ไขชุมชนได้: " + getErrorMessage(err));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleDeleteCommunity = async (id: string, name: string) => {
    if (
      !confirm(
        `คุณแน่ใจหรือไม่ว่าต้องการลบชุมชน "${name}"?\n(ระบบจะอนุญาตให้ลบได้เฉพาะชุมชนที่ยังไม่เคยมีร้านค้า และไม่มีแอดมินดูแลอยู่เท่านั้น)`
      )
    )
      return;
    try {
      await communityApi.delete(id);
      setCommunities(communities.filter((c) => c.id !== id));
      alert(`ดำเนินการลบชุมชน "${name}" สำเร็จ`);
    } catch (err) {
      alert("ไม่สามารถลบชุมชนได้: " + getErrorMessage(err));
    }
  };

  const handleApproveRequest = async (id: string) => {
    if (!confirm("ยืนยันอนุมัติคำขอสร้างชุมชนนี้?")) return;
    try {
      await communityRequestApi.approve(id);
      setPendingRequests((prev) => prev.filter((r) => r.id !== id));
      fetchCommunities();
      alert("อนุมัติคำขอจัดตั้งชุมชนสำเร็จ");
    } catch (err) {
      alert("ไม่สามารถอนุมัติได้: " + getErrorMessage(err));
    }
  };

  const handleRejectRequest = async (id: string) => {
    const reason = prompt("เหตุผลที่ปฏิเสธ (ไม่บังคับ):");
    if (reason === null) return;
    try {
      await communityRequestApi.reject(id, reason);
      setPendingRequests((prev) => prev.filter((r) => r.id !== id));
      alert("ปฏิเสธคำขอจัดตั้งชุมชนเรียบร้อยแล้ว");
    } catch (err) {
      alert("ไม่สามารถปฏิเสธได้: " + getErrorMessage(err));
    }
  };

  const openViewDetails = async (com: CommunityDto) => {
    setDetailModal({
      community: com,
      admins: [],
      shops: [],
      isLoading: true,
    });

    try {
      const [shopsRes, adminsRes] = await Promise.all([
        shopApi.listPublic({ communityId: com.id, limit: 100 }),
        communityAdminApi.list(com.id),
      ]);
      setDetailModal({
        community: com,
        admins: adminsRes.items,
        shops: shopsRes.items,
        isLoading: false,
      });
    } catch (err) {
      console.error("Failed to load community details:", err);
      setDetailModal((prev) => (prev ? { ...prev, isLoading: false } : null));
    }
  };

  const filteredCommunities = communities.filter(
    (c) =>
      c.name?.toLowerCase().includes(communitySearch.toLowerCase()) ||
      c.description?.toLowerCase().includes(communitySearch.toLowerCase())
  );

  return (
    <>
      <div className="space-y-6">
        {/* Pending Requests Section */}
        {pendingRequests.length > 0 && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-clock-rotate-left text-orange-400"></i> คำขอสร้างชุมชนรออนุมัติ
                <span className="bg-orange-100 text-orange-600 text-xs px-2.5 py-1 rounded-full font-bold">
                  {pendingRequests.length}
                </span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4">ชื่อชุมชนที่ขอ</th>
                    <th className="px-6 py-4">รายละเอียด</th>
                    <th className="px-6 py-4">ผู้ขอ</th>
                    <th className="px-6 py-4">วันที่ขอ</th>
                    <th className="px-6 py-4 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isLoadingRequests ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-gray-400">
                        กำลังโหลด...
                      </td>
                    </tr>
                  ) : (
                    pendingRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-800">{req.name}</td>
                        <td
                          className="px-6 py-4 text-gray-600 max-w-[250px] truncate"
                          title={req.description}
                        >
                          {req.description}
                        </td>
                        <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                          {req.requesterId.slice(0, 8)}...
                        </td>
                        <td className="px-6 py-4 text-gray-500 text-xs">
                          {formatDateTime(req.createdAt)}
                        </td>
                        <td className="px-6 py-4 flex justify-center gap-2">
                          <button
                            onClick={() => handleApproveRequest(req.id)}
                            className="bg-green-100 text-green-700 hover:bg-green-500 hover:text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors"
                          >
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => handleRejectRequest(req.id)}
                            className="bg-red-100 text-red-700 hover:bg-red-500 hover:text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors"
                          >
                            ปฏิเสธ
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Community List Header & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div>
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
              <i className="fa-solid fa-users-viewfinder text-[#16A085]"></i> จัดการชุมชน (Communities)
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              ภาพรวมศูนย์กลางชุมชน เครือข่ายวิสาหกิจชุมชน ร้านค้า และผู้ดูแลชุมชนทั้งหมด
            </p>
          </div>
          <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            <div className="relative flex-grow sm:w-64">
              <input
                type="text"
                placeholder="ค้นหาชื่อชุมชน / พื้นที่..."
                value={communitySearch}
                onChange={(e) => setCommunitySearch(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#16A085] shadow-sm"
              />
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-3.5 text-gray-400"></i>
            </div>
            <button
              onClick={() => setIsAddCommunityOpen(true)}
              className="bg-[#16A085] text-white px-6 py-2.5 rounded-full text-sm font-bold shadow-md hover:bg-[#117A65] transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <i className="fa-solid fa-plus"></i> เพิ่มชุมชนใหม่
            </button>
          </div>
        </div>

        {/* Communities Table */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                <tr>
                  <th className="px-6 py-5">ชื่อชุมชน</th>
                  <th className="px-6 py-5">ผู้ดูแลชุมชน (Admin)</th>
                  <th className="px-6 py-5">ร้านค้าที่สังกัด</th>
                  <th className="px-6 py-5">พื้นที่ / รายละเอียด</th>
                  <th className="px-6 py-5">วันที่เข้าร่วม</th>
                  <th className="px-6 py-5">สถานะ</th>
                  <th className="px-6 py-5 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoadingCommunities ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      <i className="fa-solid fa-circle-notch fa-spin mr-2"></i> กำลังโหลดข้อมูลชุมชน...
                    </td>
                  </tr>
                ) : filteredCommunities.map((com) => {
                  const stat = communityStats[com.id];
                  return (
                    <tr key={com.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-[#16A085] font-bold text-base shadow-sm">
                            <i className="fa-solid fa-users"></i>
                          </div>
                          <div>
                            <span className="font-bold text-gray-800 text-base block">{com.name}</span>
                            <span className="text-xs text-gray-400 font-mono">ID: {com.id.slice(0, 8)}...</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-5">
                        {stat && stat.adminsCount > 0 ? (
                          <div className="flex flex-col gap-1">
                            <span className="bg-purple-50 text-purple-700 border border-purple-200 text-xs px-2.5 py-0.5 rounded-md font-bold w-fit flex items-center gap-1.5">
                              <i className="fa-solid fa-user-shield text-[10px]"></i> {stat.adminsCount} แอดมิน
                            </span>
                            <span className="text-xs text-gray-500 truncate max-w-[150px]" title={stat.adminEmails.join(", ")}>
                              {stat.adminEmails[0]}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic flex items-center gap-1.5">
                            <i className="fa-solid fa-circle-info text-gray-300"></i> ยังไม่มีผู้ดูแล
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-5">
                        <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5">
                          <i className="fa-solid fa-store text-[10px]"></i>
                          {stat ? `${stat.shopCount} ร้านค้า` : "-"}
                        </span>
                      </td>

                      <td
                        className="px-6 py-5 text-gray-600 max-w-[200px] truncate"
                        title={com.description || "-"}
                      >
                        {com.description || <span className="text-gray-300">-</span>}
                      </td>

                      <td className="px-6 py-5 text-gray-500 text-xs font-mono">
                        {formatDateTime(com.createdAt)}
                      </td>

                      <td className="px-6 py-5">
                        <span className="bg-green-50 text-green-600 border border-green-200 text-[10px] px-3 py-1.5 rounded-full font-bold tracking-wide">
                          <i className="fa-solid fa-circle text-[6px] align-middle mr-1 text-green-500"></i> ACTIVE
                        </span>
                      </td>

                      <td className="px-6 py-5">
                        <div className="flex justify-center items-center gap-2">
                          <button
                            onClick={() => openViewDetails(com)}
                            className="text-teal-700 bg-teal-50 hover:bg-teal-500 hover:text-white border border-teal-200 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                            title="ดูข้อมูลร้านค้าและผู้ดูแล"
                          >
                            <i className="fa-solid fa-eye text-[11px]"></i> รายละเอียด
                          </button>
                          <button
                            onClick={() => openEditModal(com)}
                            className="text-gray-600 bg-gray-100 hover:bg-gray-200 font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors"
                          >
                            แก้ไข
                          </button>
                          <button
                            onClick={() => handleDeleteCommunity(com.id, com.name)}
                            className="text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-100 font-bold text-xs px-3 py-1.5 rounded-lg transition-colors"
                            title="ลบชุมชน (เฉพาะกรณีไม่มีร้านค้า)"
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoadingCommunities && filteredCommunities.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      ไม่พบข้อมูลชุมชนตามที่ค้นหา
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Community Modal */}
      {isAddCommunityOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-users text-[#16A085]"></i> เพิ่มชุมชนใหม่
              </h3>
              <button
                onClick={() => setIsAddCommunityOpen(false)}
                className="text-gray-400 hover:text-red-500"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <form onSubmit={handleAddCommunity}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    ชื่อชุมชน *
                  </label>
                  <input
                    type="text"
                    value={newCommunityName}
                    onChange={(e) => setNewCommunityName(e.target.value)}
                    placeholder="เช่น วิสาหกิจชุมชนบางปะอิน..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085] text-sm"
                    autoFocus
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    จังหวัด / พื้นที่ / รายละเอียด *
                  </label>
                  <textarea
                    value={newCommunityLocation}
                    onChange={(e) => setNewCommunityLocation(e.target.value)}
                    placeholder="เช่น พระนครศรีอยุธยา หรือคำอธิบายเพิ่มเติมเกี่ยวกับวิถีชุมชน..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085] text-sm"
                    rows={3}
                    required
                  />
                </div>
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                  <p className="text-xs text-blue-700 leading-relaxed font-medium">
                    <i className="fa-solid fa-circle-info mr-1"></i>{" "}
                    <b>คำแนะนำ:</b> หลังจากสร้างชุมชนเสร็จแล้ว คุณสามารถไปที่แท็บ{" "}
                    <b>&quot;แอดมินชุมชน&quot;</b> เพื่อแต่งตั้งผู้ใช้ให้เป็นผู้ดูแลชุมชนนี้ได้ทันที
                  </p>
                </div>
              </div>
              <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddCommunityOpen(false)}
                  className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="px-6 py-2.5 font-bold text-white bg-[#16A085] hover:bg-[#117A65] rounded-xl shadow-md transition text-sm disabled:opacity-50"
                >
                  {isSubmittingAdd ? "กำลังบันทึก..." : "บันทึกชุมชน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Community Modal */}
      {isEditCommunityOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-pen text-blue-600"></i> แก้ไขข้อมูลชุมชน
              </h3>
              <button
                onClick={() => setIsEditCommunityOpen(false)}
                className="text-gray-400 hover:text-red-500"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            <form onSubmit={handleEditCommunity}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    ชื่อชุมชน *
                  </label>
                  <input
                    type="text"
                    value={editCommunityName}
                    onChange={(e) => setEditCommunityName(e.target.value)}
                    placeholder="เช่น วิสาหกิจชุมชน..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085] text-sm"
                    autoFocus
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    จังหวัด / พื้นที่ / รายละเอียด *
                  </label>
                  <textarea
                    value={editCommunityLocation}
                    onChange={(e) => setNewCommunityLocation(e.target.value)}
                    placeholder="เช่น ปทุมธานี หรือคำอธิบายเพิ่มเติม..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085] text-sm"
                    rows={3}
                    required
                  />
                </div>
              </div>
              <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditCommunityOpen(false)}
                  className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-6 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md transition text-sm disabled:opacity-50"
                >
                  {isSubmittingEdit ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Community Full Details Drawer / Modal */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-fade-in max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-teal-50/50">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#16A085] text-white flex items-center justify-center text-xl shadow-md">
                  <i className="fa-solid fa-users"></i>
                </div>
                <div>
                  <h3 className="font-bold text-xl text-gray-900">{detailModal.community.name}</h3>
                  <p className="text-xs text-gray-500">
                    ก่อตั้งเมื่อ: {formatDateTime(detailModal.community.createdAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetailModal(null)}
                className="text-gray-400 hover:text-red-500 text-xl"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Community Overview */}
              <div>
                <h4 className="font-bold text-sm text-gray-700 mb-2 flex items-center gap-2">
                  <i className="fa-solid fa-map-pin text-[#16A085]"></i> รายละเอียดพื้นที่และคำอธิบาย:
                </h4>
                <p className="bg-gray-50 p-4 rounded-2xl text-gray-700 text-sm leading-relaxed border border-gray-100">
                  {detailModal.community.description || "ไม่มีรายละเอียดเพิ่มเติม"}
                </p>
              </div>

              {/* Community Admins */}
              <div>
                <h4 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-user-shield text-purple-600"></i> ผู้ดูแลชุมชน (Community Admins):
                </h4>
                {detailModal.isLoading ? (
                  <p className="text-xs text-gray-400">กำลังโหลดผู้ดูแล...</p>
                ) : detailModal.admins.length === 0 ? (
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-800 text-xs">
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i> ยังไม่มีผู้ดูแลชุมชนนี้ (คุณสามารถไปที่แท็บ &quot;แอดมินชุมชน&quot; เพื่อแต่งตั้งผู้ดูแล)
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detailModal.admins.map((adm) => (
                      <div
                        key={adm.userId}
                        className="p-3 bg-gray-50 border border-gray-100 rounded-xl flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                          {adm.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-gray-800 truncate">{adm.email}</p>
                          <p className="text-[10px] text-gray-400">แต่งตั้ง: {new Date(adm.assignedAt).toLocaleDateString("th-TH")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Shops in Community */}
              <div>
                <h4 className="font-bold text-sm text-gray-700 mb-3 flex items-center gap-2">
                  <i className="fa-solid fa-store text-blue-600"></i> ร้านค้าที่สังกัดชุมชนนี้ ({detailModal.shops.length} ร้าน):
                </h4>
                {detailModal.isLoading ? (
                  <p className="text-xs text-gray-400">กำลังโหลดรายชื่อร้านค้า...</p>
                ) : detailModal.shops.length === 0 ? (
                  <div className="p-4 bg-gray-50 rounded-2xl text-gray-400 text-xs text-center border border-dashed border-gray-200">
                    ยังไม่มีร้านค้าเปิดให้บริการในชุมชนนี้
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {detailModal.shops.map((shop) => (
                      <div
                        key={shop.id}
                        className="p-3 bg-gray-50 hover:bg-gray-100/80 border border-gray-100 rounded-xl flex items-center justify-between gap-4 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs">
                            <i className="fa-solid fa-shop"></i>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-800">{shop.name}</p>
                            <p className="text-[10px] text-gray-500">
                              สินค้า: {shop.productCount} ชิ้น | เรตติ้ง: {shop.averageRating ? `${shop.averageRating} ★` : "ยังไม่มีรีวิว"}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          {shop.approvalStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setDetailModal(null)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-xl text-sm font-bold transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
