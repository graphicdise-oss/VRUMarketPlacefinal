"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { buyerOrderApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

export default function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [reason, setReason] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (images.length === 0) {
      alert("กรุณาแนบรูปภาพหลักฐานอย่างน้อย 1 รูป");
      return;
    }
    if (reason.length < 10) {
      alert("กรุณาระบุปัญหาที่พบอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setIsSubmitting(true);
    try {
      await buyerOrderApi.openDispute(id, reason, images);
      alert("ส่งคำร้องข้อพิพาทเรียบร้อยแล้ว แอดมินชุมชนจะเข้ามาตรวจสอบ");
      router.push(`/orders/${id}`);
    } catch (err) {
      alert("Error opening dispute: " + getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setImages(Array.from(e.target.files));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-2xl mx-auto w-full px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/orders/${id}`} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-500 hover:text-red-500 hover:border-red-500 transition shadow-sm">
            <i className="fa-solid fa-arrow-left"></i>
          </Link>
          <h2 className="text-xl font-bold text-gray-800">เปิดข้อพิพาท / แจ้งปัญหา</h2>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <h3 className="font-bold text-red-800 mb-1"><i className="fa-solid fa-circle-exclamation mr-1"></i> เงื่อนไขการเปิดข้อพิพาท</h3>
            <ul className="text-sm text-red-700 space-y-1 ml-5 list-disc">
              <li>ต้องดำเนินการภายใน 7 วันหลังกดรับสินค้า</li>
              <li><b>บังคับแนบรูปภาพหลักฐาน</b> (เช่น รูปกล่องพัสดุ สินค้าที่ชำรุด หรือสลิปโอนเงิน)</li>
              <li>แอดมินชุมชนจะเป็นผู้ตัดสินในขั้นแรก หากไม่พอใจสามารถอุทธรณ์ไปที่ Super Admin ได้</li>
            </ul>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">ระบุปัญหาที่พบ *</label>
              <textarea 
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-red-500 focus:border-red-500 text-sm"
                placeholder="เช่น สินค้าไม่ตรงปก, ได้รับสินค้าไม่ครบ, สินค้าชำรุดเสียหาย..."
              ></textarea>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">รูปภาพหลักฐาน * <span className="font-normal text-gray-400">(สูงสุด 5 รูป)</span></label>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:bg-gray-50 transition cursor-pointer relative">
                <input 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  onChange={handleImageChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  required={images.length === 0}
                />
                <i className="fa-solid fa-cloud-arrow-up text-3xl text-gray-400 mb-2"></i>
                <p className="text-sm font-bold text-gray-600">คลิก หรือ ลากไฟล์มาวางที่นี่</p>
                <p className="text-xs text-gray-400 mt-1">ไฟล์ .JPG, .PNG ไม่เกิน 10MB</p>
              </div>
              
              {images.length > 0 && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {images.map((file, idx) => (
                    <div key={idx} className="relative group">
                      <div className="w-20 h-20 bg-gray-100 rounded-lg border border-gray-200 overflow-hidden flex items-center justify-center">
                        <span className="text-xs text-gray-500 truncate px-2">{file.name}</span>
                      </div>
                      <button type="button" onClick={() => setImages(images.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-white text-red-500 w-6 h-6 rounded-full border border-gray-200 shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <i className="fa-solid fa-xmark text-xs"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-100">
              <button disabled={isSubmitting} type="submit" className={`w-full ${isSubmitting ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'} text-white font-bold py-3 px-4 rounded-xl shadow-md transition flex justify-center items-center gap-2`}>
                <i className={`fa-solid ${isSubmitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i> {isSubmitting ? 'กำลังส่งคำร้อง...' : 'ส่งคำร้อง'}
              </button>
            </div>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
