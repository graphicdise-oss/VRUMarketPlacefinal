"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { shopApi, MyShopDto, sellerOrderApi, shopAnalyticsApi, ShopStatsDto, OrderDto, communityApi, couponApi } from "@/lib/api";
import { FadeIn, StaggeredGrid } from "@/components/ui/Animations";
import { useBadge } from "@/lib/badge-context";

const menuItems = [
  { label: "จัดการคำสั่งซื้อ", desc: "ใส่ค่าส่ง ยืนยันเงินเข้า กดจัดส่ง", icon: "fa-solid fa-box", href: "/seller/orders", color: "text-[#16A085]", bg: "bg-[#16A085]/10" },
  { label: "จัดการสินค้า", desc: "เพิ่ม แก้ไข ตัวเลือก และดูสถานะ", icon: "fa-solid fa-tags", href: "/seller/products", color: "text-blue-500", bg: "bg-blue-50" },
  { label: "เพิ่มสินค้าใหม่", desc: "สร้างรายการสินค้าพร้อมตัวเลือก", icon: "fa-solid fa-plus", href: "/seller/products/new", color: "text-[#16A085]", bg: "bg-[#D4F1BB]/30" },
  { label: "โค้ดส่วนลดของร้าน", desc: "สร้างคูปองส่วนลดแบบบาทและ %", icon: "fa-solid fa-ticket", href: "/seller/coupons", color: "text-amber-500", bg: "bg-amber-50" },
  { label: "ตั้งค่าร้านค้า", desc: "แก้ไขข้อมูลร้าน ช่องทางชำระเงิน", icon: "fa-solid fa-gear", href: "/seller/settings", color: "text-gray-500", bg: "bg-gray-100" },
  { label: "ข้อความจากลูกค้า", desc: "แชทตอบคำถามลูกค้า", icon: "fa-regular fa-message", href: "/seller/chat", color: "text-indigo-500", bg: "bg-indigo-50" },
];

