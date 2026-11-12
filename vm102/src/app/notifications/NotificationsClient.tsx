"use client";

import { useState, useEffect } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import { formatRelativeTime } from "@/lib/utils";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { notificationApi, type NotificationDto } from "@/lib/api";
import { useBadge } from "@/lib/badge-context";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

const typeIcons: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  ORDER_STATUS: { icon: "fa-solid fa-box", color: "text-vru-orange", bg: "bg-orange-50", label: "สถานะคำสั่งซื้อ" },
  DISPUTE_RESULT: { icon: "fa-solid fa-gavel", color: "text-red-500", bg: "bg-red-50", label: "ผลการพิพาท" },
  PRODUCT_APPROVED: { icon: "fa-solid fa-check-circle", color: "text-green-500", bg: "bg-green-50", label: "สินค้าได้รับอนุมัติ" },
  PRODUCT_REJECTED: { icon: "fa-solid fa-times-circle", color: "text-red-500", bg: "bg-red-50", label: "สินค้าไม่ผ่านการอนุมัติ" },
  SHOP_APPROVED: { icon: "fa-solid fa-store", color: "text-blue-500", bg: "bg-blue-50", label: "ร้านค้าได้รับอนุมัติ" },
  COUPON_EXPIRING_WARNING: { icon: "fa-solid fa-ticket", color: "text-amber-500", bg: "bg-amber-50", label: "โค้ดส่วนลดใกล้หมดอายุ" },
  CHAT_MESSAGE: { icon: "fa-regular fa-message", color: "text-indigo-500", bg: "bg-indigo-50", label: "ข้อความแชทใหม่" },
  GENERAL: { icon: "fa-solid fa-bell", color: "text-gray-500", bg: "bg-gray-100", label: "การแจ้งเตือน" },
};

export default function NotificationsClient() {
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { refreshNotifications, markNotificationsAsReadLocally } = useBadge();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
      return;
    }
    if (!authLoading && isAuthenticated) {
      notificationApi.list()
        .then(res => {
          setNotifications(res.items || []);
        })
        .catch(() => {
          setNotifications([]);
        })
        .finally(() => setIsLoading(false));
    }
  }, [authLoading, isAuthenticated, router, user?.id]);

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      markNotificationsAsReadLocally();
    } catch {
      // Ignored
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await notificationApi.markRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n));
      refreshNotifications();
    } catch {
      // Ignored
    }
  };

  const unreadCount = notifications.filter(n => !n.readAt).length;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header />
      <main className="flex-grow w-full max-w-3xl mx-auto px-3 sm:px-4 pt-3 sm:pt-6 pb-24 md:pb-12">
        <Breadcrumb items={[{ label: "การแจ้งเตือน" }]} />

        <div className="flex items-center justify-between gap-2 mb-4 sm:mb-6">
          <div className="flex items-center gap-2 min-w-0">
            <i className="fa-regular fa-bell text-vru-orange text-lg sm:text-2xl flex-shrink-0"></i>
            <h2 className="text-lg sm:text-2xl font-bold text-gray-800 whitespace-nowrap">
              การแจ้งเตือน
            </h2>
            {unreadCount > 0 && (
              <span className="bg-vru-orange text-white text-xs sm:text-sm font-bold px-2 sm:px-2.5 py-0.5 rounded-full flex-shrink-0">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs sm:text-sm text-[#16A085] hover:text-[#117A65] font-bold hover:underline flex-shrink-0 whitespace-nowrap active:scale-95 cursor-pointer py-1"
            >
              <i className="fa-solid fa-check-double mr-1 sm:hidden"></i>
              <span className="hidden sm:inline">ทำเครื่องหมายว่า</span>อ่านทั้งหมด
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-3">
            <i className="fa-solid fa-spinner fa-spin text-2xl text-[#16A085]"></i>
            <p className="font-bold">กำลังโหลดการแจ้งเตือน...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center flex flex-col items-center justify-center py-32 text-gray-400">
            <i className="fa-regular fa-bell-slash text-6xl mb-4 block text-gray-300"></i>
            <p className="font-bold text-gray-600 text-lg">ยังไม่มีการแจ้งเตือน</p>
            <p className="text-sm mt-1">ระบบจะแจ้งเตือนเมื่อมีการอัปเดตคำสั่งซื้อหรือข้อความใหม่</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {notifications.map((notif) => {
              const style = typeIcons[notif.type] || typeIcons.GENERAL;
              return (
                <div
                  key={notif.id}
                  onClick={() => !notif.readAt && handleMarkRead(notif.id)}
                  className={`bg-white rounded-2xl shadow-xs border p-3.5 sm:p-4 flex gap-3 sm:gap-4 transition hover:shadow-md cursor-pointer ${notif.readAt ? "border-gray-100" : "border-vru-orange/40 bg-orange-50/20"}`}
                >
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full ${style.bg} flex items-center justify-center flex-shrink-0 text-sm sm:text-base`}>
                    <i className={`${style.icon} ${style.color}`}></i>
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <h4 className="font-bold text-gray-800 text-xs sm:text-sm">{style.label}</h4>
                      {!notif.readAt && <span className="w-2 h-2 bg-vru-orange rounded-full flex-shrink-0"></span>}
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 line-clamp-2 leading-relaxed">{notif.message}</p>
                    {notif.type === "COUPON_EXPIRING_WARNING" && (
                      <div className="mt-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!notif.readAt) handleMarkRead(notif.id);
                            router.push("/coupons");
                          }}
                          className="text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full transition flex items-center gap-1.5 w-fit active:scale-95 cursor-pointer shadow-2xs"
                        >
                          <i className="fa-solid fa-basket-shopping text-amber-600"></i> ไปเลือกซื้อสินค้าเลย
                        </button>
                      </div>
                    )}
                    {notif.type === "CHAT_MESSAGE" && (
                      <div className="mt-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!notif.readAt) handleMarkRead(notif.id);
                            router.push(user?.shopId ? "/seller/chat" : "/chat");
                          }}
                          className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-full transition flex items-center gap-1.5 w-fit active:scale-95 cursor-pointer shadow-2xs"
                        >
                          <i className="fa-regular fa-message text-indigo-600"></i> ไปที่ห้องแชท
                        </button>
                      </div>
                    )}
                    <span className="text-[11px] sm:text-xs text-gray-400 mt-2 block">{formatRelativeTime(notif.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
