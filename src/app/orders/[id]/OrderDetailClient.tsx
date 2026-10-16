"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Order } from "@/types";
import { formatPrice, formatDateTime, formatCountdown, getOrderStatusLabel } from "@/lib/utils";
import Breadcrumb from "@/components/ui/Breadcrumb";

// Removed mock data

import { buyerOrderApi } from "@/lib/api";
import { buyerDisputeApi } from "@/lib/api-modules/dispute";
import type { DisputeDto } from "@/lib/api-modules/dispute";
import type { PaymentChannelDto } from "@/lib/api-modules/shop";
import { mapOrderDto } from "@/lib/order-mapper";
import { getProductFallbackImage } from "@/lib/product-mapper";

export default function OrderDetailClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [disputes, setDisputes] = useState<DisputeDto[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [paymentChannels, setPaymentChannels] = useState<PaymentChannelDto[]>([]);
  const [selectedQrPreview, setSelectedQrPreview] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const getBankLabel = (code: string | null) => {
    if (!code) return "ธนาคาร";
    const banks: Record<string, string> = {
      kbank: "ธนาคารกสิกรไทย (KBANK)",
      scb: "ธนาคารไทยพาณิชย์ (SCB)",
      bbl: "ธนาคารกรุงเทพ (BBL)",
      ktb: "ธนาคารกรุงไทย (KTB)",
      bay: "ธนาคารกรุงศรีอยุธยา (BAY)",
      gsb: "ธนาคารออมสิน (GSB)",
      baac: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)",
      ttb: "ธนาคารทหารไทยธนชาต (ttb)",
      promptpay: "พร้อมเพย์ (PromptPay)",
    };
    return banks[code.toLowerCase()] || code;
  };

  const fetchOrder = async () => {
    try {
      const o = await buyerOrderApi.getById(orderId);
      const apiOrder: Order = { ...mapOrderDto(o), slipImageUrl: undefined };
      setOrder(apiOrder);

      if (o.displayStatus === "AWAITING_PAYMENT" || o.displayStatus === "PAYMENT_SUBMITTED") {
        buyerOrderApi.getPaymentChannels(orderId).then(res => {
          setPaymentChannels(res || []);
        }).catch(err => {
          console.error("Failed to fetch payment channels for order:", err);
        });
      }

      if (o.displayStatus === "PAYMENT_SUBMITTED" || o.displayStatus === "PAID" || o.displayStatus === "SHIPPED" || o.displayStatus === "COMPLETED") {
        buyerOrderApi.getSlips(orderId).then(res => {
          if (res && res.length > 0) {
            // Use the most recent slip or first slip
            const slip = res[res.length - 1] || res[0]; 
            const slipUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/orders/${orderId}/payment-slips/${slip.id}/file`;
            setOrder(prev => prev ? { ...prev, slipImageUrl: slipUrl } : prev);
          }
        }).catch(console.error);

        buyerOrderApi.getShippingSlips(orderId).then(res => {
          if (res && res.length > 0) {
            const slip = res[res.length - 1] || res[0];
            const slipUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1"}/orders/${orderId}/shipping-slips/${slip.id}/file`;
            setOrder(prev => prev ? { ...prev, shippingSlipUrl: slipUrl } : prev);
          }
        }).catch(console.error);
      }

      try {
        const disputeList = await buyerDisputeApi.list(orderId);
        setDisputes(disputeList);
      } catch (err) {
        console.error("Failed to fetch disputes for order", err);
      }
    } catch (err) {
      console.error("Failed to fetch order", err);
      setOrder(null);
    }
  };

  useEffect(() => {
    setNow(Date.now());
    fetchOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const handleRejectShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectReason) return;
    try {
      await buyerOrderApi.rejectShippingFee(orderId, rejectReason);
      alert(`คุณได้ปฏิเสธค่าจัดส่งแล้ว คำสั่งซื้อจะถูกยกเลิก`);
      setShowRejectForm(false);
      fetchOrder();
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการปฏิเสธค่าส่ง");
    }
  };

  const handleUploadSlip = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      try {
        await buyerOrderApi.uploadSlip(orderId, file);
        await fetchOrder(); // Re-fetch to get updated status and deadline
      } catch (err) {
        console.error("Failed to upload slip", err);
        alert("อัปโหลดสลิปไม่สำเร็จ โปรดลองอีกครั้ง");
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleReceive = async () => {
    if (!confirm("คุณได้รับพัสดุเรียบร้อยและตรวจสอบสินค้าถูกต้องแล้วใช่หรือไม่?\n\nการกดยืนยันจะเสร็จสิ้นคำสั่งซื้อ และเปิดให้คุณเขียนรีวิวสินค้าได้")) return;
    setIsReceiving(true);
    try {
      await buyerOrderApi.markReceived(orderId);
      alert("ยืนยันรับสินค้าสำเร็จเรียบร้อยแล้ว ขอบคุณที่สนับสนุนสินค้าชุมชน!");
      fetchOrder();
    } catch (err) {
      console.error("Failed to mark order received", err);
      alert("เกิดข้อผิดพลาดในการยืนยันรับสินค้า กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsReceiving(false);
    }
  };

  if (!order) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i></div>;

  const itemsTotal = order.items.reduce((sum, i) => sum + (i.priceAtPurchaseMinor * i.qty), 0);

  // Status Styles mapping
  let statusBadgeClass = "bg-gray-100 text-gray-600";
  if (order.status === "AWAITING_SHIPPING_QUOTE") statusBadgeClass = "bg-yellow-50 text-yellow-600 border border-yellow-200";
  else if (order.status === "AWAITING_PAYMENT") statusBadgeClass = "bg-orange-50 text-orange-600 border border-orange-200";
  else if (order.status === "PAYMENT_SUBMITTED") statusBadgeClass = "bg-[#D4F1BB]/50 text-[#16A085] border border-[#16A085]/30";
  else if (order.status === "SHIPPED") statusBadgeClass = "bg-blue-50 text-blue-600 border border-blue-200";
  else if (order.status === "COMPLETED") statusBadgeClass = "bg-green-50 text-green-700 border border-green-200";
  else if (order.status === "CANCELLED") statusBadgeClass = "bg-gray-100 text-gray-500 border border-gray-200";

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      <main className="flex-grow max-w-4xl mx-auto w-full px-4 py-8 md:py-10">
        <Breadcrumb items={[
          { label: "คำสั่งซื้อของฉัน", href: "/orders" },
          { label: `คำสั่งซื้อ #${order.id}` }
        ]} />
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link href="/orders" className="w-12 h-12 bg-white border-2 border-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:text-[#16A085] hover:border-[#16A085]/50 transition shadow-sm">
              <i className="fa-solid fa-arrow-left"></i>
            </Link>
            <div>
              <h2 className="text-2xl font-black text-gray-800">คำสั่งซื้อ #{order.id}</h2>
              <p className="text-sm text-gray-500 font-medium mt-1">สั่งเมื่อ {formatDateTime(order.createdAt)}</p>
            </div>
          </div>
          <div>
            <span className={`px-5 py-2 rounded-full text-sm font-bold shadow-sm ${statusBadgeClass}`}>
              {getOrderStatusLabel(order.status)}
            </span>
          </div>
        </div>

        {disputes && disputes.length > 0 && (
          <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-2xl p-5 shadow-sm">
            <h3 className="text-lg font-bold text-red-600 mb-2 flex items-center gap-2">
              <i className="fa-solid fa-gavel"></i> คำสั่งซื้อนี้อยู่ในสถานะข้อพิพาท
            </h3>
            <p className="text-sm text-red-700 font-medium mb-4">
              มีข้อพิพาทที่ถูกเปิดสำหรับคำสั่งซื้อนี้ กรุณารอการตรวจสอบและตัดสินจากแอดมินชุมชน 
              {disputes[0].closedAt ? ` (ตัดสินเมื่อ ${formatDateTime(disputes[0].closedAt)})` : " (กำลังดำเนินการ)"}
            </p>
            {disputes[0].verdict && (
              <div className="bg-white p-3 rounded-xl border border-red-100">
                <span className="font-bold text-gray-800 text-sm">ผลการตัดสิน: </span>
                <span className={`text-sm font-bold ${disputes[0].verdict === 'BUYER_WINS' ? 'text-green-600' : 'text-red-600'}`}>
                  {disputes[0].verdict === 'BUYER_WINS' ? 'ผู้ซื้อชนะ (รอรับเงินคืน)' : 'ร้านค้าชนะ (คำสั่งซื้อดำเนินต่อ)'}
                </span>
                {disputes[0].rulingReason && <p className="text-sm text-gray-600 mt-1">เหตุผล: {disputes[0].rulingReason}</p>}
              </div>
            )}
          </div>
        )}

        {/* Dynamic Status Action Box (The Core State Machine UX) */}
        <div className="mb-8">
          {order.status === "AWAITING_SHIPPING_QUOTE" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-3xl p-8 text-center shadow-sm">
              <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-5 text-yellow-500 text-4xl shadow-inner">
                <i className="fa-solid fa-clock animate-pulse"></i>
              </div>
              <h3 className="text-xl font-bold text-yellow-800 mb-2">รอร้านค้าแจ้งค่าจัดส่ง</h3>
              <p className="text-base text-yellow-700 font-medium">ร้านค้ากำลังคำนวณค่าจัดส่งตามขนาดและน้ำหนักจริง</p>
              {order.shippingQuoteDeadline && (
                <div className="mt-5 inline-block bg-white border-2 border-yellow-200 rounded-full px-6 py-2 text-sm font-bold text-yellow-700 shadow-sm">
                  <i className="fa-solid fa-stopwatch mr-2"></i> หมดเวลาใน: {formatCountdown(order.shippingQuoteDeadline)}
                </div>
              )}
            </div>
          )}

          {order.status === "AWAITING_PAYMENT" && (
            <div className="bg-white border-2 border-orange-200 rounded-3xl shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-orange-50 to-orange-100/50 p-6 border-b border-orange-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center text-xl shadow-inner">
                    <i className="fa-solid fa-money-bill-wave"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-orange-800 text-lg">ร้านค้าแจ้งค่าจัดส่งแล้ว</h3>
                    <p className="text-sm text-orange-600 font-medium mt-1">กรุณาตรวจสอบยอดและชำระเงินก่อนหมดเวลา</p>
                  </div>
                </div>
                {order.paymentDeadline && (
                  <div className="bg-white border border-orange-200 text-orange-700 font-bold px-4 py-2 rounded-full text-sm shadow-sm flex items-center gap-2">
                    <i className="fa-regular fa-clock"></i> {formatCountdown(order.paymentDeadline)}
                  </div>
                )}
              </div>
              
              <div className="p-6 md:p-8">
                {!showRejectForm ? (
                  <>
                    <div className="mb-8 p-6 bg-gray-50 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 border border-gray-100">
                      <div className="text-center sm:text-left">
                        <p className="text-sm text-gray-500 font-medium mb-1">ค่าจัดส่งที่ร้านแจ้ง:</p>
                        <p className="text-2xl font-black text-[#16A085]">{formatPrice(order.shippingCostMinor || 0)}</p>
                      </div>
                      <div className="w-full sm:w-px h-px sm:h-12 bg-gray-200"></div>
                      <div className="text-center sm:text-right">
                        <p className="text-sm text-gray-500 font-medium mb-1">ยอดชำระสุทธิ:</p>
                        <p className="text-2xl font-black text-[#16A085]">{formatPrice(order.totalAmountMinor || 0)}</p>
                      </div>
                    </div>

                    <div className="mb-8 border-2 border-emerald-100 rounded-3xl p-6 md:p-8 bg-gradient-to-b from-white to-[#F9FCF8] shadow-sm">
                      <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                        <h4 className="font-black text-gray-800 text-lg flex items-center gap-2.5">
                          <i className="fa-solid fa-building-columns text-[#16A085]"></i> ช่องทางชำระเงินของร้านค้า
                        </h4>
                        <span className="text-xs bg-[#D4F1BB]/50 text-[#16A085] font-bold px-3 py-1 rounded-full border border-[#16A085]/20">
                          ชำระตรงกับร้านค้า
                        </span>
                      </div>

                      {paymentChannels.length === 0 ? (
                        <div className="text-center py-8 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                          <i className="fa-solid fa-circle-info text-3xl text-gray-300 mb-2"></i>
                          <p className="font-bold text-gray-700 text-sm">ร้านค้ายังไม่ได้บันทึกช่องทางชำระเงินในระบบ</p>
                          <p className="text-xs text-gray-500 mt-1">กรุณาทักแชทสอบถามเลขบัญชีกับทางร้านค้าโดยตรง</p>
                          <Link href="/chat" className="inline-flex items-center gap-1.5 text-xs text-[#16A085] font-bold mt-3 hover:underline">
                            <i className="fa-regular fa-message"></i> เปิดแชทคุยกับร้านค้า
                          </Link>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {paymentChannels.map((ch) => (
                            <div key={ch.id} className="flex flex-col md:flex-row gap-6 items-center p-5 bg-white rounded-2xl border border-gray-200 shadow-sm">
                              {ch.hasQrImage ? (
                                <div 
                                  className="relative group cursor-pointer flex-shrink-0"
                                  onClick={() => setSelectedQrPreview(`/api/v1/orders/${orderId}/payment-channels/${ch.id}/qr-image`)}
                                  title="คลิกเพื่อดูรูปภาพขนาดเต็ม"
                                >
                                  <img 
                                    src={`/api/v1/orders/${orderId}/payment-channels/${ch.id}/qr-image`} 
                                    alt="QR Code สำหรับชำระเงิน" 
                                    className="w-36 h-36 object-contain rounded-2xl border-2 border-[#16A085]/30 bg-white p-2 shadow-sm group-hover:scale-105 transition-transform" 
                                  />
                                  <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition-opacity">
                                    <i className="fa-solid fa-magnifying-glass-plus mr-1"></i> ดูภาพใหญ่
                                  </div>
                                </div>
                              ) : (
                                <div className="w-28 h-28 bg-emerald-50 rounded-2xl flex flex-col items-center justify-center border border-emerald-100 text-[#16A085] flex-shrink-0">
                                  <i className="fa-solid fa-building-columns text-4xl mb-1"></i>
                                  <span className="text-[10px] font-bold">โอนผ่านธนาคาร</span>
                                </div>
                              )}

                              <div className="flex-1 w-full text-center md:text-left space-y-2">
                                <div className="inline-block bg-[#16A085]/10 text-[#16A085] text-xs font-bold px-3 py-1 rounded-full">
                                  {ch.type === "PROMPTPAY" ? "พร้อมเพย์ (PromptPay)" : getBankLabel(ch.bankName)}
                                </div>

                                {ch.type === "BANK_TRANSFER" && (
                                  <>
                                    <div className="flex flex-col md:flex-row items-center gap-2">
                                      <span className="text-gray-500 text-xs font-bold">เลขที่บัญชี:</span>
                                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
                                        <span className="text-gray-800 text-lg font-mono font-bold tracking-wider">
                                          {ch.bankAccountNumber || "-"}
                                        </span>
                                        {ch.bankAccountNumber && (
                                          <button
                                            type="button"
                                            onClick={() => handleCopy(ch.bankAccountNumber!, ch.id)}
                                            className="text-xs text-[#16A085] hover:text-[#117A65] font-bold px-2 py-0.5 rounded bg-white border border-gray-200 hover:bg-emerald-50 transition"
                                          >
                                            {copiedText === ch.id ? <><i className="fa-solid fa-check text-green-600"></i> คัดลอกแล้ว</> : <><i className="fa-regular fa-copy"></i> คัดลอก</>}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {ch.bankAccountName && (
                                      <p className="text-xs text-gray-600 font-medium">
                                        ชื่อบัญชี: <span className="font-bold text-gray-800">{ch.bankAccountName}</span>
                                      </p>
                                    )}
                                  </>
                                )}

                                {ch.type === "PROMPTPAY" && ch.promptPayId && (
                                  <div className="flex flex-col md:flex-row items-center gap-2">
                                    <span className="text-gray-500 text-xs font-bold">หมายเลขพร้อมเพย์:</span>
                                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
                                      <span className="text-gray-800 text-lg font-mono font-bold tracking-wider">
                                        {ch.promptPayId}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(ch.promptPayId!, ch.id)}
                                        className="text-xs text-[#16A085] hover:text-[#117A65] font-bold px-2 py-0.5 rounded bg-white border border-gray-200 hover:bg-emerald-50 transition"
                                      >
                                        {copiedText === ch.id ? <><i className="fa-solid fa-check text-green-600"></i> คัดลอกแล้ว</> : <><i className="fa-regular fa-copy"></i> คัดลอก</>}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button onClick={() => setShowRejectForm(true)} className="bg-white border-2 border-red-200 text-red-500 hover:border-red-500 hover:bg-red-50 font-bold py-3.5 rounded-full transition-all shadow-sm">
                        <i className="fa-solid fa-xmark mr-2"></i> ปฏิเสธค่าจัดส่ง (ยกเลิก)
                      </button>
                      <button onClick={handleUploadSlip} disabled={isUploading} className="bg-[#16A085] hover:bg-[#16A085]/90 text-white font-bold py-3.5 rounded-full shadow-md transition-all flex items-center justify-center gap-2">
                        {isUploading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-upload"></i>} 
                        อัปโหลดหลักฐานการโอน
                      </button>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                    </div>
                    <div className="mt-4 p-3 bg-red-50 rounded-xl text-center">
                      <p className="text-xs text-red-500 font-bold"><i className="fa-solid fa-triangle-exclamation mr-1"></i> ห้ามส่งสลิปผ่านทางแชทเด็ดขาด ต้องแนบผ่านระบบเพื่อความปลอดภัยของออเดอร์</p>
                    </div>
                  </>
                ) : (
                  <form onSubmit={handleRejectShipping} className="bg-red-50 border border-red-100 p-6 rounded-2xl">
                    <h4 className="font-bold text-red-600 mb-2 flex items-center gap-2 text-lg"><i className="fa-solid fa-triangle-exclamation"></i> ปฏิเสธค่าจัดส่งและยกเลิกคำสั่งซื้อ</h4>
                    <p className="text-sm text-gray-600 mb-4 font-medium leading-relaxed">หากคุณคิดว่าค่าจัดส่งที่ร้านค้าแจ้งมาไม่เหมาะสม คุณสามารถปฏิเสธได้ <b className="text-red-500">(คำสั่งซื้อจะถูกยกเลิกทันที)</b></p>
                    <textarea 
                      required
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-full bg-white border-2 border-gray-200 rounded-xl p-4 text-sm font-medium focus:ring-[#16A085] focus:border-[#16A085] mb-5 shadow-inner transition-all outline-none resize-none" 
                      rows={3} 
                      placeholder="ระบุเหตุผลที่ปฏิเสธ (บังคับกรอก)*"
                    ></textarea>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button type="button" onClick={() => setShowRejectForm(false)} className="flex-1 bg-white border-2 border-gray-200 text-gray-600 font-bold py-3 rounded-full hover:border-gray-300 transition-all shadow-sm">
                        กลับไปหน้าเดิม
                      </button>
                      <button type="submit" className="flex-1 bg-red-500 text-white font-bold py-3 rounded-full hover:bg-red-600 transition-all shadow-md">
                        <i className="fa-solid fa-check mr-2"></i> ยืนยันการปฏิเสธ
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {order.status === "PAYMENT_SUBMITTED" && (
            <div className="bg-[#D4F1BB]/30 border border-[#16A085]/30 rounded-3xl p-8 flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left shadow-sm">
              <div className="w-20 h-20 bg-white border-2 border-[#16A085]/30 text-[#16A085] rounded-full flex items-center justify-center flex-shrink-0 text-3xl shadow-sm">
                <i className="fa-solid fa-money-check-dollar"></i>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">ส่งหลักฐานแล้ว รอร้านค้ายืนยันยอดเงิน</h3>
                {order.confirmationDeadline && now && new Date(order.confirmationDeadline).getTime() < now ? (
                  <div className="mt-2">
                    <div className="inline-block bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded-xl text-sm font-bold shadow-sm mb-3">
                      <i className="fa-solid fa-triangle-exclamation mr-2"></i> เลยกำหนดเวลาตรวจสอบแล้ว (เกิน 3 วัน)
                    </div>
                    <p className="text-xs text-gray-500 mb-3 font-medium">ร้านค้าไม่ได้ตรวจสอบสลิปภายในเวลาที่กำหนด คุณสามารถกดยกเลิกหรือแจ้งปัญหาไปยังผู้ดูแลระบบได้</p>
                    <Link href={`/orders/${order.id}/dispute`} className="inline-flex bg-white border-2 border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50 font-bold py-2.5 px-6 rounded-full transition-all items-center gap-2 text-sm shadow-sm">
                      <i className="fa-solid fa-flag"></i> รายงานปัญหา / ขอคืนเงิน
                    </Link>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 font-medium mb-3">ร้านค้ามีเวลาตรวจสอบ 3 วัน หากเกินกำหนดระบบจะแจ้งเตือนให้รายงานปัญหา</p>
                    {order.confirmationDeadline && (
                      <div className="inline-block bg-white border border-gray-200 text-gray-700 px-4 py-1.5 rounded-full text-xs font-bold shadow-sm">
                        <i className="fa-regular fa-clock text-[#16A085] mr-1"></i> หมดเวลายืนยัน: {formatCountdown(order.confirmationDeadline)}
                      </div>
                    )}
                  </>
                )}
              </div>
              {order.slipImageUrl && (
                <div className="sm:ml-auto w-24 h-32 bg-white rounded-xl overflow-hidden border-4 border-white shadow-md flex-shrink-0 relative group cursor-pointer" onClick={() => window.open(order.slipImageUrl, '_blank')}>
                  <img src={order.slipImageUrl} alt="Payment Slip" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-white text-xs font-bold transition-all"><i className="fa-solid fa-magnifying-glass-plus"></i></div>
                </div>
              )}
            </div>
          )}

          {order.status === "PAID" && (
            <div className="bg-[#D4F1BB] border border-[#16A085]/40 rounded-3xl p-8 text-center shadow-sm">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-5 text-[#16A085] text-4xl shadow-sm">
                <i className="fa-solid fa-box-open animate-bounce"></i>
              </div>
              <h3 className="text-xl font-black text-gray-800 mb-2">ร้านค้ายืนยันยอดเงินแล้ว!</h3>
              <p className="text-base text-gray-700 font-medium">กำลังเตรียมจัดส่งสินค้า กรุณารอรับเลขพัสดุ</p>
            </div>
          )}

          {order.status === "SHIPPED" && (
            <div className="bg-blue-50 border border-blue-200 rounded-3xl p-6 md:p-8 shadow-sm">
              <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
                <div className="text-center md:text-left flex-grow">
                  <div className="flex items-center justify-center md:justify-start gap-3 mb-3">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-500 shadow-sm text-xl">
                      <i className="fa-solid fa-truck-fast"></i>
                    </div>
                    <h3 className="text-xl font-bold text-blue-800">สินค้าถูกจัดส่งแล้ว</h3>
                  </div>
                  <p className="text-sm text-blue-700 font-medium mb-2">จัดส่งผ่านขนส่ง: <span className="font-bold">{order.shippingProvider || "ขนส่งพัสดุ"}</span></p>
                  
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="bg-white px-4 py-2.5 rounded-xl inline-block border border-blue-100 shadow-sm">
                      <p className="text-xs text-gray-400 mb-0.5 font-medium">เลขพัสดุ (Tracking Number)</p>
                      <p className="text-lg font-black text-gray-800 tracking-wider font-mono">{order.trackingNumber}</p>
                    </div>
                  </div>

                  {/* Attached postal/shipping slip photo */}
                  {order.shippingSlipUrl && (
                    <div className="bg-white/80 p-3.5 rounded-2xl border border-blue-100 shadow-sm inline-block">
                      <p className="text-xs font-bold text-blue-900 mb-2 flex items-center gap-1.5">
                        <i className="fa-solid fa-receipt text-blue-600"></i> สลิป / ใบเสร็จส่งของจากขนส่ง (ร้านค้าแนบมา)
                      </p>
                      <div 
                        onClick={() => window.open(order.shippingSlipUrl, '_blank')}
                        className="w-36 h-48 rounded-xl overflow-hidden border border-blue-200 cursor-pointer shadow-sm hover:opacity-90 hover:shadow-md transition relative group"
                      >
                        <img src={order.shippingSlipUrl} alt="Shipping Slip" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center text-white text-xs font-bold gap-1">
                          <i className="fa-solid fa-magnifying-glass-plus text-base"></i>
                          <span>กดดูภาพขยาย</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-full md:w-auto flex flex-col items-center md:items-end flex-shrink-0">
                  <div className="bg-white/70 p-3 rounded-xl mb-4 border border-blue-100 max-w-xs text-center md:text-right">
                    <p className="text-xs text-blue-600 font-medium leading-relaxed">
                      <i className="fa-solid fa-circle-info mr-1"></i> เมื่อได้รับสินค้าและตรวจสอบว่าถูกต้อง โปรดกดยืนยัน 
                      <span className="font-bold text-red-500 block mt-1">(หากไม่กด คำสั่งซื้อจะไม่เสร็จสิ้นและเขียนรีวิวไม่ได้)</span>
                    </p>
                  </div>
                  <button 
                    onClick={handleReceive} 
                    disabled={isReceiving}
                    className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-8 rounded-full shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isReceiving ? (
                      <><i className="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...</>
                    ) : (
                      <><i className="fa-solid fa-clipboard-check"></i> ฉันได้รับสินค้าแล้ว</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {order.status === "COMPLETED" && (
            <div className="bg-[#D4F1BB]/30 border border-[#16A085]/30 rounded-3xl p-8 text-center shadow-sm relative overflow-hidden">
              <div className="absolute -top-10 -right-10 text-[#16A085]/10 text-9xl">
                <i className="fa-solid fa-medal"></i>
              </div>
              <div className="relative z-10">
                <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-5 text-[#16A085] text-4xl shadow-sm border border-[#16A085]/20">
                  <i className="fa-solid fa-check"></i>
                </div>
                <h3 className="text-2xl font-black text-gray-800 mb-2">คำสั่งซื้อสำเร็จเรียบร้อย</h3>
                <p className="text-base text-gray-600 font-medium mb-8">ขอบคุณที่สนับสนุนสินค้าจากชุมชน</p>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                  <Link href={`/orders/${order.id}/review`} className="bg-[#16A085] hover:bg-[#16A085]/90 text-white font-bold py-3.5 px-8 rounded-full transition-all shadow-md flex items-center justify-center gap-2 w-full sm:w-auto">
                    <i className="fa-solid fa-star"></i> เขียนรีวิวสินค้า
                  </Link>
                  <Link href={`/orders/${order.id}/dispute`} className="bg-white border-2 border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50 font-bold py-3.5 px-8 rounded-full transition-all flex items-center justify-center gap-2 w-full sm:w-auto text-sm">
                    <i className="fa-solid fa-triangle-exclamation"></i> แจ้งปัญหา / ข้อพิพาท
                  </Link>
                </div>
                <p className="text-xs text-gray-400 mt-4 font-medium"><i className="fa-solid fa-circle-info mr-1"></i> คุณสามารถเปิดข้อพิพาทได้ภายใน 7 วันหลังรับสินค้า</p>
              </div>
            </div>
          )}

          {order.status === "CANCELLED" && (
            <div className="bg-gray-100 border border-gray-200 rounded-3xl p-8 text-center">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400 text-4xl shadow-sm">
                <i className="fa-solid fa-ban"></i>
              </div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">คำสั่งซื้อถูกยกเลิก</h3>
              {order.rejectionReason && <p className="text-sm text-gray-500 font-medium bg-white px-4 py-2 rounded-xl inline-block border border-gray-100">เหตุผล: <span className="font-bold">{order.rejectionReason}</span></p>}
            </div>
          )}
        </div>

        {/* Order Details Accordions / Blocks */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
          <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500">
              <i className="fa-solid fa-store text-xs"></i>
            </div>
            <span className="font-bold text-gray-800 text-lg">{order.shopName}</span>
          </div>
          <div className="divide-y divide-gray-50 p-2">
            {order.items.map(item => (
              <div key={item.id} className="p-4 md:p-6 flex gap-5">
                <img 
                  src={item.imageAtPurchase} 
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = getProductFallbackImage(item.productNameAtPurchase);
                  }}
                  className="w-24 h-24 object-cover rounded-2xl border border-gray-100 flex-shrink-0 shadow-sm" 
                  alt={item.productNameAtPurchase} 
                />
                <div className="flex-grow min-w-0 flex flex-col justify-center">
                  <h4 className="font-bold text-base text-gray-800 line-clamp-2 mb-1">{item.productNameAtPurchase}</h4>
                  <p className="text-xs text-gray-500 font-medium mb-auto">ตัวเลือก: <span className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-block mt-1">{item.variantNameAtPurchase}</span></p>
                  <div className="flex justify-between items-end mt-3">
                    <span className="font-black text-[#16A085] text-lg">{formatPrice(item.priceAtPurchaseMinor)}</span>
                    <span className="text-sm text-gray-500 font-bold bg-gray-50 px-3 py-1 rounded-lg">x {item.qty}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8">
            <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-3 text-lg">
              <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
                <i className="fa-solid fa-location-dot"></i>
              </div>
              ที่อยู่จัดส่ง 
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-lg ml-auto font-bold uppercase tracking-wider">Snapshot</span>
            </h3>
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="font-black text-gray-800 text-base mb-1">{order.shippingAddress.recipientName} <span className="text-gray-500 font-medium ml-2 text-sm">| {order.shippingAddress.phone}</span></p>
              <p className="text-sm text-gray-600 leading-relaxed font-medium mt-2">
                {order.shippingAddress.addressLine} ต.{order.shippingAddress.subDistrict} อ.{order.shippingAddress.district} <br />
                จ.{order.shippingAddress.province} {order.shippingAddress.postalCode}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8">
            <h3 className="font-bold text-gray-800 mb-5 flex items-center gap-3 text-lg">
              <div className="w-10 h-10 rounded-full bg-[#D4F1BB]/50 text-[#16A085] flex items-center justify-center">
                <i className="fa-solid fa-receipt text-lg"></i>
              </div>
              สรุปยอดเงิน
            </h3>
            <div className="space-y-3 text-sm font-medium mb-5 border-b-2 border-gray-100 border-dashed pb-5">
              <div className="flex justify-between items-center text-gray-600">
                <span>ยอดรวมสินค้า</span>
                <span className="text-gray-800 font-bold">{formatPrice(itemsTotal)}</span>
              </div>
              {order.discountAmountMinor && order.discountAmountMinor > 0 ? (
                <div className="flex justify-between items-center text-[#16A085]">
                  <span className="flex items-center gap-1.5 font-bold">
                    <i className="fa-solid fa-ticket text-xs"></i> ส่วนลดคูปอง
                    {order.couponCode && (
                      <span className="text-[10px] font-mono font-bold bg-[#D4F1BB]/50 text-[#16A085] px-1.5 py-0.5 rounded border border-[#16A085]/30">
                        {order.couponCode}
                      </span>
                    )}
                  </span>
                  <span className="font-bold">-{formatPrice(order.discountAmountMinor)}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-center text-gray-600">
                <span>ค่าจัดส่ง</span>
                {order.shippingCostMinor !== undefined ? (
                  <span className="text-gray-800 font-bold">{formatPrice(order.shippingCostMinor)}</span>
                ) : (
                  <span className="text-yellow-600 font-bold bg-yellow-50 px-2 py-1 rounded-lg text-xs">รอร้านค้าแจ้ง</span>
                )}
              </div>
            </div>
            <div className="flex justify-between items-end font-bold">
              <span className="text-gray-800">ยอดรวมทั้งสิ้น</span>
              <span className="text-[#16A085] text-3xl font-black block leading-none">
                {order.totalAmountMinor ? formatPrice(order.totalAmountMinor) : "-"}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center">
          <Link href={`/chat`} className="inline-flex items-center justify-center gap-3 bg-white border-2 border-[#16A085]/30 text-[#16A085] hover:border-[#16A085] hover:bg-[#D4F1BB]/10 font-bold py-4 px-10 rounded-full transition-all shadow-sm hover:shadow-md">
            <i className="fa-regular fa-message text-lg"></i> แชทติดต่อร้านค้า
          </Link>
        </div>

      </main>

      {/* Modal View Full QR Code */}
      {selectedQrPreview && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedQrPreview(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <button 
              type="button"
              onClick={() => setSelectedQrPreview(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
            <h4 className="font-bold text-gray-800 mb-3 text-lg flex items-center justify-center gap-2">
              <i className="fa-solid fa-qrcode text-[#16A085]"></i> สแกนเพื่อชำระเงิน
            </h4>
            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-200 inline-block mb-4">
              <img src={selectedQrPreview} alt="Full QR Code" className="max-w-full max-h-[60vh] object-contain rounded-xl mx-auto" />
            </div>
            <p className="text-xs text-gray-500 mb-4">เปิดแอปพลิเคชันธนาคารของคุณเพื่อสแกน QR Code นี้</p>
            <button 
              type="button"
              onClick={() => setSelectedQrPreview(null)}
              className="w-full bg-[#16A085] hover:bg-[#117A65] text-white py-3 rounded-full font-bold text-sm shadow-md transition"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