export default function SellerDashboardClient() {
  const { unreadChat, refreshChat } = useBadge();
  const [orderFilter, setOrderFilter] = useState("ALL");
  const [shop, setShop] = useState<MyShopDto | null>(null);
  const [communityName, setCommunityName] = useState<string>("");
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [statsData, setStatsData] = useState<ShopStatsDto | null>(null);
  const [expiringCouponsCount, setExpiringCouponsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    refreshChat();
    Promise.all([
      shopApi.getMine().catch(() => null),
      sellerOrderApi.list().catch(() => ({ items: [] })),
      shopAnalyticsApi.getSummary().catch(() => null),
      couponApi.getShopCoupons().catch(() => [])
    ]).then(async ([shopRes, ordersRes, statsRes, couponsRes]) => {
      if (shopRes) {
        setShop(shopRes);
        if (shopRes.communityId) {
          const comm = await communityApi.getById(shopRes.communityId).catch(() => null);
          if (comm) setCommunityName(comm.name);
        }
      }
      if (ordersRes) setOrders(ordersRes.items);
      if (statsRes) setStatsData(statsRes);
      if (couponsRes) {
        const nowMs = Date.now();
        const expiringCount = couponsRes.filter(c => {
          if (!c.isActive) return false;
          const end = new Date(c.endDate).getTime();
          const diffDays = (end - nowMs) / (1000 * 60 * 60 * 24);
          return diffDays > 0 && diffDays <= 7;
        }).length;
        setExpiringCouponsCount(expiringCount);
      }
      setIsLoading(false);
    });
  }, [refreshChat]);

  const actionRequiredStats = [
    { label: "ใส่ค่าจัดส่ง", value: statsData?.awaitingShippingFeeCount?.toString() || "0", icon: "fa-solid fa-truck", color: "text-orange-500", bg: "bg-orange-50", link: "/seller/orders?filter=PENDING_SHIPPING_FEE" },
    { label: "ยืนยันเงินเข้า", value: statsData?.awaitingPaymentConfirmCount?.toString() || "0", icon: "fa-solid fa-money-check-dollar", color: "text-blue-500", bg: "bg-blue-50", link: "/seller/orders?filter=PENDING_PAYMENT" },
    { label: "รอจัดส่ง", value: statsData?.awaitingShipmentCount?.toString() || "0", icon: "fa-solid fa-box", color: "text-[#16A085]", bg: "bg-[#D4F1BB]/30", link: "/seller/orders?filter=PAID" },
    { label: "ข้อพิพาท/คืนเงิน", value: ((statsData?.pendingRefundCount || 0) + (statsData?.actionableDisputeCount || 0)).toString(), icon: "fa-solid fa-scale-balanced", color: "text-red-500", bg: "bg-red-50", link: "/seller/orders" },
  ];

  const pendingOthersStats = [
    { label: "รอผู้ซื้อโอน", value: statsData?.awaitingBuyerPaymentCount?.toString() || "0", icon: "fa-solid fa-clock", color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "รอกดรับของ", value: statsData?.awaitingBuyerReceiveCount?.toString() || "0", icon: "fa-solid fa-hand-holding-box", color: "text-indigo-500", bg: "bg-indigo-50" },
    { label: "ถูกแช่แข็ง", value: statsData?.frozenOrderCount?.toString() || "0", icon: "fa-solid fa-snowflake", color: "text-cyan-500", bg: "bg-cyan-50" },
  ];

  const productStats = [
    { label: "ขายอยู่", value: statsData?.activeProductCount?.toString() || "0", icon: "fa-solid fa-store", color: "text-[#16A085]", bg: "bg-[#16A085]/10" },
    { label: "รอตรวจ", value: statsData?.pendingProductCount?.toString() || "0", icon: "fa-solid fa-hourglass-half", color: "text-purple-500", bg: "bg-purple-50" },
    { label: "ถูกปฏิเสธ", value: statsData?.rejectedProductCount?.toString() || "0", icon: "fa-solid fa-ban", color: "text-red-500", bg: "bg-red-50" },
  ];

  const filteredOrders = orders.filter(order => {
    if (orderFilter === "ALL") return true;
    if (orderFilter === "PENDING_SHIPPING_FEE") return order.displayStatus === "AWAITING_SHIPPING_QUOTE";
    if (orderFilter === "PENDING_PAYMENT") return order.displayStatus === "PAYMENT_SUBMITTED";
    if (orderFilter === "SHIPPED") return order.displayStatus === "SHIPPED";
    return order.displayStatus === orderFilter;
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex flex-col">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-xl"></div>
              <div className="h-6 bg-gray-200 rounded w-32"></div>
            </div>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-8 md:py-10 w-full animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-40 mb-8"></div>
          {/* Shop Banner Skeleton */}
          <div className="bg-white rounded-3xl p-8 md:p-10 mb-8 shadow-sm border border-gray-100 flex gap-6">
            <div className="w-24 h-24 bg-gray-200 rounded-2xl flex-shrink-0"></div>
            <div className="flex flex-col gap-3 justify-center w-full">
              <div className="h-8 bg-gray-200 rounded w-1/3"></div>
              <div className="h-6 bg-gray-200 rounded w-1/4 mt-2"></div>
            </div>
          </div>
          {/* Action Required Skeleton */}
          <div className="h-6 bg-gray-200 rounded w-48 mb-4 mt-10"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-3xl p-6 border border-gray-100 h-32"></div>
            ))}
          </div>
          {/* Sales Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-10">
            <div className="bg-gray-200 rounded-3xl h-36"></div>
            <div className="bg-white rounded-3xl border border-gray-100 h-36"></div>
            <div className="bg-white rounded-3xl border border-gray-100 h-36"></div>
          </div>
        </main>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex flex-col items-center justify-center p-4 text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center text-4xl mb-6">
          <i className="fa-solid fa-store-slash"></i>
        </div>
        <h2 className="text-2xl font-black text-gray-800 mb-2">ไม่พบข้อมูลร้านค้าของคุณ</h2>
        <p className="text-gray-500 mb-8 max-w-md">คุณยังไม่ได้เปิดร้านค้า หรือคำขอเปิดร้านของคุณถูกปฏิเสธ หากคุณต้องการเปิดร้านค้า กรุณาไปที่หน้าลงทะเบียนเปิดร้าน</p>
        <Link href="/register-shop" className="bg-[#16A085] hover:bg-[#12876f] text-white px-8 py-3 rounded-full font-bold transition-all shadow-md">
          ลงทะเบียนเปิดร้านค้า
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/seller" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-sm">
              <i className="fa-solid fa-shop text-xl"></i>
            </div>
            <h1 className="text-xl font-black tracking-tight text-gray-800">VRU <span className="text-[#16A085]">Seller</span></h1>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href={`/shops/${shop.id}`} target="_blank" className="text-xs sm:text-sm font-bold text-[#16A085] bg-white border border-[#16A085]/30 hover:bg-[#16A085]/10 px-3.5 py-2 rounded-full transition-all flex items-center gap-1.5 shadow-sm">
              <i className="fa-solid fa-arrow-up-right-from-square"></i> ดูหน้าร้านของฉัน
            </Link>
            <Link href="/" className="text-xs sm:text-sm font-bold text-gray-500 hover:text-[#16A085] bg-gray-50 hover:bg-[#D4F1BB]/30 px-3.5 py-2 rounded-full transition-all flex items-center gap-1.5">
              <i className="fa-solid fa-house"></i> หน้าแรก
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-10">
        <Breadcrumb items={[{ label: "Seller Center" }]} />
        
        {/* Shop Status Banner */}
        {shop.approvalStatus === "PENDING" && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-2xl mb-6 flex items-start gap-4 shadow-sm">
            <i className="fa-solid fa-clock text-2xl text-yellow-500 mt-1"></i>
            <div>
              <h4 className="font-bold text-lg mb-1">ร้านค้าของคุณอยู่ระหว่างรอการอนุมัติ</h4>
              <p className="text-sm">ผู้ดูแลชุมชนกำลังพิจารณาคำขอเปิดร้านของคุณ คุณสามารถเตรียมเพิ่มสินค้าไว้ก่อนได้ แต่สินค้าจะยังไม่แสดงในหน้าเว็บจนกว่าร้านจะได้รับการอนุมัติ</p>
            </div>
          </div>
        )}

        {/* Shop Info */}
        <FadeIn direction="up">
          <div className="bg-gradient-bg rounded-3xl p-8 md:p-10 text-gray-800 mb-8 shadow-sm border border-gray-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <i className="fa-solid fa-store text-9xl"></i>
            </div>
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10">
              <div className="w-24 h-24 bg-white rounded-2xl flex items-center justify-center text-[#16A085] shadow-sm border-4 border-white flex-shrink-0">
                {shop.hasLogo ? (
                  <img src={`/api/v1/shops/${shop.id}/logo`} alt={shop.name} className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <i className="fa-solid fa-store text-4xl"></i>
                )}
              </div>
              <div className="text-center sm:text-left flex-grow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                  <h2 className="text-3xl font-black">{shop.name}</h2>
                  <Link 
                    href={`/shops/${shop.id}`}
                    target="_blank"
                    className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-[#16A085] bg-white px-4 py-2 rounded-full border border-[#16A085]/30 hover:bg-[#16A085] hover:text-white transition-all shadow-sm w-fit mx-auto sm:mx-0"
                  >
                    <i className="fa-solid fa-eye"></i> ดูหน้าร้านค้าในมุมมองลูกค้า ↗
                  </Link>
                </div>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-sm">
                  <span className="font-bold text-gray-600 bg-white/60 px-3 py-1.5 rounded-full shadow-sm">
                    <i className="fa-solid fa-layer-group mr-1.5 text-[#16A085]"></i> {communityName || "วิสาหกิจชุมชน"}
                  </span>
                  
                  {shop.approvalStatus === "APPROVED" && (
                    <span className="bg-[#16A085] text-white px-3 py-1.5 rounded-full font-bold shadow-sm"><i className="fa-solid fa-check mr-1.5"></i> อนุมัติแล้ว</span>
                  )}
                  {shop.approvalStatus === "PENDING" && (
                    <span className="bg-yellow-500 text-white px-3 py-1.5 rounded-full font-bold shadow-sm"><i className="fa-solid fa-clock mr-1.5"></i> รออนุมัติ</span>
                  )}
                  {shop.approvalStatus === "REJECTED" && (
                    <span className="bg-red-500 text-white px-3 py-1.5 rounded-full font-bold shadow-sm"><i className="fa-solid fa-xmark mr-1.5"></i> ถูกปฏิเสธ</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* 1. Action Required Stats */}
        <FadeIn delay={0.1}>
          <h3 className="font-black text-gray-800 text-xl mb-4 flex items-center gap-2">
            <i className="fa-solid fa-clipboard-list text-orange-500"></i> สิ่งที่ต้องทำ (Action Required)
          </h3>
          <StaggeredGrid className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8" staggerDelay={0.05}>
            {actionRequiredStats.map((stat) => (
              <FadeIn key={stat.label} direction="up">
                <Link href={stat.link} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all group block h-full">
                  <div className={`w-12 h-12 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center text-2xl mb-4 shadow-sm group-hover:scale-110 transition-transform`}>
                    <i className={`${stat.icon}`}></i>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-4xl font-black text-gray-800 leading-none mb-1">{stat.value}</span>
                    <span className="text-xs font-bold text-gray-500">{stat.label}</span>
                  </div>
                </Link>
              </FadeIn>
            ))}
          </StaggeredGrid>
        </FadeIn>

        {/* 2. Pending & Products Stats */}
        <StaggeredGrid className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10" staggerDelay={0.1}>
          <FadeIn direction="up">
            <h3 className="font-black text-gray-800 text-lg mb-4 flex items-center gap-2">
              <i className="fa-solid fa-spinner text-indigo-500"></i> รอคนอื่น (Pending)
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {pendingOthersStats.map((stat) => (
                <div key={stat.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-center hover:shadow-md transition-shadow">
                  <div className={`w-10 h-10 mx-auto rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center text-lg mb-2 shadow-sm`}>
                    <i className={`${stat.icon}`}></i>
                  </div>
                  <div className="text-2xl font-black text-gray-800 leading-none mb-1">{stat.value}</div>
                  <div className="text-[10px] font-bold text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </FadeIn>
          <FadeIn direction="up">
            <h3 className="font-black text-gray-800 text-lg mb-4 flex items-center gap-2">
              <i className="fa-solid fa-box-open text-[#16A085]"></i> สินค้าของร้าน (Products)
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {productStats.map((stat) => (
                <div key={stat.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-center hover:shadow-md transition-shadow">
                  <div className={`w-10 h-10 mx-auto rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center text-lg mb-2 shadow-sm`}>
                    <i className={`${stat.icon}`}></i>
                  </div>
                  <div className="text-2xl font-black text-gray-800 leading-none mb-1">{stat.value}</div>
                  <div className="text-[10px] font-bold text-gray-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </FadeIn>
        </StaggeredGrid>

        {/* 3. Sales & Reviews & Followers */}
        <StaggeredGrid className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-10" staggerDelay={0.1}>
          <FadeIn direction="left">
            <div className="bg-gradient-to-br from-[#16A085] to-[#12876f] rounded-3xl p-6 md:p-8 text-white shadow-md relative overflow-hidden h-full flex flex-col justify-center">
              <div className="absolute right-0 bottom-0 opacity-10">
                <i className="fa-solid fa-chart-line text-8xl -mb-4 -mr-4"></i>
              </div>
              <h3 className="font-bold text-white/80 mb-2 flex items-center gap-2 text-sm relative z-10">
                <i className="fa-solid fa-wallet"></i> ยอดขาย (หักรายการคืนเงิน)
              </h3>
              <div className="text-4xl md:text-5xl font-black mb-1 relative z-10">
                ฿{statsData?.totalSales?.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
              </div>
            </div>
          </FadeIn>
          <FadeIn direction="right">
            <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm flex items-center h-full">
              <div className="flex-1">
                <h3 className="font-bold text-gray-500 mb-2 flex items-center gap-2 text-sm">
                  <i className="fa-solid fa-star text-yellow-400"></i> คะแนนรีวิวร้านค้า
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-black text-gray-800">{statsData?.reviewAverage?.toFixed(1) || "0.0"}</span>
                  <span className="text-gray-500 font-bold">/ 5.0</span>
                </div>
                <p className="text-sm text-gray-400 font-medium mt-1">จาก {statsData?.reviewCount || 0} รีวิวทั้งหมด</p>
              </div>
            </div>
          </FadeIn>
          <FadeIn direction="up">
            <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm flex items-center h-full">
              <div className="flex-1">
                <h3 className="font-bold text-gray-500 mb-2 flex items-center gap-2 text-sm">
                  <i className="fa-solid fa-users text-blue-500"></i> ผู้ติดตามร้านค้า
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-black text-gray-800">{statsData?.followerCount || 0}</span>
                  <span className="text-gray-500 font-bold">คน</span>
                </div>
                <p className="text-sm text-gray-400 font-medium mt-1">ลูกค้ารอรับข่าวสารจากคุณ</p>
              </div>
            </div>
          </FadeIn>
        </StaggeredGrid>

        {/* Menu Grid */}
        <div className="mb-10">
          <h3 className="font-black text-gray-800 text-xl mb-6 flex items-center gap-2">
            <i className="fa-solid fa-layer-group text-gray-400"></i> เมนูการจัดการร้านค้า
          </h3>
          <StaggeredGrid className="grid grid-cols-1 md:grid-cols-2 gap-5" staggerDelay={0.05}>
            {menuItems.map((item) => (
              <FadeIn key={item.label} direction="up">
                <Link href={item.href} className="relative bg-white rounded-3xl shadow-sm border border-gray-100 p-6 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:border-[#16A085]/30 transition-all group flex items-center gap-5 h-full">
                  {item.href === "/seller/coupons" && expiringCouponsCount > 0 && (
                    <div className="absolute top-3 right-4 bg-amber-50 text-amber-700 border border-amber-200/80 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                      <i className="fa-solid fa-clock text-amber-500 text-[11px]"></i>
                      <span>ใกล้หมดอายุ {expiringCouponsCount} โค้ด</span>
                    </div>
                  )}
                  {item.href === "/seller/chat" && unreadChat > 0 && (
                    <div className="absolute top-3 right-4 bg-indigo-50 text-indigo-700 border border-indigo-200/80 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                      <i className="fa-solid fa-comment-dots text-indigo-500 text-[11px]"></i>
                      <span>ข้อความใหม่ {unreadChat > 99 ? "99+" : unreadChat} ข้อความ</span>
                    </div>
                  )}
                  <div className={`w-16 h-16 ${item.bg} rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform shadow-inner`}>
                    <i className={`${item.icon} ${item.color} text-2xl`}></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-800 text-lg group-hover:text-[#16A085] transition-colors">{item.label}</h4>
                    <p className="text-sm text-gray-500 font-medium mt-1 leading-relaxed">{item.desc}</p>
                  </div>
                  <div className="ml-auto w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-[#16A085] group-hover:text-white transition-all shadow-sm">
                    <i className="fa-solid fa-chevron-right text-xs"></i>
                  </div>
                </Link>
              </FadeIn>
            ))}
          </StaggeredGrid>
        </div>

        {/* Recent Orders Mockup */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="font-black text-gray-800 text-xl flex items-center gap-2">
              <i className="fa-solid fa-receipt text-gray-400"></i> ออเดอร์ล่าสุด
            </h3>
            <div className="flex gap-2">
              <select 
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                className="input-minimal bg-white border-gray-200 text-sm py-2 px-4 rounded-full outline-none focus:border-[#16A085] shadow-sm"
              >
                <option value="ALL">ทุกสถานะ</option>
                <option value="PENDING_SHIPPING_FEE">รอใส่ค่าจัดส่ง</option>
                <option value="PENDING_PAYMENT">รอแจ้งโอน</option>
                <option value="SHIPPED">จัดส่งแล้ว</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-5">รหัสคำสั่งซื้อ</th>
                    <th className="px-6 py-5">ลูกค้า</th>
                    <th className="px-6 py-5">วันที่</th>
                    <th className="px-6 py-5">ยอดรวม</th>
                    <th className="px-6 py-5">สถานะ</th>
                    <th className="px-6 py-5 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredOrders.length > 0 ? filteredOrders.map(order => (
                    <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-5 font-bold text-gray-800 font-mono">{order.id.slice(0, 8)}...</td>
                      <td className="px-6 py-5 text-gray-600 font-medium">{order.recipientName}</td>
                      <td className="px-6 py-5 text-gray-500">{new Date(order.createdAt).toLocaleDateString("th-TH")}</td>
                      <td className="px-6 py-5 font-bold text-[#16A085]">
                        {order.totalAmountMinor !== null ? `฿${(order.totalAmountMinor / 100).toFixed(2)}` : "รอระบุค่าส่ง"}
                      </td>
                      <td className="px-6 py-5">
                        {order.displayStatus === "AWAITING_SHIPPING_QUOTE" && <span className="bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full font-bold text-[10px]">รอใส่ค่าส่ง</span>}
                        {order.displayStatus === "AWAITING_PAYMENT" && <span className="bg-yellow-50 text-yellow-600 px-3 py-1.5 rounded-full font-bold text-[10px]">รอชำระเงิน</span>}
                        {order.displayStatus === "PAYMENT_SUBMITTED" && <span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-bold text-[10px]">รอแจ้งโอน</span>}
                        {order.displayStatus === "PAID" && <span className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-bold text-[10px]">รอจัดส่ง</span>}
                        {order.displayStatus === "SHIPPED" && <span className="bg-green-50 text-green-600 px-3 py-1.5 rounded-full font-bold text-[10px]">จัดส่งแล้ว</span>}
                        {order.displayStatus === "COMPLETED" && <span className="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full font-bold text-[10px]">สำเร็จ</span>}
                        {order.displayStatus === "CANCELLED" && <span className="bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-bold text-[10px]">ยกเลิก</span>}
                      </td>
                      <td className="px-6 py-5 text-center">
                        <Link href={`/seller/orders/${order.id}`} className="text-[#16A085] bg-[#D4F1BB]/30 hover:bg-[#16A085] hover:text-white px-4 py-2 rounded-lg font-bold text-xs transition-colors">ดูรายละเอียด</Link>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-gray-400 font-medium">ไม่พบออเดอร์ในสถานะนี้</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Important Notice */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-3xl p-6 md:p-8">
          <h4 className="font-black text-yellow-800 mb-4 flex items-center gap-2 text-lg">
            <i className="fa-solid fa-triangle-exclamation text-yellow-500 text-2xl"></i> ข้อควรระวังและสิ่งที่ต้องทราบ
          </h4>
          <ul className="text-sm text-yellow-700 space-y-3 font-medium">
            <li className="flex items-start gap-2">
              <i className="fa-solid fa-circle text-[6px] mt-1.5 text-yellow-500"></i>
              <span>ร้านค้าต้อง <b className="text-yellow-800">ตั้งค่าช่องทางชำระเงิน</b> (QR Code / เลขบัญชีธนาคาร) ในเมนูตั้งค่าร้านค้า ก่อนเปิดรับคำสั่งซื้อใหม่</span>
            </li>
            <li className="flex items-start gap-2">
              <i className="fa-solid fa-circle text-[6px] mt-1.5 text-yellow-500"></i>
              <span>เมื่อมีคำสั่งซื้อใหม่ ร้านค้าต้อง <b className="text-yellow-800">ระบุค่าจัดส่งภายใน 24 ชม.</b> มิฉะนั้นระบบจะยกเลิกคำสั่งซื้ออัตโนมัติ</span>
            </li>
            <li className="flex items-start gap-2">
              <i className="fa-solid fa-circle text-[6px] mt-1.5 text-yellow-500"></i>
              <span>การแก้ไขข้อมูลสำคัญเช่น ชื่อ รูปภาพ หรือคำอธิบายสินค้า จะทำให้สินค้านั้น <b className="text-yellow-800">ถูกซ่อนจากหน้าร้านชั่วคราว</b> จนกว่าผู้ดูแลระบบจะอนุมัติซ้ำ</span>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}

