"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Order } from "@/types";
import { formatPrice, getOrderStatusLabel, getOrderStatusColor, formatCountdown } from "@/lib/utils";
import Breadcrumb from "@/components/ui/Breadcrumb";

// Removed mock data
import { sellerOrderApi, shippingCarrierApi, buyerOrderApi } from "@/lib/api";
import { shopDisputeApi } from "@/lib/api-modules/dispute";
import type { ShippingCarrierDto } from "@/lib/api-modules/order";
import type { DisputeDto } from "@/lib/api-modules/dispute";
import { mapOrderDto } from "@/lib/order-mapper";
import { getProductFallbackImage } from "@/lib/product-mapper";

export default function SellerOrderDetailClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [shippingCostInput, setShippingCostInput] = useState("");
  const [shippingProvider, setShippingProvider] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carriers, setCarriers] = useState<ShippingCarrierDto[]>([]);
  const [currentSlipId, setCurrentSlipId] = useState("");
  const [disputes, setDisputes] = useState<DisputeDto[]>([]);
  const [respondReason, setRespondReason] = useState("");
  const [respondImages, setRespondImages] = useState<File[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [shippingSlipFile, setShippingSlipFile] = useState<File | null>(null);
  const [shippingSlipPreview, setShippingSlipPreview] = useState<string | null>(null);
  const [isSubmittingShip, setIsSubmittingShip] = useState(false);
  const [isUploadingAdditionalSlip, setIsUploadingAdditionalSlip] = useState(false);
  const shippingSlipInputRef = useRef<HTMLInputElement>(null);
  const additionalSlipInputRef = useRef<HTMLInputElement>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const o = await sellerOrderApi.getById(orderId);
      const apiOrder: Order = mapOrderDto(o);
      setOrder(apiOrder);

      if (o.displayStatus === "PAYMENT_SUBMITTED" || o.displayStatus === "PAID" || o.displayStatus === "SHIPPED" || o.displayStatus === "COMPLETED") {
        buyerOrderApi.getSlips(orderId).then(res => {
          if (res && res.length > 0) {
            const slip = res[res.length - 1] || res[0]; 
            setCurrentSlipId(slip.id);
            const slipUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/orders/${orderId}/payment-slips/${slip.id}/file`;
            setOrder(prev => prev ? { ...prev, slipImageUrl: slipUrl } : prev);
          }
        }).catch(console.error);

        sellerOrderApi.getShippingSlips(orderId).then(res => {
          if (res && res.length > 0) {
            const slip = res[res.length - 1] || res[0];
            const slipUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/orders/${orderId}/shipping-slips/${slip.id}/file`;
            setOrder(prev => prev ? { ...prev, shippingSlipUrl: slipUrl } : prev);
          }
        }).catch(console.error);
      }

      try {
        const disputeList = await shopDisputeApi.list(orderId);
        setDisputes(disputeList);
      } catch (err) {
        console.error("Failed to fetch disputes", err);
      }
    } catch (err) {
      console.error("Failed to fetch order", err);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
    shippingCarrierApi.list().then(res => {
      setCarriers(res.items || []);
      if (res.items && res.items.length > 0) {
        setShippingProvider(res.items[0].id);
      }
    }).catch(console.error);
  }, [fetchOrder]);

  const handleQuoteShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shippingCostInput || !order) return;
    const costBaht = parseFloat(shippingCostInput);
    if (isNaN(costBaht) || costBaht < 0) {
      alert("กรุณากรอกค่าจัดส่งให้ถูกต้อง");
      return;
    }
    const costMinor = Math.round(costBaht * 100);
    try {
      await sellerOrderApi.setShippingFee(orderId, costMinor);
      alert(`แจ้งค่าจัดส่ง ${costBaht} บาท สำเร็จ`);
      fetchOrder();
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการแจ้งค่าส่ง");
    }
  };

  const handleConfirmPayment = async () => {
    if (order && confirm("ยืนยันว่าคุณตรวจสอบสลิปและได้รับยอดเงินถูกต้องแล้ว? (หากยืนยันผิดพลาดระบบจะไม่รับผิดชอบ)")) {
      try {
        await sellerOrderApi.confirmPayment(orderId);
        alert("อนุมัติสลิปสำเร็จ ตัดสต๊อกสินค้าแล้ว");
        fetchOrder();
      } catch (err) {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการอนุมัติสลิป");
      }
    }
  };

  const handleShipOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingNumber || !order) return;
    setIsSubmittingShip(true);
    try {
      await sellerOrderApi.shipOrder(orderId, shippingProvider, trackingNumber);
      if (shippingSlipFile) {
        await sellerOrderApi.uploadShippingSlip(orderId, shippingSlipFile);
      }
      alert(`อัปเดตสถานะจัดส่งและบันทึกข้อมูลเรียบร้อยแล้ว`);
      setShippingSlipFile(null);
      setShippingSlipPreview(null);
      fetchOrder();
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการจัดส่ง");
    } finally {
      setIsSubmittingShip(false);
    }
  };

  const handleUploadAdditionalSlip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAdditionalSlip(true);
    try {
      await sellerOrderApi.uploadShippingSlip(orderId, file);
      alert("แนบรูปสลิป/ใบเสร็จส่งพัสดุสำเร็จ");
      fetchOrder();
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการอัปโหลดรูปสลิปส่งของ");
    } finally {
      setIsUploadingAdditionalSlip(false);
      if (additionalSlipInputRef.current) additionalSlipInputRef.current.value = "";
    }
  };

  const handleRespondDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (respondReason.length < 10) {
      alert("กรุณาระบุคำชี้แจงอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setIsResponding(true);
    try {
      const formData = new FormData();
      formData.append("response", respondReason);
      respondImages.forEach(img => formData.append("files", img));
      
      await shopDisputeApi.respond(orderId, formData);
      alert("ส่งคำชี้แจงข้อพิพาทเรียบร้อยแล้ว");
      fetchOrder();
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการส่งคำชี้แจง");
    } finally {
      setIsResponding(false);
    }
  };

  if (!order) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><i className="fa-solid fa-spinner fa-spin text-4xl text-vru-blue"></i></div>;

  const itemsTotal = order.items.reduce((sum, i) => sum + (i.priceAtPurchaseMinor * i.qty), 0);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/seller/orders" className="flex items-center gap-2 text-gray-600 hover:text-vru-blue transition font-bold">
            <i className="fa-solid fa-arrow-left"></i> กลับ
          </Link>
          <h1 className="text-xl font-bold text-gray-800">จัดการคำสั่งซื้อ #{order.id}</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto w-full px-4 pt-6 pb-2">
        <Breadcrumb items={[
          { label: "Seller Center", href: "/seller" },
          { label: "จัดการคำสั่งซื้อ", href: "/seller/orders" },
          { label: `คำสั่งซื้อ #${order.id}` }
        ]} />
      </div>
      <main className="flex-grow max-w-4xl mx-auto w-full px-4 pb-6 flex flex-col md:flex-row gap-6">
        
        {/* Left Column: Action Box */}
        <div className="md:w-2/3 flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-700">สถานะปัจจุบัน</span>
              <span className={`px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${getOrderStatusColor(order.status)}`}>
                {getOrderStatusLabel(order.status)}
              </span>
            </div>

            <div className="p-6">
              {/* DISPUTE STATUS */}
              {disputes && disputes.length > 0 && (
                <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-2xl p-5 shadow-sm">
                  <h3 className="text-lg font-bold text-red-600 mb-2 flex items-center gap-2">
                    <i className="fa-solid fa-gavel"></i> ผู้ซื้อได้เปิดข้อพิพาทสำหรับคำสั่งซื้อนี้
                  </h3>
                  <p className="text-sm text-red-700 font-medium mb-4">
                    เหตุผลจากผู้ซื้อ: <span className="font-bold">{disputes[0].reason}</span>
                  </p>
                  
                  {disputes[0].verdict ? (
                    <div className="bg-white p-3 rounded-xl border border-red-100">
                      <span className="font-bold text-gray-800 text-sm">ผลการตัดสิน: </span>
                      <span className={`text-sm font-bold ${disputes[0].verdict === 'SHOP_WINS' ? 'text-green-600' : 'text-red-600'}`}>
                        {disputes[0].verdict === 'SHOP_WINS' ? 'ร้านค้าชนะ (คำสั่งซื้อดำเนินต่อ)' : 'ผู้ซื้อชนะ (ผู้ซื้อได้รับเงินคืน)'}
                      </span>
                      {disputes[0].rulingReason && <p className="text-sm text-gray-600 mt-1">เหตุผล: {disputes[0].rulingReason}</p>}
                    </div>
                  ) : disputes[0].shopResponse ? (
                    <div className="bg-white p-3 rounded-xl border border-red-100">
                      <span className="font-bold text-gray-800 text-sm">คุณได้ชี้แจงแล้ว: </span>
                      <p className="text-sm text-gray-600 mt-1">{disputes[0].shopResponse}</p>
                      <p className="text-xs text-orange-500 font-bold mt-2"><i className="fa-solid fa-clock"></i> กำลังรอแอดมินชุมชนตัดสิน...</p>
                    </div>
                  ) : (
                    <form onSubmit={handleRespondDispute} className="bg-white p-4 rounded-xl border border-red-100 mt-4">
                      <h4 className="font-bold text-gray-800 text-sm mb-3">คำชี้แจงจากฝั่งร้านค้า</h4>
                      <textarea
                        required
                        value={respondReason}
                        onChange={(e) => setRespondReason(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:ring-vru-blue focus:border-vru-blue mb-3 outline-none"
                        rows={3}
                        placeholder="ระบุคำชี้แจงของคุณเพื่อประกอบการพิจารณา (อย่างน้อย 10 ตัวอักษร)*"
                      ></textarea>
                      <div className="mb-3">
                        <label className="block text-xs font-bold text-gray-600 mb-1">แนบรูปภาพหลักฐาน (เลือกได้หลายรูป)</label>
                        <input 
                          type="file" 
                          multiple 
                          accept="image/*"
                          onChange={(e) => setRespondImages(e.target.files ? Array.from(e.target.files) : [])}
                          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-vru-blue hover:file:bg-blue-100" 
                        />
                      </div>
                      <button 
                        type="submit" 
                        disabled={isResponding}
                        className="bg-vru-blue hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-full text-sm transition-all shadow-sm w-full sm:w-auto"
                      >
                        {isResponding ? "กำลังส่ง..." : "ส่งคำชี้แจงข้อพิพาท"}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* ACTION: AWAITING_SHIPPING_QUOTE */}
              {order.status === "AWAITING_SHIPPING_QUOTE" && (
                <form onSubmit={handleQuoteShipping} className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                  <h3 className="font-bold text-blue-800 mb-2"><i className="fa-solid fa-truck-fast mr-2"></i> ระบุค่าจัดส่ง</h3>
                  <p className="text-sm text-blue-700 mb-4">ผู้ซื้อทำการสั่งซื้อแล้ว กรุณาคำนวณและระบุค่าจัดส่ง เพื่อให้ผู้ซื้อชำระเงิน</p>
                  
                  <div className="flex gap-3 mb-3">
                    <div className="flex-grow">
                      <div className="relative">
                        <input 
                          type="number" 
                          min="0"
                          step="1"
                          required
                          value={shippingCostInput}
                          onChange={(e) => setShippingCostInput(e.target.value)}
                          className="w-full pl-4 pr-12 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-lg font-bold" 
                          placeholder="0"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">บาท</span>
                      </div>
                    </div>
                    <button type="submit" className="bg-vru-blue hover:bg-blue-600 text-white font-bold px-6 rounded-xl transition shadow-md whitespace-nowrap">
                      ส่งให้ผู้ซื้อ
                    </button>
                  </div>
                  {order.shippingQuoteDeadline && <p className="text-xs text-red-500 font-bold">หมดเวลาใน: {formatCountdown(order.shippingQuoteDeadline)}</p>}
                </form>
              )}

              {/* ACTION: AWAITING_PAYMENT */}
              {order.status === "AWAITING_PAYMENT" && (
                <div className="text-center py-6">
                  <i className="fa-solid fa-hourglass-half text-4xl text-gray-300 mb-4 animate-pulse"></i>
                  <h3 className="font-bold text-gray-800 mb-1">รอผู้ซื้อชำระเงิน</h3>
                  <p className="text-sm text-gray-500">คุณได้แจ้งค่าจัดส่งไปแล้ว กรุณารอผู้ซื้อโอนเงินและอัปโหลดสลิป</p>
                </div>
              )}

              {/* ACTION: PAYMENT_SUBMITTED */}
              {order.status === "PAYMENT_SUBMITTED" && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                  <h3 className="font-bold text-orange-800 mb-2"><i className="fa-solid fa-money-check-dollar mr-2"></i> ตรวจสอบสลิปโอนเงิน</h3>
                  <p className="text-sm text-orange-700 mb-4">ผู้ซื้ออัปโหลดสลิปแล้ว กรุณาตรวจสอบยอดเงินเข้าบัญชีของคุณ (ยอดที่ต้องเข้า: {formatPrice(order.totalAmountMinor || 0)})</p>
                  
                  <div className="bg-white border border-gray-200 rounded-lg p-2 mb-4 max-w-md mx-auto cursor-pointer hover:shadow-md transition" onClick={() => window.open(order.slipImageUrl || "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&q=80", '_blank')}>
                    <img src={order.slipImageUrl || "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&q=80"} alt="Slip" className="w-full rounded max-h-80 object-contain mx-auto" />
                    <p className="text-center text-xs text-gray-500 mt-2 font-bold"><i className="fa-solid fa-magnifying-glass-plus"></i> กดเพื่อขยายรูปภาพ</p>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-xs text-yellow-800 mb-4">
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i> ระบบไม่ได้ทำการตรวจสอบสลิปให้ ร้านค้าต้องตรวจสอบด้วยตัวเองก่อนกดยืนยัน
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button onClick={handleConfirmPayment} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl transition shadow-sm">
                      <i className="fa-solid fa-check-circle mr-2"></i> อนุมัติสลิป
                    </button>
                    <button onClick={async () => {
                      if (order) {
                        const reason = window.prompt("ระบุเหตุผลที่ปฏิเสธสลิป (บังคับ):");
                        if (!reason) return;
                        try {
                          await sellerOrderApi.rejectSlip(orderId, currentSlipId, reason);
                          alert("ปฏิเสธสลิปสำเร็จ ระบบจะแจ้งให้ลูกค้าอัปโหลดเข้ามาใหม่");
                          fetchOrder();
                        } catch(err) {
                          console.error(err);
                          alert("เกิดข้อผิดพลาด หรืออาจปฏิเสธสลิปครบกำหนดแล้ว");
                        }
                      }
                    }} className="flex-1 bg-white border border-red-200 text-red-500 hover:bg-red-50 font-bold py-3 rounded-xl transition shadow-sm">
                      <i className="fa-solid fa-xmark mr-2"></i> สลิปไม่ถูกต้อง
                    </button>
                  </div>
                </div>
              )}

              {/* ACTION: PAID */}
              {order.status === "PAID" && (
                <form onSubmit={handleShipOrder} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
                  <h3 className="font-bold text-indigo-800 mb-2"><i className="fa-solid fa-box-open mr-2"></i> อัปเดตข้อมูลการจัดส่ง</h3>
                  <p className="text-sm text-indigo-700 mb-4">ยืนยันยอดเงินแล้ว กรุณาแพ็คสินค้า จัดส่ง และแนบหลักฐานด้านล่าง</p>
                  
                  <div className="space-y-4 mb-5">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">บริษัทขนส่ง</label>
                      <select 
                        value={shippingProvider}
                        onChange={(e) => setShippingProvider(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                      >
                        {carriers.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">เลขพัสดุ (Tracking Number)</label>
                      <input 
                        type="text" 
                        required
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono"
                        placeholder="เช่น TH123456789 หรือเลขจากใบเสร็จไปรษณีย์"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">
                        <i className="fa-solid fa-camera mr-1 text-indigo-600"></i> ถ่ายรูป/แนบรูปใบเสร็จ หรือสลิปใบส่งของจากไปรษณีย์/ขนส่ง
                      </label>
                      <p className="text-xs text-gray-500 mb-2">ถ่ายรูปกระดาษใบเสร็จ/สลิปของขนส่งที่มีชื่อและเลขพัสดุชัดเจน เพื่อให้ผู้ซื้อใช้เป็นหลักฐานติดตาม</p>

                      <input 
                        type="file"
                        ref={shippingSlipInputRef}
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setShippingSlipFile(file);
                            const url = URL.createObjectURL(file);
                            setShippingSlipPreview(url);
                          }
                        }}
                      />

                      {shippingSlipPreview ? (
                        <div className="bg-white border-2 border-indigo-200 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-4">
                          <img 
                            src={shippingSlipPreview} 
                            alt="Shipping slip preview" 
                            className="w-24 h-24 object-cover rounded-lg border border-gray-200 cursor-pointer"
                            onClick={() => window.open(shippingSlipPreview, '_blank')}
                          />
                          <div className="flex-grow text-center sm:text-left">
                            <p className="text-sm font-bold text-gray-800">{shippingSlipFile?.name || "รูปถ่ายใบเสร็จ/สลิปส่งของ"}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{(shippingSlipFile ? (shippingSlipFile.size / 1024).toFixed(1) + " KB" : "")}</p>
                            <div className="mt-2 flex gap-2 justify-center sm:justify-start">
                              <button 
                                type="button" 
                                onClick={() => shippingSlipInputRef.current?.click()} 
                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition"
                              >
                                เปลี่ยนรูป
                              </button>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setShippingSlipFile(null);
                                  setShippingSlipPreview(null);
                                  if (shippingSlipInputRef.current) shippingSlipInputRef.current.value = "";
                                }} 
                                className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-medium transition"
                              >
                                ลบรูป
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => shippingSlipInputRef.current?.click()}
                          className="w-full border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-xl p-4 bg-white/70 hover:bg-white transition flex flex-col items-center justify-center gap-2 text-indigo-700 cursor-pointer"
                        >
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-lg">
                            <i className="fa-solid fa-camera"></i>
                          </div>
                          <span className="text-sm font-bold">กดเพื่อถ่ายรูป หรือเลือกรูปสลิปใบส่งของ</span>
                          <span className="text-xs text-gray-400">รองรับไฟล์ JPG, PNG หรือภาพถ่ายจากกล้องมือถือ</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isSubmittingShip}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmittingShip ? (
                      <><i className="fa-solid fa-spinner fa-spin mr-1"></i> กำลังบันทึกข้อมูลและอัปโหลด...</>
                    ) : (
                      <><i className="fa-solid fa-paper-plane mr-1"></i> ยืนยันการจัดส่ง</>
                    )}
                  </button>
                </form>
              )}

              {/* ACTION: SHIPPED or COMPLETED */}
              {(order.status === "SHIPPED" || order.status === "COMPLETED") && (
                <div className="py-2">
                  <div className="flex items-center gap-3 p-4 bg-purple-50/70 rounded-xl border border-purple-100 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600 text-xl flex-shrink-0">
                      <i className={`fa-solid ${order.status === "COMPLETED" ? "fa-circle-check text-emerald-600" : "fa-truck-fast text-purple-600"}`}></i>
                    </div>
                    <div className="flex-grow">
                      <h3 className="font-bold text-gray-800 text-sm">
                        {order.status === "COMPLETED" ? "คำสั่งซื้อสำเร็จเรียบร้อย" : "จัดส่งสินค้าแล้ว (อยู่ระหว่างขนส่ง)"}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {order.status === "COMPLETED"
                          ? "ผู้ซื้อกดยืนยันรับสินค้าเรียบร้อยแล้ว ขอบคุณที่ให้บริการ"
                          : "พัสดุถูกส่งมอบให้บริษัทขนส่งแล้ว กำลังเดินทางไปสู่ผู้ซื้อ"}
                      </p>
                    </div>
                  </div>

                  {/* Shipping Details & Proof Card */}
                  <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-4 text-left space-y-3">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
                      ข้อมูลและหลักฐานการจัดส่ง
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded-lg border border-gray-200">
                        <span className="text-xs text-gray-400 block mb-0.5">บริษัทขนส่ง</span>
                        <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                          <i className="fa-solid fa-box text-purple-500"></i>
                          {order.shippingProvider || "ขนส่งพัสดุ"}
                        </span>
                      </div>

                      <div className="bg-white p-3 rounded-lg border border-gray-200 flex items-center justify-between">
                        <div>
                          <span className="text-xs text-gray-400 block mb-0.5">เลขพัสดุ (Tracking No.)</span>
                          <span className="text-sm font-bold font-mono text-purple-700">
                            {order.trackingNumber || "-"}
                          </span>
                        </div>
                        {order.trackingNumber && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(order.trackingNumber || "");
                              alert("คัดลอกเลขพัสดุแล้ว!");
                            }}
                            className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 px-2.5 py-1.5 rounded font-medium transition cursor-pointer flex items-center gap-1"
                          >
                            <i className="fa-regular fa-copy"></i> คัดลอก
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Proof Section */}
                    <div>
                      <span className="text-xs font-bold text-gray-700 block mb-2 flex items-center gap-1.5">
                        <i className="fa-solid fa-receipt text-purple-600"></i> หลักฐานการส่งของ
                      </span>

                      {order.shippingSlipUrl ? (
                        <div 
                          onClick={() => window.open(order.shippingSlipUrl, '_blank')} 
                          className="relative group rounded-xl overflow-hidden border border-purple-200 cursor-pointer shadow-sm hover:opacity-95 transition max-w-xs"
                        >
                          <img src={order.shippingSlipUrl} alt="Shipping Slip" className="w-full h-44 object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1">
                            <i className="fa-solid fa-magnifying-glass-plus"></i> กดเพื่อดูภาพขนาดเต็ม
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-white rounded-lg border border-dashed border-gray-300 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <i className="fa-solid fa-file-circle-check text-gray-400 text-xl"></i>
                            <div>
                              <p className="text-xs font-semibold text-gray-700">ยืนยันการส่งด้วยเลขพัสดุแล้ว</p>
                              <p className="text-[11px] text-gray-400">ร้านค้าไม่ได้แนบรูปใบเสร็จ สามารถติดตามสถานะได้จากเลขพัสดุด้านบน</p>
                            </div>
                          </div>
                          {order.status === "SHIPPED" && (
                            <>
                              <input 
                                type="file" 
                                ref={additionalSlipInputRef}
                                accept="image/*"
                                className="hidden"
                                onChange={handleUploadAdditionalSlip}
                              />
                              <button
                                type="button"
                                disabled={isUploadingAdditionalSlip}
                                onClick={() => additionalSlipInputRef.current?.click()}
                                className="text-xs text-purple-600 hover:text-purple-700 font-semibold underline cursor-pointer flex-shrink-0"
                              >
                                {isUploadingAdditionalSlip ? "กำลังอัปโหลด..." : "+ แนบรูปใบเสร็จ"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50">
              <span className="font-bold text-gray-800">สินค้าในออเดอร์นี้</span>
            </div>
            <div className="divide-y divide-gray-50">
              {order.items.map(item => (
                <div key={item.id} className="p-4 flex gap-4">
                  <img 
                    src={item.imageAtPurchase} 
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = getProductFallbackImage(item.productNameAtPurchase);
                    }}
                    className="w-20 h-20 object-cover rounded-lg border border-gray-100 flex-shrink-0 shadow-sm" 
                    alt={item.productNameAtPurchase} 
                  />
                  <div className="flex-grow min-w-0">
                    <h4 className="font-bold text-sm text-gray-800">{item.productNameAtPurchase}</h4>
                    <p className="text-xs text-gray-500 my-1">ตัวเลือก: {item.variantNameAtPurchase}</p>
                    <p className="text-sm text-gray-500 font-medium">จำนวน: {item.qty}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-vru-blue">{formatPrice(item.priceAtPurchaseMinor)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between font-bold">
              <span>รวมค่าสินค้า</span>
              <span>{formatPrice(itemsTotal)}</span>
            </div>
            {order.discountAmountMinor && order.discountAmountMinor > 0 ? (
              <div className="p-4 border-t border-gray-100 bg-emerald-50/50 flex justify-between font-bold text-[#16A085]">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-ticket text-xs"></i> ส่วนลดคูปองร้านค้า
                  {order.couponCode && <span className="font-mono text-xs font-bold bg-[#D4F1BB]/50 px-1.5 py-0.5 rounded border border-[#16A085]/30">({order.couponCode})</span>}
                </span>
                <span>-{formatPrice(order.discountAmountMinor)}</span>
              </div>
            ) : null}
            {order.shippingCostMinor !== undefined ? (
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between font-bold text-gray-700">
                <span>ค่าจัดส่ง</span>
                <span>{formatPrice(order.shippingCostMinor)}</span>
              </div>
            ) : null}
            {order.totalAmountMinor != null && (
              <div className="p-4 border-t border-gray-200 bg-emerald-50/80 flex justify-between font-black text-base text-[#16A085]">
                <span>ยอดสุทธิที่ผู้ซื้อต้องโอน</span>
                <span>{formatPrice(order.totalAmountMinor)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Address & Contact */}
        <div className="md:w-1/3 flex flex-col gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
              <i className="fa-solid fa-location-dot text-red-400"></i> ที่อยู่จัดส่ง
            </h3>
            <p className="font-bold text-sm text-gray-800">{order.shippingAddress.recipientName}</p>
            <p className="text-sm text-gray-600 mb-2"><i className="fa-solid fa-phone text-xs mr-1"></i> {order.shippingAddress.phone}</p>
            <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
              {order.shippingAddress.addressLine} ต.{order.shippingAddress.subDistrict} อ.{order.shippingAddress.district} จ.{order.shippingAddress.province} {order.shippingAddress.postalCode}
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
            <h3 className="font-bold text-gray-800 mb-3 text-left">ข้อมูลติดต่อผู้ซื้อ</h3>
            <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto flex items-center justify-center text-gray-400 text-2xl mb-2">
              <i className="fa-solid fa-user"></i>
            </div>
            <p className="font-bold text-sm mb-4">ผู้ใช้: {order.buyerId}</p>
            <Link href={`/seller/chat`} className="w-full inline-flex items-center justify-center gap-2 bg-white border-2 border-[#16A085] text-[#16A085] hover:bg-[#D4F1BB]/30 font-bold py-2 rounded-xl transition">
              <i className="fa-regular fa-message"></i> แชทกับลูกค้า
            </Link>
          </div>
        </div>

      </main>
    </div>
  );
}
