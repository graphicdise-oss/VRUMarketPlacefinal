"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Order, OrderStatus } from "@/types";
import { formatDateTime, formatPrice, getOrderStatusLabel, getOrderStatusColor, formatCountdown } from "@/lib/utils";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { sellerOrderApi } from "@/lib/api";
import { mapOrderDto } from "@/lib/order-mapper";
import { getProductFallbackImage } from "@/lib/product-mapper";

const statusTabs: { label: string; value: OrderStatus | "ALL" }[] = [
  { label: "ทั้งหมด", value: "ALL" },
  { label: "รอใส่ค่าส่ง (ด่วน)", value: "AWAITING_SHIPPING_QUOTE" },
  { label: "รอผู้ซื้อจ่าย", value: "AWAITING_PAYMENT" },
  { label: "รอยืนยันเงินเข้า", value: "PAYMENT_SUBMITTED" },
  { label: "ที่ต้องจัดส่ง", value: "PAID" },
  { label: "ส่งแล้ว", value: "SHIPPED" },
  { label: "เสร็จสิ้น", value: "COMPLETED" },
  { label: "ขอคืนเงิน", value: "REFUND_ORDERED" },
  { label: "แช่แข็ง", value: "FROZEN" },
  { label: "ยกเลิกแล้ว", value: "CANCELLED" },
];

