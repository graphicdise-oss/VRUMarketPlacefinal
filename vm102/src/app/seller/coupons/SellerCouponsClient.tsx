"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { couponApi, type CouponDto, type CouponDiscountType } from "@/lib/api";

export default function SellerCouponsClient() {
  const [coupons, setCoupons] = useState<CouponDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<"ALL" | "ACTIVE" | "EXPIRED">("ALL");

  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form Fields
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<CouponDiscountType>("FIXED_AMOUNT");
  const [discountValueInput, setDiscountValueInput] = useState("50");
  const [minSpendInput, setMinSpendInput] = useState("0");
  const [maxDiscountInput, setMaxDiscountInput] = useState("");
  const [quotaInput, setQuotaInput] = useState("50");

  // Default dates: now and 14 days later
  const getDefaultStartDate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const getDefaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  const [startDateInput, setStartDateInput] = useState(getDefaultStartDate());
  const [endDateInput, setEndDateInput] = useState(getDefaultEndDate());

  // Edit Modal State
  const [editingCoupon, setEditingCoupon] = useState<CouponDto | null>(null);
  const [editQuota, setEditQuota] = useState("");
  const [editEndDate, setEditEndDate] = useState("");

  const fetchCoupons = async () => {
    setIsLoading(true);
    try {
      const data = await couponApi.getShopCoupons();
      setCoupons(data);
    } catch (err) {
      console.error("Failed to fetch coupons:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const resetCreateForm = () => {
    setCode("");
    setName("");
    setDiscountType("FIXED_AMOUNT");
    setDiscountValueInput("50");
    setMinSpendInput("0");
    setMaxDiscountInput("");
    setQuotaInput("50");
    setStartDateInput(getDefaultStartDate());
    setEndDateInput(getDefaultEndDate());
    setErrorMessage(null);
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMessage("กรุณาระบุรหัสโค้ดส่วนลด");
      return;
    }
    if (!name.trim()) {
      setErrorMessage("กรุณาระบุชื่อหรือคำอธิบายคูปอง");
      return;
    }

    const discountVal = parseFloat(discountValueInput);
    if (isNaN(discountVal) || discountVal <= 0) {
      setErrorMessage("มูลค่าส่วนลดต้องมากกว่า 0");
      return;
    }

    if (discountType === "PERCENTAGE" && discountVal > 100) {
      setErrorMessage("ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100%");
      return;
    }

    const quota = parseInt(quotaInput, 10);
    if (isNaN(quota) || quota < 1) {
      setErrorMessage("จำนวนสิทธิ์ต้องอย่างน้อย 1 สิทธิ์");
      return;
    }

    const start = new Date(startDateInput);
    const end = new Date(endDateInput);
    if (start >= end) {
      setErrorMessage("วันเริ่มต้นต้องอยู่ก่อนวันหมดอายุ");
      return;
    }

    setIsSubmitting(true);
    try {
      // Satang conversion
      const discountValueMinor =
        discountType === "FIXED_AMOUNT" ? Math.round(discountVal * 100) : Math.round(discountVal);
      const minSpendAmountMinor = minSpendInput ? Math.round(parseFloat(minSpendInput) * 100) : 0;
      const maxDiscountAmountMinor =
        discountType === "PERCENTAGE" && maxDiscountInput ? Math.round(parseFloat(maxDiscountInput) * 100) : undefined;

      await couponApi.createCoupon({
        code: cleanCode,
        name: name.trim(),
        discountType,
        discountValue: discountValueMinor,
        minSpendAmountMinor,
        maxDiscountAmountMinor,
        quota,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      setIsCreateModalOpen(false);
      resetCreateForm();
      await fetchCoupons();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการสร้างคูปอง";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (c: CouponDto) => {
    try {
      await couponApi.updateCoupon(c.id, { isActive: !c.isActive });
      setCoupons((prev) => prev.map((item) => (item.id === c.id ? { ...item, isActive: !item.isActive } : item)));
    } catch (err) {
      alert("ไม่สามารถเปลี่ยนสถานะคูปองได้: " + (err instanceof Error ? err.message : ""));
    }
  };

  const handleDelete = async (c: CouponDto) => {
    if (!confirm(`คุณต้องการลบหรือปิดคูปอง "${c.code}" ใช่หรือไม่?`)) return;
    try {
      const res = await couponApi.deleteCoupon(c.id);
      alert(res.message);
      await fetchCoupons();
    } catch (err) {
      alert("เกิดข้อผิดพลาดในการลบคูปอง: " + (err instanceof Error ? err.message : ""));
    }
  };

  const handleOpenEdit = (c: CouponDto) => {
    setEditingCoupon(c);
    setEditQuota(c.quota.toString());
    const d = new Date(c.endDate);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setEditEndDate(d.toISOString().slice(0, 16));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCoupon) return;

    const q = parseInt(editQuota, 10);
    if (isNaN(q) || q < editingCoupon.claimedCount) {
      alert(`จำนวนสิทธิ์ต้องไม่น้อยกว่าจำนวนที่ถูกเก็บไปแล้ว (${editingCoupon.claimedCount} สิทธิ์)`);
      return;
    }

    const end = new Date(editEndDate);
    if (isNaN(end.getTime())) {
      alert("กรุณาระบุวันหมดอายุที่ถูกต้อง");
      return;
    }

    try {
      await couponApi.updateCoupon(editingCoupon.id, {
        quota: q,
        endDate: end.toISOString(),
      });
      setEditingCoupon(null);
      await fetchCoupons();
    } catch (err) {
      alert("เกิดข้อผิดพลาด: " + (err instanceof Error ? err.message : ""));
    }
  };

  // Stats calculation
  const now = new Date();
  const activeCouponsCount = coupons.filter((c) => c.isActive && new Date(c.endDate) >= now).length;
  const totalClaimedCount = coupons.reduce((sum, c) => sum + c.claimedCount, 0);
  const totalUsedCount = coupons.reduce((sum, c) => sum + c.usedCount, 0);

  // Filtered List
  const filteredCoupons = coupons.filter((c) => {
    const isExpired = new Date(c.endDate) < now;
    if (filterTab === "ACTIVE") return c.isActive && !isExpired;
    if (filterTab === "EXPIRED") return !c.isActive || isExpired;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white sticky top-0 z-40 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <Link
            href="/seller"
            className="flex items-center gap-2 text-gray-600 hover:text-[#16A085] transition font-bold text-sm"
          >
            <i className="fa-solid fa-arrow-left"></i> กลับหน้าร้าน
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-[#16A085] flex items-center justify-center">
              <i className="fa-solid fa-ticket"></i>
            </div>
            <h1 className="text-lg md:text-xl font-black text-gray-800">จัดการโค้ดส่วนลดร้านค้า</h1>
          </div>
          <button
            onClick={() => {
              resetCreateForm();
              setIsCreateModalOpen(true);
            }}
            className="bg-[#16A085] hover:bg-[#12876f] text-white font-bold py-2 px-4 rounded-xl text-sm shadow-sm transition flex items-center gap-1.5"
          >
            <i className="fa-solid fa-plus"></i> สร้างโค้ดส่วนลด
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 md:py-8 w-full flex-1">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-[#16A085] flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-tags"></i>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">คูปองที่เปิดใช้งาน</p>
              <h3 className="text-2xl font-black text-gray-800 mt-0.5">{activeCouponsCount} รายการ</h3>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-hand-holding-heart"></i>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">ถูกเก็บไปแล้ว</p>
              <h3 className="text-2xl font-black text-gray-800 mt-0.5">{totalClaimedCount} สิทธิ์</h3>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-receipt"></i>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">ถูกใช้งานในออเดอร์</p>
              <h3 className="text-2xl font-black text-gray-800 mt-0.5">{totalUsedCount} ครั้ง</h3>
            </div>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setFilterTab("ALL")}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                filterTab === "ALL"
                  ? "bg-[#16A085] text-white shadow-sm"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              ทั้งหมด ({coupons.length})
            </button>
            <button
              onClick={() => setFilterTab("ACTIVE")}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                filterTab === "ACTIVE"
                  ? "bg-[#16A085] text-white shadow-sm"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              ใช้งานอยู่ ({activeCouponsCount})
            </button>
            <button
              onClick={() => setFilterTab("EXPIRED")}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                filterTab === "EXPIRED"
                  ? "bg-[#16A085] text-white shadow-sm"
                  : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              หมดอายุ / ปิดใช้งาน ({coupons.length - activeCouponsCount})
            </button>
          </div>
        </div>

        {/* Coupon Cards Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse h-48"></div>
            ))}
          </div>
        ) : filteredCoupons.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 max-w-lg mx-auto my-8">
            <div className="w-16 h-16 bg-emerald-50 text-[#16A085] rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">
              <i className="fa-solid fa-ticket"></i>
            </div>
            <h3 className="text-lg font-black text-gray-800">ยังไม่มีโค้ดส่วนลดในหมวดนี้</h3>
            <p className="text-gray-500 text-sm mt-1 mb-6">
              สร้างคูปองส่วนลดเพื่อดึงดูดลูกค้าและเพิ่มยอดขายให้กับร้านค้าของคุณ
            </p>
            <button
              onClick={() => {
                resetCreateForm();
                setIsCreateModalOpen(true);
              }}
              className="bg-[#16A085] hover:bg-[#12876f] text-white font-bold py-2.5 px-6 rounded-xl text-sm transition shadow-sm inline-flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i> สร้างโค้ดส่วนลดใหม่
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredCoupons.map((c) => {
              const isExpired = new Date(c.endDate) < now;
              const isEffectiveActive = c.isActive && !isExpired;
              const quotaPercent = c.quota > 0 ? Math.min(100, (c.claimedCount / c.quota) * 100) : 0;

              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-2xl border transition-all overflow-hidden shadow-sm hover:shadow-md flex flex-col justify-between ${
                    isEffectiveActive
                      ? "border-emerald-200 hover:border-[#16A085]"
                      : "border-gray-200 opacity-80"
                  }`}
                >
                    {/* Top Voucher Banner */}
                    <div
                      className={`p-5 relative ${
                        isEffectiveActive
                          ? "bg-gradient-to-r from-emerald-500 to-[#16A085] text-white"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xl font-black tracking-wider px-2.5 py-0.5 rounded-lg bg-white/20 backdrop-blur-sm border border-white/30 uppercase">
                              {c.code}
                            </span>
                            {isEffectiveActive ? (
                              <span className="text-[11px] font-bold bg-white text-[#16A085] px-2 py-0.5 rounded-full shadow-sm">
                                ใช้งานอยู่
                              </span>
                            ) : isExpired ? (
                              <span className="text-[11px] font-bold bg-gray-300 text-gray-700 px-2 py-0.5 rounded-full">
                                หมดอายุ
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                                ปิดใช้งาน
                              </span>
                            )}
                          </div>
                          <h4 className="font-bold text-sm mt-2 line-clamp-1">{c.name}</h4>
                        </div>

                        <div className="text-right">
                          <span className="text-2xl font-black">
                            {c.discountType === "FIXED_AMOUNT" ? `฿${c.discountValue / 100}` : `${c.discountValue}%`}
                          </span>
                          <p className="text-[11px] font-medium opacity-90">
                            {c.discountType === "FIXED_AMOUNT" ? "ลดคงที่" : "ส่วนลด"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Middle Details */}
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-2 text-xs text-gray-600">
                        <div className="flex justify-between">
                          <span className="text-gray-400">ยอดสั่งซื้อขั้นต่ำ:</span>
                          <span className="font-bold text-gray-700">
                            {c.minSpendAmountMinor > 0 ? `฿${(c.minSpendAmountMinor / 100).toLocaleString()}` : "ไม่มีขั้นต่ำ"}
                          </span>
                        </div>

                        {c.discountType === "PERCENTAGE" && c.maxDiscountAmountMinor && (
                          <div className="flex justify-between">
                            <span className="text-gray-400">ลดสูงสุด:</span>
                            <span className="font-bold text-gray-700">
                              ฿{(c.maxDiscountAmountMinor / 100).toLocaleString()}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between">
                          <span className="text-gray-400">ระยะเวลาใช้งาน:</span>
                          <span className="font-bold text-gray-700 text-[11px]">
                            {new Date(c.startDate).toLocaleDateString("th-TH")} -{" "}
                            {new Date(c.endDate).toLocaleDateString("th-TH")}
                          </span>
                        </div>
                      </div>

                      {/* Quota Progress */}
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-500 font-medium">สิทธิ์ที่ถูกเก็บ:</span>
                          <span className="font-bold text-gray-700">
                            {c.claimedCount} / {c.quota} สิทธิ์{" "}
                            <span className="text-gray-400 font-normal">({c.usedCount} ใช้แล้ว)</span>
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              quotaPercent >= 90 ? "bg-amber-500" : "bg-[#16A085]"
                            }`}
                            style={{ width: `${quotaPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="bg-gray-50 px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                      <button
                        onClick={() => handleToggleActive(c)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition ${
                          c.isActive
                            ? "bg-white text-gray-600 border-gray-200 hover:bg-gray-100"
                            : "bg-emerald-50 text-[#16A085] border-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        {c.isActive ? (
                          <>
                            <i className="fa-solid fa-pause mr-1 text-gray-400"></i> ปิดใช้งาน
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-play mr-1 text-[#16A085]"></i> เปิดใช้งาน
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="p-1.5 text-gray-500 hover:text-[#16A085] hover:bg-white rounded-lg transition"
                          title="แก้ไขโควต้าและวันหมดอายุ"
                        >
                          <i className="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white rounded-lg transition"
                          title="ลบคูปอง"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </div>
                  </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* CREATE COUPON MODAL                                      */}
      {/* ======================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#16A085] flex items-center justify-center text-lg">
                  <i className="fa-solid fa-ticket"></i>
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-800">สร้างโค้ดส่วนลดใหม่</h3>
                  <p className="text-xs text-gray-400">กำหนดเงื่อนไขส่วนลดสำหรับลูกค้าของคุณ</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 flex items-center justify-center transition"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-xs mb-4 flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation flex-shrink-0 text-sm"></i>
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleCreateCoupon} className="space-y-4">
              {/* Code */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  รหัสโค้ดส่วนลด (Code) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="เช่น VRU50, DISCOUNT10"
                  maxLength={50}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono font-bold tracking-wider uppercase focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
                <p className="text-[11px] text-gray-400 mt-1">ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข ขีดกลาง หรือขีดล่าง</p>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  ชื่อคูปอง / คำอธิบาย <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น ส่วนลดพิเศษเปิดเทอม, ต้อนรับลูกค้าใหม่"
                  maxLength={120}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
              </div>

              {/* Discount Type Selector */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  ประเภทส่วนลด <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType("FIXED_AMOUNT");
                      setDiscountValueInput("50");
                    }}
                    className={`py-3 px-4 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 ${
                      discountType === "FIXED_AMOUNT"
                        ? "bg-emerald-50 text-[#16A085] border-[#16A085] shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <i className="fa-solid fa-baht-sign"></i> ลดเป็นจำนวนเงิน (บาท)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType("PERCENTAGE");
                      setDiscountValueInput("10");
                    }}
                    className={`py-3 px-4 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-2 ${
                      discountType === "PERCENTAGE"
                        ? "bg-emerald-50 text-[#16A085] border-[#16A085] shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <i className="fa-solid fa-percent"></i> ลดเป็นเปอร์เซ็นต์ (%)
                  </button>
                </div>
              </div>

              {/* Discount Value */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    มูลค่าส่วนลด ({discountType === "FIXED_AMOUNT" ? "บาท" : "%"}){" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={discountType === "PERCENTAGE" ? "100" : undefined}
                    step="1"
                    value={discountValueInput}
                    onChange={(e) => setDiscountValueInput(e.target.value)}
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">ยอดสั่งซื้อขั้นต่ำ (บาท)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={minSpendInput}
                    onChange={(e) => setMinSpendInput(e.target.value)}
                    placeholder="0 = ไม่มีขั้นต่ำ"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Max Discount Cap for Percentage */}
              {discountType === "PERCENTAGE" && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    ลดได้สูงสุดไม่เกิน (บาท) <span className="text-gray-400 font-normal">(ไม่ระบุ = ไม่จำกัด)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={maxDiscountInput}
                    onChange={(e) => setMaxDiscountInput(e.target.value)}
                    placeholder="เช่น 100"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                  />
                </div>
              )}

              {/* Quota */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  จำนวนสิทธิ์คูปอง (สิทธิ์) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quotaInput}
                  onChange={(e) => setQuotaInput(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
              </div>

              {/* Date Ranges */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    วันเริ่มต้น <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={startDateInput}
                    onChange={(e) => setStartDateInput(e.target.value)}
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    วันหมดอายุ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={endDateInput}
                    onChange={(e) => setEndDateInput(e.target.value)}
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#16A085] hover:bg-[#12876f] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition shadow-sm flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i> สร้างโค้ดส่วนลด
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* EDIT MODAL                                               */}
      {/* ======================================================== */}
      {editingCoupon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
              <h3 className="font-black text-gray-800 text-base">แก้ไขคูปอง: {editingCoupon.code}</h3>
              <button
                onClick={() => setEditingCoupon(null)}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 flex items-center justify-center transition"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  จำนวนสิทธิ์ทั้งหมด (ปัจจุบันเก็บแล้ว {editingCoupon.claimedCount} สิทธิ์)
                </label>
                <input
                  type="number"
                  min={editingCoupon.claimedCount}
                  step="1"
                  value={editQuota}
                  onChange={(e) => setEditQuota(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">ขยายวันหมดอายุ</label>
                <input
                  type="datetime-local"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingCoupon(null)}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="bg-[#16A085] hover:bg-[#12876f] text-white font-bold px-5 py-2 rounded-xl text-sm transition"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
