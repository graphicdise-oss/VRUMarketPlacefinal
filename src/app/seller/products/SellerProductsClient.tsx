"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Product } from "@/types";

import Breadcrumb from "@/components/ui/Breadcrumb";
import { productApi } from "@/lib/api";
import { mapProductDto } from "@/lib/product-mapper";
import { FadeIn, StaggeredGrid } from "@/components/ui/Animations";

export default function SellerProductsClient() {
  const [activeTab, setActiveTab] = useState<"ALL" | "APPROVED" | "PENDING_APPROVAL" | "HIDDEN">("ALL");
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingVariants, setEditingVariants] = useState<{ id: string; name: string; priceMinor: number; stock: number }[]>([]);

  const fetchSellerProducts = async () => {
    setIsLoading(true);
    try {
      const response = await productApi.listMine();
      setProducts(response.items.map(mapProductDto));
    } catch (error) {
      console.error("Failed to fetch seller products:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSellerProducts();
  }, []);

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setEditingVariants(JSON.parse(JSON.stringify(product.variants))); // deep copy
  };

  const handleVariantChange = (index: number, field: "priceMinor" | "stock", value: string) => {
    const val = parseInt(value, 10);
    if (isNaN(val) || val < 0) return;
    
    setEditingVariants(prev => {
      const newVars = [...prev];
      newVars[index] = { ...newVars[index], [field]: val };
      return newVars;
    });
  };

  const handleSaveStock = () => {
    if (!editingProduct) return;
    
    setProducts(prev => prev.map(p => {
      if (p.id === editingProduct.id) {
        return { ...p, variants: editingVariants };
      }
      return p;
    }));
    
    setEditingProduct(null);
  };

  const [requestActionModal, setRequestActionModal] = useState<{ type: "PAUSE" | "DELETE", productId: string } | null>(null);
  const [actionReason, setActionReason] = useState("");

  const handleTogglePause = (id: string, currentStatus?: string) => {
    if (currentStatus === "HIDDEN") {
      if (confirm("คุณต้องการเปิดขายสินค้านี้อีกครั้งใช่หรือไม่?")) {
        setProducts(prev => prev.map(p => p.id === id ? { ...p, status: "APPROVED" } : p));
      }
    } else {
      setRequestActionModal({ type: "PAUSE", productId: id });
      setActionReason("");
    }
  };

  const handleDeleteProduct = (id: string) => {
    setRequestActionModal({ type: "DELETE", productId: id });
    setActionReason("");
  };

  const handleSubmitRequestAction = () => {
    if (!requestActionModal || !actionReason.trim()) {
      alert("กรุณาระบุเหตุผล");
      return;
    }
    
    setProducts(prev => prev.map(p => {
      if (p.id === requestActionModal.productId) {
        return { 
          ...p, 
          status: "PENDING_APPROVAL", 
          pendingAction: requestActionModal.type,
          pendingReason: actionReason
        };
      }
      return p;
    }));
    
    alert(`ส่งคำขอ${requestActionModal.type === "PAUSE" ? "หยุดขาย" : "ลบสินค้า"}ไปยังแอดมินเรียบร้อยแล้ว`);
    setRequestActionModal(null);
  };

  const filtered = activeTab === "ALL" ? products : products.filter(p => {
    if (activeTab === "APPROVED") return p.moderationStatus === "APPROVED" && p.publishStatus === "PUBLISHED";
    if (activeTab === "PENDING_APPROVAL") return p.moderationStatus === "PENDING";
    if (activeTab === "HIDDEN") return p.moderationStatus === "REJECTED" || p.publishStatus === "UNPUBLISHED";
    return true;
  });
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/seller" className="flex items-center gap-2 text-gray-600 hover:text-vru-blue transition font-bold">
            <i className="fa-solid fa-arrow-left"></i> กลับ
          </Link>
          <h1 className="text-xl font-bold text-gray-800">จัดการสินค้า</h1>
          <Link href="/seller/products/new" className="bg-vru-blue hover:bg-blue-600 text-white font-bold py-1.5 px-3 rounded-lg text-sm shadow-sm transition flex items-center gap-1">
            <i className="fa-solid fa-plus"></i> เพิ่มสินค้า
          </Link>
        </div>
      </header>

      <main className="flex-grow max-w-5xl mx-auto w-full px-4 py-6">
        <Breadcrumb items={[
          { label: "Seller Center", href: "/seller" },
          { label: "จัดการสินค้า" }
        ]} />
        {/* Important Warning */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <i className="fa-solid fa-triangle-exclamation text-yellow-600 text-xl mt-0.5"></i>
          <div>
            <h4 className="font-bold text-yellow-800 text-sm mb-1">สิ่งสำคัญที่ต้องรู้ก่อนแก้ไขสินค้า</h4>
            <p className="text-xs text-yellow-700">การแก้ไข ชื่อสินค้า, รูปภาพ, รายละเอียด, และ หมวดหมู่ จะทำให้สถานะสินค้าเปลี่ยนเป็น &quot;รออนุมัติ&quot; และถูกซ่อนจากหน้าร้านชั่วคราว หากต้องการแก้แค่ <b>ราคาและสต็อก</b> ให้คลิกที่ <b>จัดการสต็อก</b> ระบบจะบันทึกทันทีโดยไม่ต้องรออนุมัติ</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-6 pb-2">
          {[
            { id: "ALL", label: "ทั้งหมด" },
            { id: "APPROVED", label: "ขายอยู่" },
            { id: "PENDING_APPROVAL", label: "รออนุมัติ" },
            { id: "HIDDEN", label: "ถูกซ่อน/แบน" }
          ].map(tab => (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition ${activeTab === tab.id ? "bg-vru-blue text-white shadow-sm" : "bg-white text-gray-600 border border-gray-200 hover:border-vru-blue"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Product List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 p-4 bg-gray-50 border-b border-gray-100 font-bold text-sm text-gray-600">
            <div className="col-span-4">สินค้า</div>
            <div className="col-span-2 text-right">สต็อกรวม</div>
            <div className="col-span-2 text-center">สถานะ</div>
            <div className="col-span-4 text-right">จัดการ</div>
          </div>
          
          <div className="divide-y divide-gray-100">
            {isLoading ? (
              <div className="divide-y divide-gray-100">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center animate-pulse">
                    <div className="col-span-1 md:col-span-4 flex gap-4">
                      <div className="w-16 h-16 bg-gray-200 rounded-lg flex-shrink-0"></div>
                      <div className="flex-1 py-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                        <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                      </div>
                    </div>
                    <div className="hidden md:block col-span-2 text-right">
                      <div className="h-4 bg-gray-200 rounded w-8 ml-auto"></div>
                    </div>
                    <div className="col-span-1 md:col-span-2 flex justify-center">
                      <div className="h-6 bg-gray-200 rounded-md w-16"></div>
                    </div>
                    <div className="col-span-1 md:col-span-4 flex justify-end gap-1.5">
                      <div className="h-8 bg-gray-200 rounded-lg w-16"></div>
                      <div className="h-8 bg-gray-200 rounded-lg w-16"></div>
                      <div className="h-8 bg-gray-200 rounded-lg w-8"></div>
                      <div className="h-8 bg-gray-200 rounded-lg w-8"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <i className="fa-solid fa-box-open text-4xl mb-3"></i>
                <p>ไม่มีสินค้าในหมวดนี้</p>
              </div>
            ) : (
              <StaggeredGrid className="divide-y divide-gray-100" staggerDelay={0.05}>
                {filtered.map(product => {
                  const totalStock = product.variants.reduce((sum: number, v) => sum + v.stock, 0);
                  return (
                    <FadeIn key={product.id} direction="up">
                      <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center hover:bg-gray-50/80 transition-colors">
                        <div className="col-span-1 md:col-span-4 flex gap-4">
                          <img src={product.images[0]} alt={product.name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0 border border-gray-100 bg-white" />
                          <div className="min-w-0">
                            <h4 className="font-bold text-gray-800 text-sm line-clamp-1 group-hover:text-vru-blue transition-colors">{product.name}</h4>
                            <p className="text-xs text-gray-500 my-0.5">{product.variants.length} ตัวเลือก</p>
                            <p className="text-xs text-gray-400">ขายแล้ว {product.soldCount} ชิ้น</p>
                          </div>
                        </div>
                        
                        <div className="hidden md:block col-span-2 text-right">
                          <span className={`font-bold ${totalStock > 0 ? "text-gray-800" : "text-red-500"}`}>{totalStock}</span>
                        </div>

                        <div className="col-span-1 md:col-span-2 flex justify-between md:justify-center items-center flex-col md:flex-row gap-1">
                          <span className="md:hidden text-xs text-gray-500">สถานะ: </span>
                          {product.status === "APPROVED" && <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2.5 py-1 rounded-md">ปกติ (ขายอยู่)</span>}
                          {product.status === "PENDING_APPROVAL" && !(product as Product & { pendingAction?: string }).pendingAction && <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-2.5 py-1 rounded-md">รอแอดมินอนุมัติ</span>}
                          {product.status === "PENDING_APPROVAL" && (product as Product & { pendingAction?: string }).pendingAction === "PAUSE" && <span className="bg-orange-100 text-orange-700 text-[10px] font-bold px-2.5 py-1 rounded-md">รออนุมัติหยุดขาย</span>}
                          {product.status === "PENDING_APPROVAL" && (product as Product & { pendingAction?: string }).pendingAction === "DELETE" && <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2.5 py-1 rounded-md">รออนุมัติลบ</span>}
                          {product.status === "HIDDEN" && <span className="bg-red-100 text-red-700 text-[10px] font-bold px-2.5 py-1 rounded-md">ถูกซ่อน/แบน</span>}
                        </div>

                        <div className="col-span-1 md:col-span-4 flex flex-wrap justify-end gap-1.5 border-t md:border-t-0 pt-3 md:pt-0 mt-2 md:mt-0">
                          <button onClick={() => openEditModal(product)} title="จัดการสต็อก/ราคา" className="bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 hover:shadow-sm font-bold py-1.5 px-2.5 rounded-lg text-xs transition-all flex items-center justify-center active:scale-95">
                            <i className="fa-solid fa-boxes-stacked md:mr-1"></i> <span className="hidden md:inline">สต็อก</span>
                          </button>
                          <Link href={`/seller/products/edit/${product.id}`} title="แก้ไขทั้งหมด" className="bg-white border border-gray-200 hover:bg-gray-100 hover:shadow-sm text-gray-700 font-bold py-1.5 px-2.5 rounded-lg text-xs transition-all flex items-center justify-center active:scale-95">
                            <i className="fa-solid fa-pen md:mr-1"></i> <span className="hidden md:inline">แก้ไข</span>
                          </Link>
                          <button onClick={() => handleTogglePause(product.id, product.status)} title={product.status === "HIDDEN" ? "เปิดขาย" : "หยุดขายชั่วคราว"} className="bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 hover:shadow-sm font-bold py-1.5 px-2.5 rounded-lg text-xs transition-all flex items-center justify-center active:scale-95">
                            <i className={`fa-solid ${product.status === "HIDDEN" ? "fa-play" : "fa-pause"}`}></i>
                          </button>
                          <button onClick={() => handleDeleteProduct(product.id)} title="ลบสินค้า" className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:shadow-sm font-bold py-1.5 px-2.5 rounded-lg text-xs transition-all flex items-center justify-center active:scale-95">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    </FadeIn>
                  )
                })}
              </StaggeredGrid>
            )}
          </div>
        </div>
      </main>

      {/* Stock Edit Modal */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
              <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                <i className="fa-solid fa-boxes-stacked text-vru-blue"></i> จัดการสต็อกและราคา
              </h2>
              <button onClick={() => setEditingProduct(null)} className="text-gray-400 hover:text-gray-800 transition">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto">
              <div className="flex gap-4 mb-6 pb-5 border-b border-gray-100 items-center">
                <img src={editingProduct.images[0]} alt={editingProduct.name} className="w-14 h-14 object-cover rounded-lg border border-gray-100 bg-white" />
                <div>
                  <h3 className="font-bold text-gray-800">{editingProduct.name}</h3>
                  <p className="text-xs text-green-600 font-bold mt-1">
                    <i className="fa-solid fa-circle-check"></i> แก้ไขข้อมูลส่วนนี้ไม่ต้องรออนุมัติใหม่
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-2 text-xs font-bold text-gray-500 px-1">
                  <div className="col-span-4">ตัวเลือกสินค้า</div>
                  <div className="col-span-4">ราคา (บาท)</div>
                  <div className="col-span-4">จำนวนสต็อก</div>
                </div>
                
                {editingVariants.map((variant, index) => (
                  <div key={variant.id} className="grid grid-cols-12 gap-3 items-center bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div className="col-span-4">
                      <span className="font-bold text-sm text-gray-700 line-clamp-2">{variant.name}</span>
                    </div>
                    <div className="col-span-4">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                        <input 
                          type="number" 
                          min="0"
                          value={variant.priceMinor / 100}
                          onChange={(e) => handleVariantChange(index, "priceMinor", String(Number(e.target.value) * 100))}
                          className="w-full border border-gray-200 rounded-lg py-2 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-vru-blue/20 focus:border-vru-blue bg-white font-bold"
                        />
                      </div>
                    </div>
                    <div className="col-span-4">
                      <input 
                        type="number" 
                        min="0"
                        value={variant.stock}
                        onChange={(e) => handleVariantChange(index, "stock", e.target.value)}
                        className="w-full border border-gray-200 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-vru-blue/20 focus:border-vru-blue bg-white font-bold text-center"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3">
              <button 
                onClick={() => setEditingProduct(null)}
                className="px-5 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition text-sm"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleSaveStock}
                className="px-5 py-2 font-bold text-white bg-vru-blue hover:bg-blue-600 shadow-md rounded-xl transition flex items-center gap-2 text-sm"
              >
                <i className="fa-solid fa-floppy-disk"></i> บันทึกการเปลี่ยนแปลง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Action Modal */}
      {requestActionModal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className={`p-5 border-b border-gray-100 flex justify-between items-center ${requestActionModal.type === "DELETE" ? "bg-red-50/80" : "bg-orange-50/80"}`}>
              <h2 className={`font-bold text-lg flex items-center gap-2 ${requestActionModal.type === "DELETE" ? "text-red-700" : "text-orange-700"}`}>
                <i className={`fa-solid ${requestActionModal.type === "DELETE" ? "fa-trash" : "fa-pause"}`}></i> 
                ขออนุมัติ{requestActionModal.type === "DELETE" ? "ลบสินค้า" : "หยุดขายชั่วคราว"}
              </h2>
              <button onClick={() => setRequestActionModal(null)} className="text-gray-400 hover:text-gray-800 transition">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>
            
            <div className="p-5">
              <label className="block text-sm font-bold text-gray-700 mb-2">สาเหตุที่ต้องการ{requestActionModal.type === "DELETE" ? "ลบ" : "หยุดขาย"} *</label>
              <textarea 
                rows={4}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder={`ระบุสาเหตุที่ต้องการ${requestActionModal.type === "DELETE" ? "ลบสินค้า" : "หยุดขาย"}...`}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-vru-blue/20 focus:border-vru-blue"
              ></textarea>
              <p className="text-xs text-gray-500 mt-2">
                <i className="fa-solid fa-circle-info mr-1"></i> คำขอของคุณจะถูกส่งให้แอดมินพิจารณา 
              </p>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button 
                onClick={() => setRequestActionModal(null)}
                className="px-5 py-2 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition text-sm"
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleSubmitRequestAction}
                className={`px-5 py-2 font-bold text-white shadow-md rounded-xl transition flex items-center gap-2 text-sm ${requestActionModal.type === "DELETE" ? "bg-red-600 hover:bg-red-700" : "bg-orange-500 hover:bg-orange-600"}`}
              >
                <i className="fa-solid fa-paper-plane"></i> ส่งคำขออนุมัติ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