export default function SellerOrdersClient() {
  const [activeTab, setActiveTab] = useState<OrderStatus | "ALL">("ALL");
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    sellerOrderApi.list()
      .then(res => {
        const apiOrders: Order[] = (res.items || []).map(mapOrderDto);
        setOrders(apiOrders);
      })
      .catch(err => console.error("Error fetching seller orders:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const shopOrders = orders;
  const filteredOrders = activeTab === "ALL" ? shopOrders : shopOrders.filter((o) => o.status === activeTab);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/seller" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-vru-blue rounded-lg flex items-center justify-center text-white">
              <i className="fa-solid fa-store"></i>
            </div>
            <h1 className="text-xl font-bold text-gray-800">จัดการคำสั่งซื้อ</h1>
          </Link>
          <Link href="/seller" className="text-sm font-medium text-gray-500 hover:text-vru-blue transition">
            กลับแดชบอร์ด
          </Link>
        </div>
      </header>

      <main className="flex-grow max-w-5xl mx-auto w-full px-4 py-6">
        <Breadcrumb items={[
          { label: "Seller Center", href: "/seller" },
          { label: "จัดการคำสั่งซื้อ" }
        ]} />

        {/* Status Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-6 pb-2">
          {statusTabs.map((tab) => {
            const count = tab.value !== "ALL" ? shopOrders.filter(o => o.status === tab.value).length : shopOrders.length;
            const isUrgent = tab.value === "AWAITING_SHIPPING_QUOTE" || tab.value === "PAYMENT_SUBMITTED" || tab.value === "REFUND_ORDERED";
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                  activeTab === tab.value
                    ? "bg-vru-blue text-white shadow-sm"
                    : "bg-white text-gray-600 border border-gray-200 hover:border-vru-blue"
                }`}
              >
                <span>{tab.label}</span>
                {count > 0 && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                    isUrgent
                      ? "bg-red-500 text-white"
                      : activeTab === tab.value
                      ? "bg-white/30 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex flex-col gap-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                  <div className="h-5 bg-gray-200 rounded-full w-20"></div>
                </div>
                <div className="px-4 py-3">
                  <div className="flex gap-4">
                    <div className="w-16 h-16 bg-gray-200 rounded-lg flex-shrink-0"></div>
                    <div className="flex-grow min-w-0 space-y-2 py-1">
                      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="h-3 bg-gray-200 rounded w-32"></div>
                  <div className="h-9 bg-gray-200 rounded-lg w-28"></div>
                </div>
              </div>
            ))
          ) : filteredOrders.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center text-gray-400 border border-gray-100 shadow-sm">
              <i className="fa-solid fa-box-open text-4xl mb-3 text-gray-300"></i>
              <p className="text-base font-medium">ไม่มีคำสั่งซื้อในหมวดหมู่นี้</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredOrders.map((order) => {
                const firstItem = order.items && order.items.length > 0 ? order.items[0] : null;
                const deadline =
                  order.status === "AWAITING_SHIPPING_QUOTE"
                    ? order.shippingQuoteDeadline
                    : order.status === "PAYMENT_SUBMITTED"
                    ? order.confirmationDeadline
                    : undefined;

                const address = order.shippingAddress;
                const addressText = address
                  ? [
                      address.subDistrict ? `ต.${address.subDistrict}` : "",
                      address.district ? `อ.${address.district}` : "",
                      address.province ? `จ.${address.province}` : "",
                      address.postalCode || "",
                    ].filter(Boolean).join(" ") || address.addressLine || "-"
                  : "-";

                const fallbackImg = getProductFallbackImage(firstItem?.productNameAtPurchase || "");

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all duration-200"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-gray-600 bg-white px-2 py-1 rounded border border-gray-200">
                          #{order.id.slice(0, 8)}
                        </span>
                        {address?.recipientName && (
                          <span className="text-xs text-gray-500">
                            ผู้ซื้อ: <span className="font-semibold text-gray-700">{address.recipientName}</span>
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${getOrderStatusColor(order.status)}`}>
                        {getOrderStatusLabel(order.status)}
                      </span>
                    </div>

                    {/* Deadline Warning Banner */}
                    {deadline && (
                      <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center gap-2">
                        <i className="fa-solid fa-clock text-red-500 animate-pulse"></i>
                        <span className="text-xs text-red-700 font-bold">
                          หมดเวลาจัดการใน: {formatCountdown(deadline)}
                        </span>
                      </div>
                    )}

                    {/* Product & Shipping Info */}
                    <div className="px-4 py-3.5">
                      <div className="flex gap-4 items-start">
                        <img
                          src={firstItem?.imageAtPurchase || fallbackImg}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = fallbackImg;
                          }}
                          className="w-16 h-16 object-cover rounded-lg flex-shrink-0 border border-gray-100 shadow-sm bg-gray-50"
                          alt={firstItem?.productNameAtPurchase || "สินค้า"}
                        />
                        <div className="flex-grow min-w-0">
                          <p className="font-bold text-sm text-gray-800 line-clamp-1">
                            {firstItem?.productNameAtPurchase || "คำสั่งซื้อไม่มีข้อมูลสินค้า"}
                          </p>
                          <p className="text-xs text-gray-500 my-1">
                            ตัวเลือก: <span className="font-medium text-gray-700">{firstItem?.variantNameAtPurchase || "-"}</span> | จำนวน: <span className="font-bold text-gray-800">{firstItem?.qty || 1}</span> ชิ้น
                          </p>
                          <p className="text-xs text-gray-400 flex items-center gap-1 line-clamp-1">
                            <i className="fa-solid fa-location-dot text-gray-400"></i>
                            ส่งไปที่: {addressText}
                          </p>
                        </div>
                      </div>
                      {order.items && order.items.length > 1 && (
                        <p className="text-xs text-center text-gray-400 mt-2 bg-gray-50 py-1 rounded">
                          และสินค้าอื่นๆ อีก {order.items.length - 1} รายการ
                        </p>
                      )}
                    </div>

                    {/* Footer / Action */}
                    <div className="px-4 py-3 bg-gray-50/80 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
                        <span>สั่งเมื่อ: <span className="font-medium text-gray-700">{formatDateTime(order.createdAt)}</span></span>
                        {order.totalAmountMinor != null && (
                          <span className="border-l border-gray-200 pl-3 font-semibold text-gray-800">
                            ยอดรวม: <span className="text-sm font-bold text-emerald-600">{formatPrice(order.totalAmountMinor)}</span>
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/seller/orders/${order.id}`}
                        className="bg-vru-blue hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg text-sm text-center transition-all active:scale-95 shadow-sm"
                      >
                        จัดการออเดอร์
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
