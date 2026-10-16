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
      <main className="flex-grow w-full max-w-3xl mx-auto px-4 py-6">
        <Breadcrumb items={[{ label: "การแจ้งเตือน" }]} />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">
            <i className="fa-regular fa-bell text-vru-orange mr-2"></i>
            การแจ้งเตือน
            {unreadCount > 0 && (
              <span className="ml-2 bg-vru-orange text-white text-sm font-bold px-2.5 py-0.5 rounded-full">{unreadCount}</span>
            )}
          </h2>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm text-[#16A085] font-bold hover:underline"
            >
              ทำเครื่องหมายว่าอ่านทั้งหมด
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
                  className={`bg-white rounded-xl shadow-sm border p-4 flex gap-4 transition hover:shadow-md cursor-pointer ${notif.readAt ? "border-gray-100" : "border-vru-orange bg-orange-50/30"}`}
                >
                  <div className={`w-10 h-10 rounded-full ${style.bg} flex items-center justify-center flex-shrink-0`}>
                    <i className={`${style.icon} ${style.color}`}></i>
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold text-gray-800 text-sm">{style.label}</h4>
                      {!notif.readAt && <span className="w-2 h-2 bg-vru-orange rounded-full flex-shrink-0"></span>}
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2">{notif.message}</p>
                    {notif.type === "COUPON_EXPIRING_WARNING" && (
                      <div className="mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!notif.readAt) handleMarkRead(notif.id);
                            router.push("/shops");
                          }}
                          className="text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1 rounded-full transition flex items-center gap-1.5 w-fit"
                        >
                          <i className="fa-solid fa-basket-shopping text-amber-600"></i> ไปเลือกซื้อสินค้าเลย
                        </button>
                      </div>
                    )}
                    {notif.type === "CHAT_MESSAGE" && (
                      <div className="mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!notif.readAt) handleMarkRead(notif.id);
                            router.push(user?.shopId ? "/seller/chat" : "/chat");
                          }}
                          className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1 rounded-full transition flex items-center gap-1.5 w-fit"
                        >
                          <i className="fa-regular fa-message text-indigo-600"></i> ไปที่ห้องแชท
                        </button>
                      </div>
                    )}
                    <span className="text-xs text-gray-400 mt-1.5 block">{formatRelativeTime(notif.createdAt)}</span>
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
