"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import { Order, OrderStatus } from "@/types";
import { formatPrice, formatCountdown, getOrderStatusLabel } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useSearchParams, useRouter } from "next/navigation";
import Breadcrumb from "@/components/ui/Breadcrumb";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";
import { buyerOrderApi } from "@/lib/api";
import { mapOrderDto } from "@/lib/order-mapper";
import { getProductFallbackImage } from "@/lib/product-mapper";

const statusTabs: { label: string; value: OrderStatus | "ALL" }[] = [
  { label: "ทั้งหมด", value: "ALL" },
  { label: "รอค่าส่ง", value: "AWAITING_SHIPPING_QUOTE" },
  { label: "ที่ต้องชำระ", value: "AWAITING_PAYMENT" },
  { label: "รอยืนยันสลิป", value: "PAYMENT_SUBMITTED" },
  { label: "ที่ต้องจัดส่ง", value: "PAID" },
  { label: "กำลังจัดส่ง", value: "SHIPPED" },
  { label: "เสร็จสิ้น", value: "COMPLETED" },
  { label: "ยกเลิกแล้ว", value: "CANCELLED" },
];

export default function OrdersPageClient() {
  const [activeTab, setActiveTab] = useState<OrderStatus | "ALL">("ALL");
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  // Use search params to check if navigated from profile
  const searchParams = useSearchParams();
  const showSidebar = searchParams ? searchParams.get("from") === "profile" : false;

  useEffect(() => {
    // Redirect if definitely not logged in
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/orders");
      return;
    }

    const fetchOrders = async () => {
      setIsLoading(true);
      try {
        const res = await buyerOrderApi.list();
        const apiOrders: Order[] = (res.items || []).map(mapOrderDto);
        setOrders(apiOrders);
      } catch (err) {
        const error = err as Error & { status?: number };
        console.warn("Failed to fetch orders (might be unauthorized):", error);
        // If the error is 401 or has the specific login message, redirect
        if (error?.message?.includes("กรุณาเข้าสู่ระบบก่อน") || error?.status === 401) {
          router.push("/login?redirect=/orders");
        }
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      fetchOrders();
    }
  }, [user, isAuthLoading, router]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    counts["ALL"] = orders.filter(o => o.status !== "FROZEN").length;
    statusTabs.forEach(t => {
      if (t.value !== "ALL") {
        counts[t.value] = orders.filter(o => o.status === t.value).length;
      }
    });
    return counts;
  }, [orders]);

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const activeTabBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll active tab into view on mobile
  useEffect(() => {
    if (activeTabBtnRef.current) {
      activeTabBtnRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [activeTab]);

  // If auth is loading, or user is null (about to redirect), show loading state
  if (isAuthLoading || !user) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-gray-400">
            <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i>
            <p className="font-bold">กำลังตรวจสอบสิทธิ์...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const filteredOrders = activeTab === "ALL" 
    ? orders.filter(o => o.status !== "FROZEN")
    : orders.filter((o) => o.status === activeTab);

  const getDeadline = (order: Order): string | undefined => {
    switch (order.status) {
      case "AWAITING_SHIPPING_QUOTE": return order.shippingQuoteDeadline;
      case "AWAITING_PAYMENT": return order.paymentDeadline;
      case "PAYMENT_SUBMITTED": return order.confirmationDeadline;
      default: return undefined;
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch(status) {
      case "COMPLETED": return "text-green-600";
      case "CANCELLED":
      case "FROZEN": return "text-red-500";
      case "PAYMENT_SUBMITTED": return "text-purple-600";
      case "AWAITING_SHIPPING_QUOTE":
      case "AWAITING_PAYMENT": return "text-[#ee4d2d]"; // Shopee Orange
      default: return "text-[#16A085]";
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      <Header />
      
      <div className="max-w-7xl mx-auto w-full px-4 pt-6 md:pt-8 pb-0">
        <Breadcrumb items={[{ label: "โปรไฟล์", href: "/profile" }, { label: "คำสั่งซื้อของฉัน" }]} />
      </div>

      <main className={`flex-grow mx-auto w-full px-4 pt-4 pb-12 flex flex-col md:flex-row gap-6 ${showSidebar ? 'max-w-7xl' : 'max-w-5xl'}`}>
        
        {/* Sidebar */}
        {showSidebar && (
          <ProfileSidebar 
            name={user?.displayName || ""} 
            avatarUrl={user?.avatarUrl || null} 
          />
        )}

        {/* Content */}
        <div className="flex-grow min-w-0">
          
          {/* Status Tabs (Shopee Style - Mobile Scrollable & Tuned Size/Spacing) */}
          <div className="relative w-full mb-4">
            <div 
              ref={tabsContainerRef}
              className="bg-white rounded-2xl shadow-xs border border-gray-100 flex items-center overflow-x-auto scroll-smooth hide-scrollbar touch-pan-x overscroll-x-contain select-none"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {statusTabs.map((tab) => {
                const isActive = activeTab === tab.value;
                const count = tabCounts[tab.value] || 0;

                return (
                  <button 
                    key={tab.value} 
                    ref={isActive ? activeTabBtnRef : null}
                    onClick={(e) => {
                      setActiveTab(tab.value);
                      e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                    }}
                    className={`flex-1 min-w-max px-3.5 sm:px-5 py-3 sm:py-3.5 text-xs sm:text-sm font-bold whitespace-nowrap text-center transition-colors relative focus:outline-none cursor-pointer flex items-center justify-center gap-1.5
                      ${isActive ? "text-[#16A085]" : "text-gray-600 hover:text-[#16A085]"}`}
                  >
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span className={`text-[10px] sm:text-[11px] px-1.5 py-0.2 rounded-full font-bold transition ${
                        isActive 
                          ? "bg-[#16A085]/15 text-[#16A085]" 
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {count}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 sm:h-[3px] bg-[#16A085] rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Orders List */}
          <div className="flex flex-col gap-4">
            {isLoading ? (
              <div className="py-20 text-center">
                <i className="fa-solid fa-spinner fa-spin text-3xl text-[#16A085]"></i>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="bg-white rounded-lg p-20 text-center text-gray-400 shadow-sm border border-gray-100 flex flex-col items-center">
                <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                  <i className="fa-regular fa-clipboard text-5xl text-gray-300"></i>
                </div>
                <p className="font-medium text-gray-500 text-lg mb-2">ยังไม่มีคำสั่งซื้อ</p>
              </div>
            ) : (
              filteredOrders.map((order) => {
                const deadline = getDeadline(order);
                const statusColor = getStatusColor(order.status);

                return (
                  <div key={order.id} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                    {/* Order Header */}
                    <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-store text-gray-500 text-sm"></i>
                        <span className="font-bold text-gray-800 text-sm">{order.shopName}</span>
                        <Link href={`/chat`} className="ml-2 bg-[#D4F1BB]/30 text-[#16A085] hover:bg-[#D4F1BB] px-2 py-1 rounded text-xs font-bold transition flex items-center gap-1">
                          <i className="fa-regular fa-message"></i> แชท
                        </Link>
                        <Link href={`/shops/${order.shopId}`} className="ml-1 border border-gray-200 text-gray-600 hover:bg-gray-50 px-2 py-1 rounded text-xs font-bold transition flex items-center gap-1">
                          <i className="fa-solid fa-shop"></i> ดูร้านค้า
                        </Link>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-medium ${statusColor}`}>
                          {getOrderStatusLabel(order.status)}
                        </span>
                      </div>
                    </div>

                    {/* Order Items */}
                    <Link href={`/orders/${order.id}`} className="block hover:bg-gray-50/50 transition px-6 py-4 border-b border-gray-100">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex gap-4 mb-4 last:mb-0">
                          <img 
                            src={item.imageAtPurchase} 
                            alt={item.productNameAtPurchase} 
                            onError={(e) => {
                              e.currentTarget.src = getProductFallbackImage(item.productNameAtPurchase);
                            }}
                            className="w-20 h-20 object-cover rounded-xl border border-gray-200 flex-shrink-0 bg-gray-50 shadow-2xs" 
                          />
                          <div className="flex-grow min-w-0 flex flex-col justify-between">
                            <div>
                              <h4 className="text-sm font-bold text-gray-800 line-clamp-2 leading-relaxed">{item.productNameAtPurchase}</h4>
                              <p className="text-xs text-gray-500 mt-1">ตัวเลือก: {item.variantNameAtPurchase}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end flex-shrink-0">
                            <span className="text-sm font-bold text-gray-800">{formatPrice(item.priceAtPurchaseMinor)}</span>
                            <span className="text-xs text-gray-500 mt-1">x{item.qty}</span>
                          </div>
                        </div>
                      ))}
                    </Link>

                    {/* Status Info Banners */}
                    {deadline && (
                      <div className="px-6 py-2.5 bg-[#FFF9F3] border-b border-[#FFE9D5] flex items-center gap-2">
                        <i className="fa-regular fa-clock text-[#EE4D2D]"></i>
                        <span className="text-xs text-[#EE4D2D] font-medium">กรุณาดำเนินการภายใน: <b className="ml-1">{formatCountdown(deadline)}</b></span>
                      </div>
                    )}

                    {order.status === "AWAITING_SHIPPING_QUOTE" && (
                      <div className="px-6 py-2.5 bg-amber-50/70 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800 font-medium">
                        <i className="fa-solid fa-calculator text-amber-500"></i>
                        <span>ร้านค้ากำลังคำนวณค่าจัดส่งตามระยะทางและน้ำหนักสินค้า กรุณารอสักครู่ (ภายใน 24 ชม.)</span>
                      </div>
                    )}

                    {order.status === "PAYMENT_SUBMITTED" && (
                      <div className="px-6 py-2.5 bg-purple-50/70 border-b border-purple-100 flex items-center gap-2 text-xs text-purple-800 font-medium">
                        <i className="fa-solid fa-receipt text-purple-500"></i>
                        <span>แนบสลิปชำระเงินเรียบร้อยแล้ว กำลังรอร้านค้าตรวจสอบยอดเงินเข้าบัญชี</span>
                      </div>
                    )}

                    {order.status === "PAID" && (
                      <div className="px-6 py-2.5 bg-emerald-50/70 border-b border-emerald-100 flex items-center gap-2 text-xs text-emerald-800 font-medium">
                        <i className="fa-solid fa-box-archive text-[#16A085]"></i>
                        <span>ร้านค้ายืนยันรับยอดเงินแล้ว กำลังเตรียมบรรจุสินค้าเพื่อจัดส่ง</span>
                      </div>
                    )}

                    {order.status === "SHIPPED" && order.trackingNumber && (
                      <div className="px-6 py-2.5 bg-blue-50/70 border-b border-blue-100 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 text-blue-800 font-medium flex-wrap">
                          <i className="fa-solid fa-truck-fast text-blue-500"></i>
                          <span>จัดส่งโดย: <b>{order.shippingProvider || "ขนส่งเอกชน"}</b></span>
                          <span className="text-gray-300">|</span>
                          <span>เลขพัสดุ: <b className="font-mono text-blue-900 bg-white px-2 py-0.5 rounded border border-blue-200">{order.trackingNumber}</b></span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(order.trackingNumber || "");
                            alert("คัดลอกเลขพัสดุแล้ว!");
                          }}
                          className="text-[11px] text-blue-600 hover:text-blue-800 underline font-semibold flex items-center gap-1 cursor-pointer flex-shrink-0"
                        >
                          <i className="fa-regular fa-copy"></i> คัดลอก
                        </button>
                      </div>
                    )}

                    {order.status === "COMPLETED" && (
                      <div className="px-6 py-2.5 bg-green-50/70 border-b border-green-100 flex items-center gap-2 text-xs text-green-800 font-medium">
                        <i className="fa-solid fa-circle-check text-green-600"></i>
                        <span>พัสดุถูกจัดส่งถึงมือผู้รับเรียบร้อยแล้ว ขอบคุณที่สนับสนุนสินค้าชุมชน</span>
                      </div>
                    )}

                    {order.status === "CANCELLED" && (
                      <div className="px-6 py-2.5 bg-red-50/70 border-b border-red-100 flex items-center gap-2 text-xs text-red-700 font-medium">
                        <i className="fa-solid fa-circle-xmark text-red-500"></i>
                        <span>ยกเลิกคำสั่งซื้อแล้ว {order.rejectionReason ? `(${order.rejectionReason})` : ""}</span>
                      </div>
                    )}

                    {/* Order Footer (Total & Contextual Actions) */}
                    <div className="px-6 py-5 bg-[#FAFAFA] flex flex-col sm:flex-row items-end sm:items-center justify-between gap-4">
                      <div className="text-xs text-gray-400 font-medium">
                        รหัสคำสั่งซื้อ: <span className="font-mono font-bold text-gray-500">{order.id.slice(0,8).toUpperCase()}</span>
                      </div>
                      
                      <div className="flex flex-col items-end gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">ยอดคำสั่งซื้อทั้งหมด:</span>
                          {order.totalAmountMinor ? (
                            <span className="text-xl font-bold text-[#EE4D2D]">{formatPrice(order.totalAmountMinor)}</span>
                          ) : (
                            <span className="text-sm text-[#EE4D2D] font-bold">รอร้านแจ้งค่าส่ง</span>
                          )}
                        </div>
                        
                        <div className="flex gap-2 flex-wrap justify-end w-full sm:w-auto">
                          {/* Contextual Action Buttons depending on status */}
                          {order.status === "AWAITING_PAYMENT" && (
                            <Link href={`/orders/${order.id}`} className="px-6 py-2 bg-[#EE4D2D] hover:bg-[#d63f20] text-white text-sm font-bold rounded-lg transition shadow-sm flex items-center justify-center gap-1.5 active:scale-95">
                              <i className="fa-regular fa-credit-card"></i> ชำระเงินทันที
                            </Link>
                          )}

                          {order.status === "SHIPPED" && (
                            <Link href={`/orders/${order.id}`} className="px-6 py-2 bg-[#16A085] hover:bg-[#12876f] text-white text-sm font-bold rounded-lg transition shadow-sm flex items-center justify-center gap-1.5 active:scale-95">
                              <i className="fa-solid fa-box-open"></i> ยืนยันรับสินค้า
                            </Link>
                          )}

                          {order.status === "COMPLETED" && (
                            <>
                              <Link href={`/orders/${order.id}/review`} className="px-4 py-2 border-2 border-[#16A085] text-[#16A085] hover:bg-[#D4F1BB]/30 text-sm font-bold rounded-lg transition flex items-center justify-center gap-1.5">
                                <i className="fa-regular fa-star"></i> ให้คะแนน / รีวิว
                              </Link>
                              <Link href="/products" className="px-4 py-2 bg-[#16A085] hover:bg-[#12876f] text-white text-sm font-bold rounded-lg transition shadow-sm flex items-center justify-center gap-1.5">
                                <i className="fa-solid fa-rotate-right text-xs"></i> ซื้ออีกครั้ง
                              </Link>
                            </>
                          )}

                          {order.status === "CANCELLED" && (
                            <Link href="/products" className="px-5 py-2 bg-[#16A085] hover:bg-[#12876f] text-white text-sm font-bold rounded-lg transition shadow-sm flex items-center justify-center gap-1.5">
                              <i className="fa-solid fa-rotate-right text-xs"></i> ซื้ออีกครั้ง
                            </Link>
                          )}

                          {order.status === "AWAITING_SHIPPING_QUOTE" && (
                            <Link href="/chat" className="px-4 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-bold rounded-lg transition flex items-center justify-center gap-1.5">
                              <i className="fa-regular fa-message text-[#16A085]"></i> ติดต่อร้านค้า
                            </Link>
                          )}

                          <Link href={`/orders/${order.id}`} className="px-5 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-bold rounded-lg transition text-center">
                            ดูรายละเอียด
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Load More */}
          {filteredOrders.length > 0 && (
            <div className="text-center mt-6">
              <button className="bg-white border border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 font-bold text-sm px-10 py-2.5 rounded shadow-sm transition">
                ดูเพิ่มเติม
              </button>
            </div>
          )}
        </div>
      </main>
      
      <Footer />
      <MobileNav />
    </div>
  );
}
