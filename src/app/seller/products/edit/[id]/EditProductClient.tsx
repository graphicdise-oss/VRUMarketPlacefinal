"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { productApi, categoryApi } from "@/lib/api";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { getErrorMessage } from "@/lib/utils";

export default function EditProductClient({ productId }: { productId: string }) {
  const router = useRouter();
  
  // States
  const [images, setImages] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [variants, setVariants] = useState([{ id: 0, name: "ขนาดปกติ", priceBaht: "", stock: "" }]);
  const [categories, setCategories] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    categoryApi.list().then(res => setCategories(res.items)).catch(console.error);
    // Fetch product details for editing
    // Note: The backend requires a specific endpoint or we use the public one, but since we are the seller, we'd ideally get it from listMine.
    // Assuming productApi.getPublicById works if it's published, or we can fetch listMine and find it.
    productApi.listMine().then(res => {
      const product = res.items.find(p => p.id === productId);
      if (product) {
        setName(product.name);
        setCategoryId(product.categoryId);
        setDescription(product.description);
        setVariants(product.variants.map((v, i) => ({
          id: i,
          name: v.name,
          priceBaht: (v.priceAmountMinor / 100).toString(),
          stock: v.stock.toString()
        })));
        
        // Set existing images from API response
        if (product.images && product.images.length > 0) {
          setExistingImages(product.images.map(img => 
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/products/${product.id}/images/${img.id}`
          ));
        } else {
          setExistingImages([]);
        }
      }
    }).catch(console.error);
  }, [productId]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      if (images.length + e.target.files.length > 10) {
        alert("อัปโหลดได้สูงสุด 10 รูปเท่านั้น");
        return;
      }
      setImages([...images, ...Array.from(e.target.files)]);
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const addVariant = () => {
    setVariants([...variants, { id: Date.now(), name: "", priceBaht: "", stock: "" }]);
  };

  const removeVariant = (id: number) => {
    if (variants.length === 1) return;
    setVariants(variants.filter(v => v.id !== id));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (images.length === 0 && existingImages.length === 0) {
      alert("กรุณาเพิ่มรูปภาพสินค้าอย่างน้อย 1 รูป");
      return;
    }

    setIsSubmitting(true);

    try {
      await productApi.update(productId, {
        name,
        description,
        categoryId,
        variants: variants.map(v => ({
          name: v.name,
          priceAmountMinor: Math.round(parseFloat(v.priceBaht) * 100),
          stock: parseInt(v.stock, 10)
        }))
      });

      // Images can be updated here if we have new files
      for (const file of images) {
        await productApi.addImage(productId, file);
      }

      alert("อัปเดตข้อมูลสินค้าเรียบร้อยแล้ว");
      router.push("/seller/products");
    } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล: " + getErrorMessage(error));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/seller/products" className="flex items-center gap-2 text-gray-600 hover:text-vru-blue transition font-bold">
            <i className="fa-solid fa-arrow-left"></i> กลับ
          </Link>
          <h1 className="text-xl font-bold text-gray-800">แก้ไขสินค้า</h1>
          <div className="w-20"></div>
        </div>
      </header>

      <main className="flex-grow max-w-4xl mx-auto w-full px-4 py-6">
        <Breadcrumb items={[
          { label: "Seller Center", href: "/seller" },
          { label: "จัดการสินค้า", href: "/seller/products" },
          { label: "แก้ไขสินค้า" }
        ]} />
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* GROUP A: Needs Approval if edited later */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-orange-50 border-b border-orange-100 p-4">
              <h2 className="font-bold text-orange-800 flex items-center gap-2">
                <i className="fa-solid fa-file-lines"></i> ข้อมูลพื้นฐาน <span className="bg-white px-2 py-0.5 rounded text-[10px] text-orange-600 border border-orange-200">ต้องรออนุมัติ</span>
              </h2>
              <p className="text-xs text-orange-700 mt-1">ส่วนนี้แอดมินชุมชนจะต้องเป็นคนตรวจสอบ หากอนาคตมีการแก้ไข สินค้าจะถูกดึงลงจากหน้าร้านชั่วคราว</p>
            </div>
            
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">รูปภาพสินค้า (สูงสุด 10 รูป, ไม่เกิน 10MB/รูป) *</label>
                <div className="flex flex-wrap gap-4 mt-4">
                  {existingImages.map((img, index) => (
                    <div key={`exist-${index}`} className="relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden group">
                      <img src={img} alt="Existing" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <button type="button" onClick={() => setExistingImages(existingImages.filter((_, i) => i !== index))} className="text-white bg-red-500 rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-600">
                          <i className="fa-solid fa-trash text-xs"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                  {images.map((img, index) => (
                    <div key={index} className="relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden group">
                      <img src={URL.createObjectURL(img)} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <button type="button" onClick={() => removeImage(index)} className="text-white bg-red-500 rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-600">
                          <i className="fa-solid fa-trash text-xs"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                  {(images.length + existingImages.length) < 10 && (
                    <div className="w-24 h-24 border-2 border-dashed border-vru-blue rounded-xl flex flex-col items-center justify-center text-vru-blue hover:bg-blue-50 transition cursor-pointer relative">
                      <input type="file" multiple accept="image/*" onChange={handleImageChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                      <i className="fa-solid fa-plus text-xl mb-1"></i>
                      <span className="text-xs font-bold">{images.length}/10</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อสินค้า *</label>
                <input 
                  type="text" 
                  required 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm" 
                  placeholder="เช่น น้ำพริกตาแดง สูตรคุณยาย" 
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">หมวดหมู่สินค้า *</label>
                <select 
                  required 
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm bg-white"
                >
                  <option value="">เลือกหมวดหมู่ส่วนกลาง...</option>
                  {categories.map((cat: {id: string, name: string}) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">* หมวดหมู่ถูกกำหนดโดยส่วนกลาง ร้านค้าไม่สามารถพิมพ์เองได้</p>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">รายละเอียดสินค้า *</label>
                <textarea 
                  required 
                  rows={5} 
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm" 
                  placeholder="อธิบายจุดเด่น ส่วนผสม หรือวิธีใช้งาน..."
                ></textarea>
              </div>
            </div>
          </div>

          {/* GROUP B: Instant Update */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-green-50 border-b border-green-100 p-4 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-green-800 flex items-center gap-2">
                  <i className="fa-solid fa-cubes"></i> ตัวเลือกสินค้า ราคา และสต็อก <span className="bg-white px-2 py-0.5 rounded text-[10px] text-green-600 border border-green-200">อัปเดตทันที</span>
                </h2>
                <p className="text-xs text-green-700 mt-1">แก้ไขส่วนนี้จะมีผลกับหน้าร้านทันทีโดยไม่ต้องรออนุมัติ</p>
              </div>
              <button type="button" onClick={addVariant} className="bg-white border border-green-500 text-green-600 hover:bg-green-100 font-bold py-1 px-3 rounded-lg text-sm transition">
                <i className="fa-solid fa-plus text-xs"></i> เพิ่มตัวเลือก
              </button>
            </div>
            
            <div className="p-6">
              <div className="hidden md:grid grid-cols-12 gap-4 mb-2 px-2 text-sm font-bold text-gray-600">
                <div className="col-span-5">ชื่อตัวเลือก (เช่น สี, ขนาด, รสชาติ) *</div>
                <div className="col-span-3">ราคา (บาท) *</div>
                <div className="col-span-3">จำนวนสต็อก *</div>
                <div className="col-span-1"></div>
              </div>

              <div className="space-y-4">
                {variants.map((v, index) => (
                  <div key={v.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-gray-50 md:bg-transparent p-4 md:p-0 rounded-xl border border-gray-200 md:border-none">
                    <div className="col-span-1 md:col-span-5">
                      <label className="block md:hidden text-xs font-bold text-gray-500 mb-1">ชื่อตัวเลือก</label>
                      <input 
                        type="text" 
                        required 
                        value={v.name}
                        onChange={(e) => {
                          const newV = [...variants];
                          newV[index].name = e.target.value;
                          setVariants(newV);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500 text-sm" 
                        placeholder="เช่น ขวดใหญ่ 500ml" 
                      />
                    </div>
                    <div className="col-span-1 md:col-span-3">
                      <label className="block md:hidden text-xs font-bold text-gray-500 mb-1">ราคา (บาท)</label>
                      <input 
                        type="number" 
                        min="0"
                        step="1"
                        required 
                        value={v.priceBaht}
                        onChange={(e) => {
                          const newV = [...variants];
                          newV[index].priceBaht = e.target.value;
                          setVariants(newV);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500 text-sm" 
                        placeholder="0" 
                      />
                    </div>
                    <div className="col-span-1 md:col-span-3">
                      <label className="block md:hidden text-xs font-bold text-gray-500 mb-1">สต็อก</label>
                      <input 
                        type="number" 
                        min="0"
                        step="1"
                        required 
                        value={v.stock}
                        onChange={(e) => {
                          const newV = [...variants];
                          newV[index].stock = e.target.value;
                          setVariants(newV);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-green-500 focus:border-green-500 text-sm" 
                        placeholder="0" 
                      />
                    </div>
                    <div className="col-span-1 text-right md:text-center mt-2 md:mt-0">
                      <button 
                        type="button" 
                        onClick={() => removeVariant(v.id)}
                        disabled={variants.length === 1}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition ${variants.length === 1 ? "text-gray-300 bg-gray-100 cursor-not-allowed" : "text-red-500 bg-red-50 hover:bg-red-500 hover:text-white"}`}
                      >
                        <i className="fa-solid fa-trash-can text-sm"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Important Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-start gap-3 mt-4">
            <i className="fa-solid fa-triangle-exclamation text-yellow-600 text-xl mt-0.5"></i>
            <div>
              <h4 className="font-bold text-yellow-800 text-sm mb-1">สถานะสินค้าจะเปลี่ยนเป็น &quot;รออนุมัติ&quot;</h4>
              <p className="text-xs text-yellow-700">หลังจากการแก้ไขข้อมูลในหน้านี้เสร็จสิ้น สินค้าของคุณจะถูกตรวจสอบโดยผู้ดูแลระบบและถูกซ่อนจากหน้าร้านจนกว่าจะได้รับอนุมัติ</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-gray-100 mt-6">
            <Link href="/seller/products" className="px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition border border-gray-200">
              ยกเลิก
            </Link>
            <button 
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 rounded-xl font-bold text-white bg-vru-blue hover:bg-blue-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <><i className="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...</>
              ) : (
                <><i className="fa-solid fa-floppy-disk"></i> บันทึกการแก้ไข</>
              )}
            </button>
          </div>

        </form>
      </main>
    </div>
  );
}
