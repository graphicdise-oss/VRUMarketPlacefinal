"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import { Address } from "@/types";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { addressApi, areaApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";

export default function AddressesClient() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const showSidebar = searchParams ? searchParams.get("from") === "profile" : false;
  
  // Area Data
  const [provinces, setProvinces] = useState<{ id: string; nameTh: string }[]>([]);
  const [districts, setDistricts] = useState<{ id: string; nameTh: string }[]>([]);
  const [subdistricts, setSubdistricts] = useState<{ id: string; nameTh: string; postalCodes: { id: string; postalCode: string }[] }[]>([]);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [phone, setPhone] = useState("");
  
  // Address Parts
  const [houseNumber, setHouseNumber] = useState("");
  const [villageNumber, setVillageNumber] = useState("");
  const [alley, setAlley] = useState("");
  const [road, setRoad] = useState("");
  
  // Selected Area IDs
  const [provinceId, setProvinceId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [subdistrictId, setSubdistrictId] = useState("");
  const [subdistrictPostalCodeId, setSubdistrictPostalCodeId] = useState("");
  const [postalCode, setPostalCode] = useState("");
  
  const [isDefault, setIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadAddresses = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await addressApi.list();
      setAddresses(res.items);
    } catch (err) {
      console.error("Failed to load addresses", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadProvinces = useCallback(async () => {
    try {
      const res = await areaApi.getProvinces();
      setProvinces(res.items);
    } catch (err) {
      console.error("Failed to load provinces", err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadAddresses();
    }
  }, [loadAddresses, user]);

  useEffect(() => {
    loadProvinces();
  }, [loadProvinces]);

  const resetForm = () => {
    setEditingId(null);
    setRecipientName("");
    setPhone("");
    setHouseNumber("");
    setVillageNumber("");
    setAlley("");
    setRoad("");
    setProvinceId("");
    setDistrictId("");
    setSubdistrictId("");
    setSubdistrictPostalCodeId("");
    setPostalCode("");
    setIsDefault(false);
    setShowForm(false);
  };

  const handleEdit = (addr: Address) => {
    setEditingId(addr.id);
    setRecipientName(addr.recipientName);
    setPhone(addr.phone);
    setHouseNumber(addr.houseNumber);
    setVillageNumber(addr.villageNumber || "");
    setAlley(addr.alley || "");
    setRoad(addr.road || "");
    
    // Load areas cascade
    setProvinceId(addr.provinceId);
    
    areaApi.getDistricts(addr.provinceId).then((res) => {
      setDistricts(res.items);
      setDistrictId(addr.districtId);
      
      return areaApi.getSubdistricts(addr.districtId);
    }).then((res) => {
      setSubdistricts(res.items);
      setSubdistrictId(addr.subdistrictId);
      setSubdistrictPostalCodeId(addr.subdistrictPostalCodeId);
      setPostalCode(addr.postalCode);
    }).catch(err => console.error(err));

    setIsDefault(addr.isDefault);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("คุณต้องการลบที่อยู่นี้ใช่หรือไม่?")) {
      try {
        await addressApi.delete(id);
        setAddresses(addresses.filter((a) => a.id !== id));
      } catch (err) {
        alert("ลบไม่สำเร็จ กรุณาลองใหม่");
      }
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await addressApi.setDefault(id);
      setAddresses(addresses.map((a) => ({ ...a, isDefault: a.id === id })));
    } catch (err) {
      alert("ไม่สามารถตั้งเป็นค่าเริ่มต้นได้");
    }
  };

  const handleProvinceChange = async (pId: string) => {
    setProvinceId(pId);
    setDistrictId("");
    setSubdistrictId("");
    setSubdistrictPostalCodeId("");
    setPostalCode("");
    
    setDistricts([]);
    setSubdistricts([]);
    
    if (pId) {
      const res = await areaApi.getDistricts(pId);
      setDistricts(res.items);
    }
  };

  const handleDistrictChange = async (dId: string) => {
    setDistrictId(dId);
    setSubdistrictId("");
    setSubdistrictPostalCodeId("");
    setPostalCode("");
    
    setSubdistricts([]);
    
    if (dId) {
      const res = await areaApi.getSubdistricts(dId);
      setSubdistricts(res.items);
    }
  };

  const handleSubDistrictChange = (sdId: string) => {
    setSubdistrictId(sdId);
    const sd = subdistricts.find(s => s.id === sdId);
    if (sd && sd.postalCodes.length > 0) {
      const pc = sd.postalCodes[0];
      setSubdistrictPostalCodeId(pc.id);
      setPostalCode(pc.postalCode);
    } else {
      setSubdistrictPostalCodeId("");
      setPostalCode("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subdistrictPostalCodeId) {
      alert("กรุณาเลือกตำบลให้ครบถ้วน");
      return;
    }

    setIsSubmitting(true);
    const payload = {
      recipientName,
      phone,
      houseNumber,
      villageNumber: villageNumber.trim() || undefined,
      alley: alley.trim() || undefined,
      road: road.trim() || undefined,
      subdistrictPostalCodeId
    };

    try {
      if (editingId) {
        const updated = await addressApi.update(editingId, payload as Parameters<typeof addressApi.update>[1]);
        if (isDefault && !addresses.find(a => a.id === editingId)?.isDefault) {
          await addressApi.setDefault(editingId);
          updated.isDefault = true;
        }
        await loadAddresses();
        alert("บันทึกการแก้ไขที่อยู่สำเร็จ");
      } else {
        const created = await addressApi.create(payload as Parameters<typeof addressApi.create>[0]);
        if (isDefault && addresses.length > 0) {
          await addressApi.setDefault(created.id);
        }
        await loadAddresses();
        alert("เพิ่มที่อยู่ใหม่สำเร็จ");
      }
      resetForm();
    } catch (err) {
      alert(getErrorMessage(err, "เกิดข้อผิดพลาดในการบันทึก"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatAddress = (addr: Address) => {
    const parts = [addr.houseNumber];
    if (addr.villageNumber) parts.push(`ม.${addr.villageNumber}`);
    if (addr.alley) parts.push(`ซ.${addr.alley}`);
    if (addr.road) parts.push(`ถ.${addr.road}`);
    return parts.join(" ");
  };

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className={`flex-grow mx-auto w-full px-4 pt-4 pb-12 flex flex-col md:flex-row gap-6 ${showSidebar ? 'max-w-7xl' : 'max-w-4xl'}`}>
        {/* Sidebar */}
        {showSidebar && (
          <ProfileSidebar 
            name={user?.displayName || ""} 
            avatarUrl={user?.avatarUrl || null} 
          />
        )}
        
        <div className="flex-grow min-w-0">
          <Breadcrumb items={[
            { label: "โปรไฟล์", href: "/profile" },
            { label: "ที่อยู่จัดส่ง" }
          ]} />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 mt-6">
          <h2 className="text-3xl font-black text-gray-800 flex items-center gap-3">
            <div className="w-12 h-12 bg-[#16A085] rounded-2xl flex items-center justify-center text-white shadow-sm">
              <i className="fa-solid fa-map-location-dot text-xl"></i>
            </div>
            ที่อยู่จัดส่งของคุณ
          </h2>
          {!showForm && !isLoading && addresses.length < 10 && (
            <button onClick={() => setShowForm(true)} className="btn-minimal bg-white border-2 border-gray-100 text-[#16A085] hover:border-[#16A085] font-bold px-6 py-3 rounded-full transition-all shadow-sm hover:shadow flex items-center justify-center gap-2">
              <i className="fa-solid fa-plus"></i> เพิ่มที่อยู่ใหม่
            </button>
          )}
        </div>

        {/* Info */}
        <div className="bg-[#D4F1BB]/30 border border-[#16A085]/30 rounded-2xl p-4 mb-8 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-white text-[#16A085] flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
            <i className="fa-solid fa-circle-info text-sm"></i>
          </div>
          <div>
            <p className="text-sm text-gray-700 font-medium leading-relaxed">
              <b className="text-[#16A085]">ข้อมูลสำคัญ:</b> ชื่อผู้รับและเบอร์โทรศัพท์จะผูกติดกับที่อยู่แต่ละรายการ (เพิ่มได้สูงสุด 10 รายการ)
            </p>
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 mb-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-[#16A085]"></div>
            <h3 className="font-bold text-gray-800 mb-6 text-xl flex items-center gap-2">
              <i className="fa-solid fa-pen-to-square text-gray-400"></i> {editingId ? "แก้ไขข้อมูลที่อยู่" : "กรอกข้อมูลที่อยู่ใหม่"}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อผู้รับ <span className="text-red-500">*</span></label>
                <input type="text" required maxLength={50} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="ชื่อ-นามสกุล ผู้รับสินค้า" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">เบอร์โทรศัพท์ <span className="text-red-500">*</span></label>
                <input type="tel" required pattern="^0[0-9]{8,9}$" title="เบอร์โทร 9 หรือ 10 หลัก ขึ้นต้นด้วย 0" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="0812345678" />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">บ้านเลขที่ <span className="text-red-500">*</span></label>
                <input type="text" required maxLength={20} value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="เช่น 123/45" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">หมู่ที่ (ถ้ามี)</label>
                <input type="text" maxLength={10} value={villageNumber} onChange={(e) => setVillageNumber(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="เช่น 6" />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ตรอก/ซอย (ถ้ามี)</label>
                <input type="text" maxLength={50} value={alley} onChange={(e) => setAlley(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="เช่น ซ.สุขุมวิท 1" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ถนน (ถ้ามี)</label>
                <input type="text" maxLength={50} value={road} onChange={(e) => setRoad(e.target.value)} className="w-full px-5 py-3.5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner" placeholder="เช่น ถนนสุขุมวิท" />
              </div>
              
              {/* Dropdown: จังหวัด → อำเภอ → ตำบล → รหัสไปรษณีย์ */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">จังหวัด <span className="text-red-500">*</span></label>
                <div className="relative">
                  <select required value={provinceId} onChange={(e) => handleProvinceChange(e.target.value)} className="w-full px-5 py-3.5 appearance-none bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner">
                    <option value="">เลือกจังหวัด</option>
                    {provinces.map((p) => <option key={p.id} value={p.id}>{p.nameTh}</option>)}
                  </select>
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <i className="fa-solid fa-chevron-down text-sm"></i>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">อำเภอ/เขต <span className="text-red-500">*</span></label>
                <div className="relative">
                  <select required value={districtId} onChange={(e) => handleDistrictChange(e.target.value)} disabled={!provinceId} className="w-full px-5 py-3.5 appearance-none bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-inner">
                    <option value="">เลือกอำเภอ/เขต</option>
                    {districts.map((d) => <option key={d.id} value={d.id}>{d.nameTh}</option>)}
                  </select>
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <i className="fa-solid fa-chevron-down text-sm"></i>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ตำบล/แขวง <span className="text-red-500">*</span></label>
                <div className="relative">
                  <select required value={subdistrictId} onChange={(e) => handleSubDistrictChange(e.target.value)} disabled={!districtId} className="w-full px-5 py-3.5 appearance-none bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-[#16A085] focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-inner">
                    <option value="">เลือกตำบล/แขวง</option>
                    {subdistricts.map((sd) => <option key={sd.id} value={sd.id}>{sd.nameTh}</option>)}
                  </select>
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <i className="fa-solid fa-chevron-down text-sm"></i>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">รหัสไปรษณีย์ <span className="text-red-500">*</span></label>
                <input type="text" required value={postalCode} readOnly className="w-full px-5 py-3.5 bg-gray-100 border-2 border-gray-200 rounded-2xl text-sm font-black text-gray-600 outline-none cursor-not-allowed" placeholder="รหัสอัตโนมัติ" />
              </div>
              
              <div className="md:col-span-2 flex flex-col md:flex-row md:items-center justify-between gap-6 mt-6 border-t border-gray-100 pt-6">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-all ${isDefault ? 'bg-[#16A085] border-[#16A085]' : 'bg-white border-gray-300 group-hover:border-[#16A085]'}`}>
                    {isDefault && <i className="fa-solid fa-check text-white text-xs"></i>}
                  </div>
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="sr-only" /> 
                  <span className="font-bold text-gray-700 group-hover:text-[#16A085] transition-colors">ตั้งเป็นที่อยู่จัดส่งเริ่มต้น</span>
                </label>
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                  <button type="button" onClick={resetForm} disabled={isSubmitting} className="flex-1 sm:flex-none px-8 py-3.5 bg-white border-2 border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all shadow-sm">ยกเลิก</button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none btn-minimal px-8 py-3.5 text-white rounded-full text-sm font-bold transition-all shadow-md disabled:opacity-50">
                    <i className="fa-solid fa-floppy-disk mr-2"></i> {isSubmitting ? "กำลังบันทึก..." : "บันทึกข้อมูลที่อยู่"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Address List */}
        {!showForm && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isLoading ? (
               <div className="col-span-1 md:col-span-2 text-center py-16">
                 <i className="fa-solid fa-spinner fa-spin text-3xl text-[#16A085]"></i>
               </div>
            ) : addresses.length === 0 ? (
              <div className="col-span-1 md:col-span-2 text-center py-16 bg-white rounded-3xl border border-gray-100 shadow-sm">
                <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-5xl">
                  <i className="fa-solid fa-map-location-dot"></i>
                </div>
                <h3 className="text-xl font-bold text-gray-700 mb-2">ยังไม่มีที่อยู่จัดส่ง</h3>
                <p className="text-gray-500 font-medium">เพิ่มที่อยู่สำหรับการจัดส่งสินค้าเพื่อให้การสั่งซื้อของคุณรวดเร็วขึ้น</p>
              </div>
            ) : (
              addresses.map((addr) => (
                <div key={addr.id} className={`bg-white rounded-3xl p-6 transition-all duration-300 ${addr.isDefault ? "border-2 border-[#16A085] shadow-md relative overflow-hidden" : "border border-gray-200 shadow-sm hover:shadow-md hover:border-[#16A085]/50"}`}>
                  {addr.isDefault && (
                    <div className="absolute top-0 right-0 bg-[#16A085] text-white text-[10px] font-black px-4 py-1.5 rounded-bl-xl shadow-sm tracking-widest">
                      ค่าเริ่มต้น
                    </div>
                  )}
                  <div className="flex flex-col h-full">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-black text-gray-800 text-xl">{addr.recipientName}</h3>
                        <span className="text-gray-300">|</span>
                        <span className="text-sm font-bold text-gray-500">{addr.phone}</span>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-sm text-gray-700 font-medium mb-1 leading-relaxed">{formatAddress(addr)}</p>
                        <p className="text-sm text-gray-600 font-medium">ต.{addr.subdistrictNameTh} อ.{addr.districtNameTh} <br />จ.{addr.provinceNameTh} {addr.postalCode}</p>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-gray-100">
                      {!addr.isDefault && (
                        <button onClick={() => handleSetDefault(addr.id)} className="flex-1 text-xs font-bold text-[#16A085] bg-[#D4F1BB]/30 hover:bg-[#D4F1BB] rounded-xl px-4 py-2.5 transition-all shadow-sm">
                          <i className="fa-solid fa-check mr-1"></i> ตั้งเป็นค่าเริ่มต้น
                        </button>
                      )}
                      <button onClick={() => handleEdit(addr)} className="flex-1 text-xs font-bold text-gray-600 hover:text-[#16A085] bg-white border-2 border-gray-100 hover:border-[#16A085] rounded-xl px-4 py-2.5 transition-all shadow-sm">
                        <i className="fa-solid fa-pen mr-1"></i> แก้ไข
                      </button>
                      <button onClick={() => handleDelete(addr.id)} className="flex-1 text-xs font-bold text-red-500 bg-white border-2 border-red-100 hover:border-red-500 hover:bg-red-50 rounded-xl px-4 py-2.5 transition-all shadow-sm">
                        <i className="fa-solid fa-trash mr-1"></i> ลบ
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
