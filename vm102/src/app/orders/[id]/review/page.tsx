"use client";

import { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { reviewApi } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/utils";

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      if (selectedFiles.length + filesArray.length > 5) {
        showToast("คุณสามารถอัปโหลดรูปภาพได้สูงสุด 5 รูป", "error");
        return;
      }
      setSelectedFiles((prev) => [...prev, ...filesArray]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      // 1. Create the text review
      await reviewApi.create(id, { rating, text: comment });

      // 2. Upload images if any
      for (const file of selectedFiles) {
        await reviewApi.addImage(id, file);
      }

      showToast("ส่งรีวิวเรียบร้อยแล้ว ขอบคุณสำหรับความคิดเห็น!");
      router.push(`/orders/${id}`);
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "เกิดข้อผิดพลาดในการส่งรีวิว อาจรีวิวไปแล้ว"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-2xl mx-auto w-full px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/orders/${id}`} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-500 hover:text-green-500 hover:border-green-500 transition shadow-sm">
            <i className="fa-solid fa-arrow-left"></i>
          </Link>
          <h2 className="text-xl font-bold text-gray-800">เขียนรีวิวสินค้า</h2>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <div className="w-20 h-20 mx-auto bg-green-50 rounded-full flex items-center justify-center mb-4">
            <i className="fa-solid fa-star text-4xl text-green-500"></i>
          </div>
          <h3 className="font-bold text-gray-800 text-lg mb-1">คุณประทับใจสินค้าและบริการแค่ไหน?</h3>
          <p className="text-sm text-gray-500 mb-6">คำสั่งซื้อ #{id.split('-')[0]}</p>

          <form onSubmit={handleSubmit} className="max-w-md mx-auto">
            {/* Star Rating */}
            <div className="flex justify-center gap-2 mb-6 cursor-pointer" onMouseLeave={() => setHoverRating(0)}>
              {[1, 2, 3, 4, 5].map((star) => (
                <i 
                  key={star}
                  className={`fa-solid fa-star text-4xl transition-colors ${star <= (hoverRating || rating) ? "text-yellow-400" : "text-gray-200"}`}
                  onMouseEnter={() => setHoverRating(star)}
                  onClick={() => setRating(star)}
                ></i>
              ))}
            </div>

            <div className="mb-6 text-left">
              <label className="block text-sm font-bold text-gray-700 mb-2">แบ่งปันประสบการณ์ของคุณ</label>
              <textarea 
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-green-500 focus:border-green-500 text-sm outline-none resize-none"
                placeholder="สินค้าคุณภาพดีไหม? จัดส่งรวดเร็วหรือเปล่า? บอกให้ผู้ซื้อคนอื่นรู้..."
              ></textarea>
            </div>

            {/* Photo Upload */}
            <div className="mb-6 text-left">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                เพิ่มรูปภาพ (สูงสุด 5 รูป)
              </label>
              <div className="flex flex-wrap gap-3">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="relative w-20 h-20 border border-gray-200 rounded-xl overflow-hidden group">
                    <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeFile(idx)} className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                  </div>
                ))}
                
                {selectedFiles.length < 5 && (
                  <label className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-green-500 hover:text-green-500 cursor-pointer transition-colors bg-gray-50">
                    <i className="fa-solid fa-camera text-xl mb-1"></i>
                    <span className="text-[10px] font-bold">เพิ่มรูป</span>
                    <input type="file" multiple accept="image/jpeg,image/png" className="hidden" onChange={handleFileChange} />
                  </label>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-400 text-left mb-6">
              <i className="fa-solid fa-circle-info mr-1"></i> รีวิวสามารถแก้ไขได้ภายใน 7 วัน หลังจากนั้นจะถูกล็อค และไม่สามารถลบเองได้
            </div>

            <button type="submit" disabled={isSubmitting} className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl shadow-md transition flex items-center justify-center gap-2">
              {isSubmitting ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
              ส่งรีวิว
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
