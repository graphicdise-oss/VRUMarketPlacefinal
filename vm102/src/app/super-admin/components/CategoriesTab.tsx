"use client";

import React, { useState, useEffect } from "react";
import { CategoryDto, categoryApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export default function CategoriesTab() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => {
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      try {
        const res = await categoryApi.list();
        setCategories(res.items);
      } catch (err) {
        console.error("Failed to load categories:", err);
      } finally {
        setIsLoadingCategories(false);
      }
    };
    fetchCategories();
  }, []);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      alert("กรุณากรอกชื่อหมวดหมู่");
      return;
    }
    try {
      const res = await categoryApi.create(newCategoryName.trim());
      setCategories([res, ...categories]);
      setNewCategoryName("");
      setIsAddCategoryOpen(false);
      alert("เพิ่มหมวดหมู่เรียบร้อยแล้ว");
    } catch (err) {
      alert("ไม่สามารถเพิ่มหมวดหมู่ได้: " + getErrorMessage(err));
    }
  };

  const handleToggleCategoryActive = async (id: string, currentStatus: boolean) => {
    if (!confirm(currentStatus ? "คุณแน่ใจหรือไม่ที่จะปิดการใช้งานหมวดหมู่นี้? (ร้านค้าจะไม่สามารถเลือกหมวดหมู่นี้ได้อีก)" : "คุณแน่ใจหรือไม่ที่จะเปิดการใช้งานหมวดหมู่นี้อีกครั้ง?")) return;
    try {
      const res = await categoryApi.update(id, { isActive: !currentStatus });
      setCategories(categories.map(c => c.id === id ? res : c));
    } catch (err) {
      alert("ไม่สามารถอัปเดตหมวดหมู่ได้: " + getErrorMessage(err));
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <i className="fa-solid fa-list text-gray-300"></i> จัดการหมวดหมู่
          </h2>
          <button onClick={() => setIsAddCategoryOpen(true)} className="bg-[#16A085] text-white px-6 py-3 rounded-full text-sm font-bold shadow-md hover:bg-[#117A65] transition-all flex items-center justify-center gap-2">
            <i className="fa-solid fa-plus"></i> เพิ่มหมวดหมู่ใหม่
          </button>
        </div>
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                <tr>
                  <th className="px-6 py-5">ชื่อหมวดหมู่</th>
                  <th className="px-6 py-5">สถานะการใช้งาน</th>
                  <th className="px-6 py-5">สร้างเมื่อ</th>
                  <th className="px-6 py-5 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoadingCategories ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">กำลังโหลด...</td></tr>
                ) : categories.map(cat => (
                  <tr key={cat.id} className={`hover:bg-gray-50/50 transition-colors ${!cat.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-5 font-bold text-gray-800 text-base">{cat.name}</td>
                    <td className="px-6 py-5 text-gray-600 font-medium">
                      {cat.isActive ? (
                        <span className="bg-[#D4F1BB]/50 text-[#16A085] px-3 py-1 rounded-lg font-bold border border-[#16A085]/20">เปิดใช้งาน</span>
                      ) : (
                        <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-lg font-bold border border-gray-200">ปิดใช้งานแล้ว</span>
                      )}
                    </td>
                    <td className="px-6 py-5 text-gray-500 font-medium">
                      {new Date(cat.createdAt).toLocaleDateString('th-TH')}
                    </td>
                    <td className="px-6 py-5 flex justify-center gap-2">
                      {cat.isActive ? (
                        <button onClick={() => handleToggleCategoryActive(cat.id, cat.isActive)} className="text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-100 font-bold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                          <i className="fa-solid fa-lock"></i> ปิดใช้งาน
                        </button>
                      ) : (
                        <button onClick={() => handleToggleCategoryActive(cat.id, cat.isActive)} className="text-[#16A085] bg-[#D4F1BB]/50 hover:bg-[#16A085] hover:text-white border border-[#16A085]/20 font-bold text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                          <i className="fa-solid fa-unlock"></i> เปิดใช้งานอีกครั้ง
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoadingCategories && categories.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">ไม่มีหมวดหมู่</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Category Modal */}
      {isAddCategoryOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-xl text-gray-800">เพิ่มหมวดหมู่ใหม่</h3>
              <button onClick={() => setIsAddCategoryOpen(false)} className="text-gray-400 hover:text-red-500"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อหมวดหมู่</label>
                <input type="text" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="เช่น เสื้อผ้าแฟชั่น" className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-[#16A085]" autoFocus />
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setIsAddCategoryOpen(false)} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition">ยกเลิก</button>
              <button onClick={handleAddCategory} className="px-5 py-2.5 font-bold text-white bg-[#16A085] hover:bg-[#117A65] rounded-xl shadow-md transition">บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
