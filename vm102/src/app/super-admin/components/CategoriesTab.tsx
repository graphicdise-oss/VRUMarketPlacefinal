"use client";

import React, { useState, useEffect, useMemo } from "react";
import { CategoryDto, categoryApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import {
  COLOR_PRESETS,
  AVAILABLE_ICONS,
  getCategoryStyle,
  type ColorTone,
  type IconOption,
} from "@/lib/category-styles";

export default function CategoriesTab() {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | null>(null);

  // Form states
  const [categoryName, setCategoryName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("fa-box-open");
  const [selectedColor, setSelectedColor] = useState("teal");
  const [iconSearch, setIconSearch] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("ทั้งหมด");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const openCreateModal = () => {
    setEditingCategory(null);
    setCategoryName("");
    setSelectedIcon("fa-box-open");
    setSelectedColor("teal");
    setIconSearch("");
    setSelectedCategoryFilter("ทั้งหมด");
    setIsModalOpen(true);
  };

  const openEditModal = (cat: CategoryDto) => {
    setEditingCategory(cat);
    setCategoryName(cat.name);
    const style = getCategoryStyle(cat);
    setSelectedIcon(cat.icon || style.icon || "fa-box-open");
    // Find matching preset key if cat.color is valid, otherwise fallback
    const colorKey = cat.color && COLOR_PRESETS[cat.color] ? cat.color : "teal";
    setSelectedColor(colorKey);
    setIconSearch("");
    setSelectedCategoryFilter("ทั้งหมด");
    setIsModalOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) {
      alert("กรุณากรอกชื่อหมวดหมู่");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingCategory) {
        const updated = await categoryApi.update(editingCategory.id, {
          name: categoryName.trim(),
          isActive: editingCategory.isActive,
          icon: selectedIcon,
          color: selectedColor,
        });
        setCategories(categories.map(c => c.id === editingCategory.id ? updated : c));
        alert("อัปเดตหมวดหมู่เรียบร้อยแล้ว");
      } else {
        const created = await categoryApi.create(
          categoryName.trim(),
          selectedIcon,
          selectedColor,
        );
        setCategories([created, ...categories]);
        alert("เพิ่มหมวดหมู่เรียบร้อยแล้ว");
      }
      setIsModalOpen(false);
    } catch (err) {
      alert("ไม่สามารถบันทึกหมวดหมู่ได้: " + getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
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

  // Filtered icons
  const iconFilterCategories = useMemo(() => {
    const set = new Set(AVAILABLE_ICONS.map(i => i.category));
    return ["ทั้งหมด", ...Array.from(set)];
  }, []);

  const filteredIcons = useMemo(() => {
    return AVAILABLE_ICONS.filter((item: IconOption) => {
      const matchSearch =
        !iconSearch.trim() ||
        item.name.toLowerCase().includes(iconSearch.toLowerCase()) ||
        item.icon.toLowerCase().includes(iconSearch.toLowerCase());
      const matchCat =
        selectedCategoryFilter === "ทั้งหมด" || item.category === selectedCategoryFilter;
      return matchSearch && matchCat;
    });
  }, [iconSearch, selectedCategoryFilter]);

  const activeColorTone: ColorTone = COLOR_PRESETS[selectedColor] || COLOR_PRESETS.teal;

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div>
            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
              <i className="fa-solid fa-layer-group text-[#16A085]"></i> จัดการหมวดหมู่
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              กำหนดหมวดหมู่สินค้ากลาง พร้อมปรับแต่งไอคอนและโทนสีเพื่อแสดงผลบนหน้าร้านและตัวกรองค้นหา
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="bg-[#16A085] hover:bg-[#117A65] text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-plus"></i> เพิ่มหมวดหมู่ใหม่
          </button>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                <tr>
                  <th className="px-6 py-5">ไอคอนและหมวดหมู่</th>
                  <th className="px-6 py-5">สถานะการใช้งาน</th>
                  <th className="px-6 py-5">สร้างเมื่อ</th>
                  <th className="px-6 py-5 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoadingCategories ? (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-gray-400">
                      <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2 text-[#16A085]"></i>
                      <div>กำลังโหลดข้อมูลหมวดหมู่...</div>
                    </td>
                  </tr>
                ) : categories.map(cat => {
                  const style = getCategoryStyle(cat);
                  return (
                    <tr
                      key={cat.id}
                      className={`hover:bg-gray-50/60 transition-colors ${!cat.isActive ? 'opacity-60 bg-gray-50/30' : ''}`}
                    >
                      <td className="px-6 py-4 font-bold text-gray-800 text-base">
                        <div className="flex items-center gap-3.5">
                          <div
                            className={`w-11 h-11 rounded-2xl ${style.bgColor} flex items-center justify-center ${style.textColor} text-xl shadow-xs border border-black/5 flex-shrink-0`}
                          >
                            <i className={`fa-solid ${style.icon}`}></i>
                          </div>
                          <div>
                            <div className="font-bold text-gray-900">{cat.name}</div>
                            <div className="text-xs text-gray-400 font-normal font-mono flex items-center gap-2 mt-0.5">
                              <span><i className={`fa-solid ${style.icon} text-[10px]`}></i> {cat.icon || style.icon}</span>
                              {cat.color && (
                                <span className="flex items-center gap-1">
                                  <span className={`w-2 h-2 rounded-full ${COLOR_PRESETS[cat.color]?.dotBg || "bg-gray-400"}`}></span>
                                  {COLOR_PRESETS[cat.color]?.name || cat.color}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600 font-medium">
                        {cat.isActive ? (
                          <span className="inline-flex items-center gap-1.5 bg-[#D4F1BB]/50 text-[#16A085] px-3 py-1 rounded-xl font-bold border border-[#16A085]/20 text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#16A085]"></span>
                            เปิดใช้งาน
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 px-3 py-1 rounded-xl font-bold border border-gray-200 text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                            ปิดใช้งานแล้ว
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-medium">
                        {new Date(cat.createdAt).toLocaleDateString('th-TH')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditModal(cat)}
                            className="text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200 font-bold text-xs px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                            title="แก้ไขชื่อ ไอคอน และสี"
                          >
                            <i className="fa-solid fa-pen-to-square text-[#16A085]"></i> แก้ไข
                          </button>
                          {cat.isActive ? (
                            <button
                              onClick={() => handleToggleCategoryActive(cat.id, cat.isActive)}
                              className="text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-100 font-bold text-xs px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                            >
                              <i className="fa-solid fa-lock"></i> ปิดใช้งาน
                            </button>
                          ) : (
                            <button
                              onClick={() => handleToggleCategoryActive(cat.id, cat.isActive)}
                              className="text-[#16A085] bg-[#D4F1BB]/50 hover:bg-[#16A085] hover:text-white border border-[#16A085]/20 font-bold text-xs px-3.5 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                            >
                              <i className="fa-solid fa-unlock"></i> เปิดใช้งาน
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoadingCategories && categories.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-gray-400">
                      ยังไม่มีหมวดหมู่สินค้าในระบบ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / Edit Category Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl my-8 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${activeColorTone.bgColor} flex items-center justify-center ${activeColorTone.textColor} text-xl`}>
                  <i className={`fa-solid ${selectedIcon}`}></i>
                </div>
                <div>
                  <h3 className="font-black text-xl text-gray-800">
                    {editingCategory ? "แก้ไขหมวดหมู่สินค้า" : "เพิ่มหมวดหมู่ใหม่"}
                  </h3>
                  <p className="text-xs text-gray-500">ปรับแต่งชื่อ ไอคอน และสีตามเอกลักษณ์ของหมวดหมู่</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-9 h-9 rounded-full bg-gray-100 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1">
              {/* Category Name */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  ชื่อหมวดหมู่ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={categoryName}
                  onChange={e => setCategoryName(e.target.value)}
                  placeholder="เช่น เสื้อผ้าแฟชั่น, ข้าวสาร/ธัญพืช, งานจักสาน"
                  className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#16A085] focus:ring-2 focus:ring-[#16A085]/20 font-medium"
                  autoFocus
                />
              </div>

              {/* Color Tone Picker */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
                    <i className="fa-solid fa-palette text-[#16A085]"></i> เลือกโทนสี (Color Tone)
                  </label>
                  <span className="text-xs text-gray-500 font-medium flex items-center gap-1.5">
                    กำลังเลือก: <span className={`w-2.5 h-2.5 rounded-full ${activeColorTone.dotBg}`}></span>
                    <strong className="text-gray-800">{activeColorTone.name}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {Object.values(COLOR_PRESETS).map((tone: ColorTone) => {
                    const isSelected = selectedColor === tone.key;
                    return (
                      <button
                        key={tone.key}
                        type="button"
                        onClick={() => setSelectedColor(tone.key)}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold transition-all text-left ${
                          isSelected
                            ? `border-gray-900 bg-gray-900 text-white shadow-sm ring-2 ring-gray-900/30`
                            : `border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300`
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full ${tone.dotBg} flex-shrink-0 shadow-xs`}></span>
                        <span className="truncate">{tone.name.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                  <label className="text-sm font-bold text-gray-700 flex items-center gap-2">
                    <i className="fa-solid fa-icons text-[#16A085]"></i> เลือกไอคอน (Icon Picker)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                      <input
                        type="text"
                        value={iconSearch}
                        onChange={e => setIconSearch(e.target.value)}
                        placeholder="ค้นหาไอคอน..."
                        className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-[#16A085] w-36 sm:w-44"
                      />
                    </div>
                  </div>
                </div>

                {/* Filter category pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none mb-2">
                  {iconFilterCategories.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(cat)}
                      className={`text-xs px-3 py-1 rounded-full font-bold whitespace-nowrap transition-colors ${
                        selectedCategoryFilter === cat
                          ? "bg-[#16A085] text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Icon Grid */}
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 gap-2 max-h-48 overflow-y-auto p-2.5 bg-gray-50/80 rounded-2xl border border-gray-100">
                  {filteredIcons.map((item: IconOption) => {
                    const isSelected = selectedIcon === item.icon;
                    return (
                      <button
                        key={item.icon}
                        type="button"
                        onClick={() => setSelectedIcon(item.icon)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                          isSelected
                            ? "bg-white text-[#16A085] shadow-md ring-2 ring-[#16A085] scale-105 font-bold"
                            : "text-gray-600 hover:bg-white hover:text-gray-900"
                        }`}
                        title={item.name}
                      >
                        <i className={`fa-solid ${item.icon} text-lg mb-1`}></i>
                        <span className="text-[10px] truncate max-w-full leading-none">{item.name.split("/")[0]}</span>
                      </button>
                    );
                  })}
                  {filteredIcons.length === 0 && (
                    <div className="col-span-full py-6 text-center text-xs text-gray-400">
                      ไม่พบไอคอนที่ค้นหา
                    </div>
                  )}
                </div>
              </div>

              {/* Live Preview Card */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100/60 p-4 rounded-2xl border border-gray-200/60">
                <div className="text-xs font-black text-gray-500 uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>ตัวอย่างการแสดงผลจริง (Live Preview)</span>
                  <span className="text-[11px] text-[#16A085] font-bold"><i className="fa-solid fa-eye"></i> หน้าเว็บร้านค้า & แดชบอร์ด</span>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center justify-around gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-xs">
                  {/* Home Category Menu preview */}
                  <div className="flex flex-col items-center">
                    <div className="text-[11px] text-gray-400 font-semibold mb-2">แสดงบนหน้าแรก (หน้าร้าน)</div>
                    <div className="flex flex-col items-center group">
                      <div className={`w-20 h-20 ${activeColorTone.bgColor} rounded-3xl flex items-center justify-center text-3xl shadow-xs transition-all relative overflow-hidden border border-black/5`}>
                        <i className={`fa-solid ${selectedIcon} ${activeColorTone.textColor}`}></i>
                      </div>
                      <span className="text-xs font-bold text-gray-800 mt-2 text-center max-w-[120px] truncate">
                        {categoryName.trim() || "ชื่อหมวดหมู่"}
                      </span>
                    </div>
                  </div>

                  {/* Badge style preview */}
                  <div className="flex flex-col items-center sm:items-start border-t sm:border-t-0 sm:border-l border-gray-100 pt-3 sm:pt-0 sm:pl-6 w-full sm:w-auto">
                    <div className="text-[11px] text-gray-400 font-semibold mb-2">แสดงในตาราง & ตัวกรอง</div>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${activeColorTone.bgColor} flex items-center justify-center ${activeColorTone.textColor} text-lg shadow-xs border border-black/5`}>
                        <i className={`fa-solid ${selectedIcon}`}></i>
                      </div>
                      <div>
                        <div className="font-bold text-sm text-gray-800">{categoryName.trim() || "ชื่อหมวดหมู่"}</div>
                        <div className="text-[11px] text-gray-400">รหัสไอคอน: <code className="text-[#16A085]">{selectedIcon}</code></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
                className="px-5 py-2.5 font-bold text-sm text-gray-600 hover:bg-gray-200 rounded-xl transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveCategory}
                disabled={isSubmitting}
                className="px-6 py-2.5 font-bold text-sm text-white bg-[#16A085] hover:bg-[#117A65] rounded-xl shadow-md transition flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin"></i> กำลังบันทึก...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-check"></i> บันทึกข้อมูล
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
