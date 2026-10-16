"use client";

import React, { useState } from "react";
import { SuperAdminUserDto, superAdminApi, ApiRequestError } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export default function UsersTab() {
  const [userSearch, setUserSearch] = useState("");
  const [searchedUser, setSearchedUser] = useState<SuperAdminUserDto | null>(null);
  const [isSearchingUser, setIsSearchingUser] = useState(false);
  const [searchUserError, setSearchUserError] = useState("");

  const handleSearchUser = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userSearch.trim()) return;
    setIsSearchingUser(true);
    setSearchUserError("");
    setSearchedUser(null);
    try {
      const res = await superAdminApi.searchUserByEmail(userSearch.trim());
      setSearchedUser(res);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.statusCode === 400 || err.statusCode === 404)) {
        setSearchUserError("ไม่พบผู้ใช้งานด้วยอีเมลนี้ หรืออีเมลไม่ถูกต้อง");
      } else {
        setSearchUserError("เกิดข้อผิดพลาดในการค้นหาผู้ใช้: " + getErrorMessage(err, ""));
      }
    } finally {
      setIsSearchingUser(false);
    }
  };

  const handleToggleRealUserBan = async (user: SuperAdminUserDto) => {
    if (!user.bannedAt) {
      const reason = prompt("กรุณาระบุเหตุผลการระงับบัญชี (10-500 ตัวอักษร):");
      if (!reason || reason.length < 10) {
        alert("เหตุผลสั้นเกินไป กรุณาระบุให้ชัดเจน");
        return;
      }
      if (confirm("ยืนยันการระงับบัญชีผู้ใช้นี้หรือไม่?")) {
        try {
          await superAdminApi.banUser(user.id, reason);
          alert("ระงับบัญชีผู้ใช้เรียบร้อยแล้ว");
          handleSearchUser(); // refresh
        } catch (err) {
          alert("Error: " + getErrorMessage(err));
        }
      }
    } else {
      if (confirm("ยืนยันการปลดระงับบัญชีผู้ใช้นี้หรือไม่?")) {
        try {
          await superAdminApi.unbanUser(user.id);
          alert("ปลดระงับบัญชีผู้ใช้เรียบร้อยแล้ว");
          handleSearchUser(); // refresh
        } catch (err) {
          alert("Error: " + getErrorMessage(err));
        }
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
          <i className="fa-solid fa-user-xmark text-gray-300"></i> จัดการผู้ใช้งาน
        </h2>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <form onSubmit={handleSearchUser} className="flex gap-2 w-full sm:w-96">
            <div className="relative flex-grow">
              <input 
                type="email" 
                placeholder="ค้นหาด้วยอีเมลผู้ใช้งาน..." 
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#16A085] shadow-sm" 
                required
              />
              <i className="fa-solid fa-envelope absolute left-4 top-3.5 text-gray-400"></i>
            </div>
            <button type="submit" disabled={isSearchingUser} className="bg-[#16A085] text-white px-6 py-2.5 rounded-full text-sm font-bold shadow-md hover:bg-[#117A65] transition-all disabled:opacity-50">
              {isSearchingUser ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-magnifying-glass"></i>} ค้นหา
            </button>
          </form>
        </div>
      </div>
      
      {searchUserError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl border border-red-100 flex items-center gap-3">
          <i className="fa-solid fa-circle-exclamation text-xl"></i>
          <p className="text-sm font-bold">{searchUserError}</p>
        </div>
      )}

      {searchedUser && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden p-6">
          <h3 className="text-lg font-black text-gray-800 mb-6 border-b pb-4">ผลการค้นหา</h3>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center font-bold text-2xl">
                {searchedUser.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-black text-xl text-gray-800">{searchedUser.email}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-bold border border-blue-100">
                    ID: {searchedUser.id.substring(0,8)}...
                  </span>
                  <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-bold border border-gray-200">
                    Role: {searchedUser.role}
                  </span>
                  {searchedUser.bannedAt ? (
                    <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold border border-red-100">
                      <i className="fa-solid fa-ban mr-1"></i> ถูกระงับ
                    </span>
                  ) : (
                    <span className="bg-green-50 text-green-600 px-3 py-1 rounded-full text-xs font-bold border border-green-100">
                      <i className="fa-solid fa-check mr-1"></i> ปกติ
                    </span>
                  )}
                  {searchedUser.hasOpenShop && (
                    <span className="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold border border-orange-100">
                      <i className="fa-solid fa-store mr-1"></i> เปิดร้านค้า
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex gap-3">
              {!searchedUser.bannedAt ? (
                <button onClick={() => handleToggleRealUserBan(searchedUser)} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-100 font-bold py-2.5 px-6 rounded-full text-sm transition-colors flex items-center gap-2 shadow-sm">
                  <i className="fa-solid fa-ban"></i> ระงับบัญชี
                </button>
              ) : (
                <button onClick={() => handleToggleRealUserBan(searchedUser)} className="bg-green-50 text-green-600 hover:bg-green-600 hover:text-white border border-green-100 font-bold py-2.5 px-6 rounded-full text-sm transition-colors flex items-center gap-2 shadow-sm">
                  <i className="fa-solid fa-unlock"></i> ปลดระงับ
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


