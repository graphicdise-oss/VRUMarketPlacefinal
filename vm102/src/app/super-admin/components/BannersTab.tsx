"use client";

import { useState, useEffect } from "react";
import { bannerApi, BannerDto, CreateBannerDto, UpdateBannerDto } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Image from "next/image";

export default function BannersTab() {
  const [banners, setBanners] = useState<BannerDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<BannerDto | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [formData, setFormData] = useState<CreateBannerDto>({
    title: "",
    subtitle: "",
    tag: "",
    imageUrl: "",
    linkUrl: "",
    displayOrder: 0,
    isActive: true,
  });

  const loadBanners = async () => {
    setIsLoading(true);
    try {
      const { items } = await bannerApi.getAllBanners();
      setBanners(items);
    } catch (error) {
      console.error(error);
      showToast("ไม่สามารถโหลดข้อมูลแบนเนอร์ได้", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBanners();
  }, []);

  const handleOpenModal = (banner?: BannerDto) => {
    if (banner) {
      setEditingBanner(banner);
      setFormData({
        title: banner.title || "",
        subtitle: banner.subtitle || "",
        tag: banner.tag || "",
        imageUrl: banner.imageUrl,
        linkUrl: banner.linkUrl || "",
        displayOrder: banner.displayOrder,
        isActive: banner.isActive,
      });
    } else {
      setEditingBanner(null);
      setFormData({
        title: "",
        subtitle: "",
        tag: "",
        imageUrl: "",
        linkUrl: "",
        displayOrder: banners.length > 0 ? Math.max(...banners.map(b => b.displayOrder)) + 1 : 0,
        isActive: true,
      });
    }
    setIsModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    try {
      const uploadData = new FormData();
      uploadData.append("file", file);
      
      const res = await fetch("/api/upload", {
        method: "POST",
        body: uploadData,
      });
      
      if (!res.ok) throw new Error("Upload failed");
      
      const data = await res.json();
      setFormData(prev => ({ ...prev, imageUrl: data.url }));
      showToast("อัพโหลดรูปภาพสำเร็จ", "success");
    } catch (error) {
      console.error(error);
      showToast("ไม่สามารถอัพโหลดรูปภาพได้", "error");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingBanner(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.imageUrl) {
      showToast("กรุณาระบุ URL ของรูปภาพ", "error");
      return;
    }

    setIsSaving(true);
    try {
      if (editingBanner) {
        await bannerApi.updateBanner(editingBanner.id, formData);
        showToast("แก้ไขแบนเนอร์สำเร็จ", "success");
      } else {
        await bannerApi.createBanner(formData);
        showToast("เพิ่มแบนเนอร์สำเร็จ", "success");
      }
      await loadBanners();
      handleCloseModal();
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ที่จะลบแบนเนอร์นี้?")) return;
    
    try {
      await bannerApi.deleteBanner(id);
      showToast("ลบแบนเนอร์สำเร็จ", "success");
      loadBanners();
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    }
  };

  const handleToggleActive = async (banner: BannerDto) => {
    try {
      await bannerApi.updateBanner(banner.id, { isActive: !banner.isActive });
      loadBanners();
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ", "error");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-gray-900 mb-2">จัดการแบนเนอร์โฆษณา</h1>
          <p className="text-gray-500">จัดการสไลเดอร์แบนเนอร์ที่แสดงในหน้าแรกของเว็บไซต์</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[#16A085] hover:bg-[#117A65] text-white px-6 py-3 rounded-xl font-bold shadow-sm hover:shadow-md transition flex items-center gap-2"
        >
          <i className="fa-solid fa-plus"></i>
          เพิ่มแบนเนอร์ใหม่
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#16A085]"></div>
        </div>
      ) : banners.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300 text-3xl">
            <i className="fa-solid fa-images"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">ยังไม่มีแบนเนอร์</h3>
          <p className="text-gray-500 mb-6">คลิกที่ปุ่มเพิ่มแบนเนอร์ใหม่เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {banners.map((banner) => (
            <div key={banner.id} className={`bg-white rounded-2xl overflow-hidden shadow-sm border ${!banner.isActive ? 'border-gray-200 opacity-70' : 'border-gray-100'}`}>
              <div className="relative aspect-[1920/750] bg-gray-100 w-full">
                {banner.imageUrl ? (
                  <img src={banner.imageUrl} alt={banner.title || "Banner"} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">No Image</div>
                )}
                
                <div className="absolute top-3 right-3 flex gap-2">
                  <button
                    onClick={() => handleToggleActive(banner)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md transition ${banner.isActive ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-gray-300 hover:bg-gray-400 text-white'}`}
                    title={banner.isActive ? "ปิดการแสดงผล" : "เปิดการแสดงผล"}
                  >
                    <i className={`fa-solid ${banner.isActive ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                  </button>
                </div>
                
                <div className="absolute bottom-3 left-3">
                  <span className="bg-black/70 text-white text-xs px-2 py-1 rounded font-mono">
                    ลำดับ: {banner.displayOrder}
                  </span>
                </div>
              </div>
              
              <div className="p-5">
                <div className="mb-4">
                  {banner.tag && <span className="inline-block bg-[#D4F1BB] text-[#16A085] text-[10px] font-bold px-2 py-1 rounded mb-2">{banner.tag}</span>}
                  <h3 className="font-bold text-gray-800 line-clamp-1">{banner.title || <span className="text-gray-400 italic">ไม่มีหัวข้อ (ใช้รูปอย่างเดียว)</span>}</h3>
                  <p className="text-sm text-gray-500 line-clamp-1">{banner.subtitle || "-"}</p>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenModal(banner)}
                    className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-lg font-medium transition text-sm flex items-center justify-center gap-2"
                  >
                    <i className="fa-solid fa-pen-to-square"></i> แก้ไข
                  </button>
                  <button
                    onClick={() => handleDelete(banner.id)}
                    className="flex-none w-10 bg-red-50 hover:bg-red-100 text-red-500 py-2 rounded-lg transition flex items-center justify-center"
                  >
                    <i className="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-xl font-bold text-gray-800">
                {editingBanner ? "แก้ไขแบนเนอร์" : "เพิ่มแบนเนอร์ใหม่"}
              </h2>
              <button onClick={handleCloseModal} className="w-8 h-8 bg-white hover:bg-gray-100 rounded-full flex items-center justify-center text-gray-500 shadow-sm transition">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    รูปภาพแบนเนอร์ <span className="text-red-500">*</span>
                  </label>
                  
                  {formData.imageUrl ? (
                    <div className="relative w-full aspect-[1920/750] bg-gray-100 rounded-xl overflow-hidden border border-gray-200 group">
                      <Image 
                        src={formData.imageUrl} 
                        alt="Preview" 
                        fill 
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <label className="cursor-pointer bg-white text-gray-800 px-4 py-2 rounded-lg font-medium text-sm shadow-sm hover:bg-gray-50 transition">
                          <i className="fa-solid fa-camera mr-2"></i>เปลี่ยนรูปภาพ
                          <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={isUploadingImage} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full aspect-[1920/750] bg-gray-50 hover:bg-gray-100 border-2 border-dashed border-gray-300 hover:border-[#16A085] rounded-xl cursor-pointer transition-colors group">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {isUploadingImage ? (
                          <i className="fa-solid fa-circle-notch fa-spin text-3xl text-[#16A085] mb-3"></i>
                        ) : (
                          <i className="fa-solid fa-cloud-arrow-up text-3xl text-gray-400 group-hover:text-[#16A085] mb-3 transition-colors"></i>
                        )}
                        <p className="mb-1 text-sm text-gray-500 font-medium">
                          <span className="font-bold text-[#16A085]">คลิกเพื่ออัพโหลด</span> หรือลากไฟล์มาวาง
                        </p>
                        <p className="text-xs text-gray-400">อัตราส่วนที่แนะนำ 1920x750 พิกเซล</p>
                      </div>
                      <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} disabled={isUploadingImage} />
                    </label>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">หัวข้อ (Title)</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({...formData, title: e.target.value})}
                      placeholder="ไม่ต้องใส่หากรูปภาพมีข้อความอยู่แล้ว"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">ป้ายกำกับ (Tag)</label>
                    <input
                      type="text"
                      value={formData.tag}
                      onChange={(e) => setFormData({...formData, tag: e.target.value})}
                      placeholder="เช่น โปรโมชัน"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">คำบรรยาย (Subtitle)</label>
                  <input
                    type="text"
                    value={formData.subtitle}
                    onChange={(e) => setFormData({...formData, subtitle: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">ลิงก์ปลายทาง (Link)</label>
                    <input
                      type="text"
                      value={formData.linkUrl}
                      onChange={(e) => setFormData({...formData, linkUrl: e.target.value})}
                      placeholder="เช่น /products"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">ลำดับการแสดงผล (ยิ่งน้อยยิ่งขึ้นก่อน)</label>
                    <input
                      type="number"
                      value={formData.displayOrder}
                      onChange={(e) => setFormData({...formData, displayOrder: parseInt(e.target.value) || 0})}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-[#16A085] outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-gray-50 p-4 rounded-xl">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                    className="w-5 h-5 rounded text-[#16A085] focus:ring-[#16A085]"
                  />
                  <label htmlFor="isActive" className="font-bold text-gray-800 cursor-pointer">
                    เปิดใช้งานแบนเนอร์นี้
                  </label>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3.5 rounded-xl transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-[#16A085] hover:bg-[#117A65] text-white font-bold py-3.5 rounded-xl transition shadow-md hover:shadow-lg disabled:opacity-50"
                >
                  {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
