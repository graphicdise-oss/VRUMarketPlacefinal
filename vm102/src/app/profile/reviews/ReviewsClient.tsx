"use client";

import { useAuth } from "@/lib/auth-context";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ProfileSidebar from "../components/ProfileSidebar";
import Link from "next/link";
import { useState, useEffect } from "react";
import { buyerOrderApi } from "@/lib/api";
import type { OrderDto } from "@/lib/api-modules/order";
import { useRouter } from "next/navigation";

export default function ReviewsClient() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await buyerOrderApi.list();
        setOrders(res.items || []);
      } catch (err) {
        const error = err as Error & { status?: number };
        if (error?.message === "กรุณาเข้าสู่ระบบก่อน" || error?.status === 401) {
          router.push("/login");
        } else {
          console.error("Failed to fetch orders for reviews:", error);
        }
      } finally {
        setIsLoading(false);
      }
    };
    if (user) {
      fetchOrders();
    } else if (!isAuthLoading) {
      router.push("/login");
    }
  }, [user, isAuthLoading, router]);

  const completedOrders = orders.filter(o => o.status === "COMPLETED");
  const pendingReviews = completedOrders.filter(o => !o.review);
  const completedReviews = completedOrders.filter(o => o.review);

  const renderOrderItems = (order: OrderDto) => {
    const firstItem = order.items[0];
    const extraCount = order.items.length - 1;
    return (
      <div className="flex items-center gap-4 mt-3">
        <div className="w-16 h-16 bg-gray-100 rounded-xl flex-shrink-0 flex items-center justify-center text-gray-400">
          <i className="fa-solid fa-box text-2xl"></i>
        </div>
        <div>
          <p className="font-medium text-gray-800 line-clamp-2">{firstItem?.productNameAtPurchase || "สินค้า"}</p>
          {extraCount > 0 && <p className="text-sm text-gray-500 mt-1">และสินค้าอื่นๆ อีก {extraCount} รายการ</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 pt-4 pb-8 flex flex-col md:flex-row gap-8">
        
        {/* Sidebar */}
        <ProfileSidebar name={user?.displayName || ""} avatarUrl={null} />

        {/* Content */}
        <div className="flex-grow bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 text-amber-500 rounded-xl flex items-center justify-center">
                <i className="fa-solid fa-star"></i>
              </div>
              การรีวิวของฉัน
            </h2>
          </div>
          
          {/* Tabs */}
          <div className="flex border-b border-gray-100 mb-8">
            <button 
              onClick={() => setActiveTab("pending")}
              className={`pb-4 px-6 font-medium text-sm transition-colors relative ${activeTab === "pending" ? "text-[#16A085]" : "text-gray-500 hover:text-gray-800"}`}
            >
              รอการรีวิว
              {activeTab === "pending" && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#16A085] rounded-t-full"></div>
              )}
            </button>
            <button 
              onClick={() => setActiveTab("completed")}
              className={`pb-4 px-6 font-medium text-sm transition-colors relative ${activeTab === "completed" ? "text-[#16A085]" : "text-gray-500 hover:text-gray-800"}`}
            >
              รีวิวแล้ว
              {activeTab === "completed" && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#16A085] rounded-t-full"></div>
              )}
            </button>
          </div>
          
          {isLoading ? (
            <div className="py-12 flex justify-center items-center">
              <div className="w-8 h-8 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : activeTab === "pending" ? (
            pendingReviews.length === 0 ? (
              <div className="text-center py-16 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <i className="fa-regular fa-comment-dots text-4xl text-gray-300"></i>
                </div>
                <h3 className="text-xl font-bold text-gray-700 mb-2">ยังไม่มีสินค้าที่รอการรีวิว</h3>
                <p className="text-gray-500 mb-6 max-w-md mx-auto">คุณสามารถรีวิวสินค้าได้หลังจากที่ได้รับสินค้าและกดยืนยันการรับสินค้าแล้ว</p>
                <Link href="/orders" className="inline-flex items-center justify-center bg-[#16A085] hover:bg-[#12876f] text-white px-6 py-3 rounded-xl font-bold transition shadow-sm hover:shadow">
                  <i className="fa-solid fa-box mr-2"></i> ดูคำสั่งซื้อของฉัน
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingReviews.map(order => (
                  <div key={order.id} className="border border-gray-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-50">
                      <p className="text-sm text-gray-500">
                        <i className="fa-regular fa-calendar mr-2"></i>
                        ได้รับเมื่อ {order.completedAt ? new Date(order.completedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                      </p>
                      <span className="text-xs font-bold px-3 py-1 bg-amber-50 text-amber-600 rounded-full">รอการรีวิว</span>
                    </div>
                    {renderOrderItems(order)}
                    <div className="mt-5 flex justify-end">
                      <Link href={`/orders/${order.id}`} className="bg-[#16A085] text-white px-5 py-2 rounded-xl text-sm font-bold hover:bg-[#12876f] transition">
                        ให้คะแนนร้านค้า
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            completedReviews.length === 0 ? (
               <div className="text-center py-16 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                 <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <i className="fa-solid fa-star text-4xl text-gray-300"></i>
                </div>
                 <h3 className="text-xl font-bold text-gray-700 mb-2">คุณยังไม่เคยรีวิวสินค้าใดๆ</h3>
               </div>
            ) : (
              <div className="space-y-4">
                {completedReviews.map(order => (
                  <div key={order.id} className="border border-gray-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-50">
                      <p className="text-sm text-gray-500">
                        <i className="fa-regular fa-calendar mr-2"></i>
                        รีวิวเมื่อ {order.review?.createdAt ? new Date(order.review.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-"}
                      </p>
                      <div className="flex gap-1 text-amber-400 text-sm">
                        {[1, 2, 3, 4, 5].map(star => (
                          <i key={star} className={`fa-star ${star <= (order.review?.rating || 0) ? "fa-solid" : "fa-regular text-gray-300"}`}></i>
                        ))}
                      </div>
                    </div>
                    {renderOrderItems(order)}
                    {order.review?.text && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-xl text-gray-700 text-sm">
                        &quot;{order.review.text}&quot;
                      </div>
                    )}
                    <div className="mt-5 flex justify-end">
                      <Link href={`/orders/${order.id}`} className="text-[#16A085] px-4 py-2 text-sm font-bold hover:bg-[#D4F1BB]/30 rounded-xl transition">
                        ดูรายละเอียด
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
