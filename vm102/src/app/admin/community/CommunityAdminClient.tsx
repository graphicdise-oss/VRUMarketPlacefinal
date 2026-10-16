"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import CustomSelect from "@/components/ui/CustomSelect";
import { adminShopApi, ShopAdminDto, adminProductApi, ProductDto, shopApi, disputeAdminApi, DisputeAdminDto, adminDashboardApi, AdminDashboardDto, adminFrozenOrderApi, FrozenOrderQueueItemDto } from "@/lib/api";
import { PublicShopDto } from "@/lib/api-modules/shop";
import { getErrorMessage, formatPrice } from "@/lib/utils";

/** One shop row/modal view shared by the pending (ShopAdminDto) and active (public) lists. */
interface ShopView {
  id: string;
  name: string;
  createdAt: string;
  status: "PENDING" | "ACTIVE";
  communityName?: string;
  details?: string | null;
  address?: string;
  ownerName?: string;
  ownerEmail?: string;
  paymentBank?: string;
  paymentAccount?: string;
  paymentName?: string;
  followerCount?: number;
  /** The original admin DTO — present only for pending shops, needed for approve/reject (reviewRevision). */
  pending?: ShopAdminDto;
}

const pendingShopToView = (s: ShopAdminDto): ShopView => ({
  id: s.id,
  name: s.name,
  createdAt: s.createdAt,
  status: "PENDING",
  details: s.description,
  ownerName: s.ownerEmail,
  ownerEmail: s.ownerEmail,
  followerCount: s.followerCount,
  pending: s,
});

/** A pending product as the moderation queue shows it. `status`/`shopName`/`pendingOrdersCount` are optional extras the backend may add. */
type PendingProductRow = ProductDto & {
  status?: "NEW" | "EDITED" | "DELETE_REQUEST" | "PAUSE_REQUEST";
  shopName?: string;
  pendingOrdersCount?: number;
};

const formatProductPrice = (p: ProductDto): string => {
  if (p.variants.length === 0) return "-";
  const prices = p.variants.map((v) => v.priceAmountMinor);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `${formatPrice(min)} - ${formatPrice(max)}`;
};

type Tab = "dashboard" | "shops" | "products" | "disputes" | "frozen";

const tabs: { value: Tab; label: string; icon: string }[] = [
  { value: "dashboard", label: "แดชบอร์ด", icon: "fa-solid fa-chart-line" },
  { value: "shops", label: "จัดการร้านค้า", icon: "fa-solid fa-store" },
  { value: "products", label: "จัดการสินค้า", icon: "fa-solid fa-tags" },
  { value: "disputes", label: "ข้อพิพาท", icon: "fa-solid fa-gavel" },

  { value: "frozen", label: "ออเดอร์แช่แข็ง", icon: "fa-solid fa-snowflake" },
];

export default function CommunityAdminClient() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const isCommunityAdmin = !!user?.adminCommunityIds && user.adminCommunityIds.length > 0;
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const hasAccess = isCommunityAdmin || isSuperAdmin;

  useEffect(() => {
    if (!isAuthLoading && (!user || !hasAccess)) {
      router.replace("/login?callbackUrl=/admin/community");
    }
  }, [user, isAuthLoading, hasAccess, router]);

  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Dashboard Filters
  const [timeFilter, setTimeFilter] = useState("WEEK");
  const [selectedShop, setSelectedShop] = useState("ALL");

  const [analyticsData, setAnalyticsData] = useState<AdminDashboardDto | null>(null);

  // Dynamic Data computation based on real API
  const queues = analyticsData?.queues || {
    pendingShopApprovals: 0, pendingShopEdits: 0, pendingProductChecks: 0, openDisputes: 0, frozenOrders: 0
  };
  const overview = analyticsData?.overview || {
    activeShops: 0, suspendedShops: 0, bannedOwners: 0, activeProducts: 0, ordersByStatus: {}
  };
  const sales = analyticsData?.sales || {
    totalSales: 0, trend: []
  };

  const dynamicTrendData = sales.trend;
  
  const displaySales = sales.totalSales;
  const displayActiveShops = overview.activeShops;
  const displayActiveProducts = overview.activeProducts;

  useEffect(() => {
    // Only fetch analytics if we are on the dashboard tab and authorized
    if (activeTab === "dashboard" && hasAccess && user) {
      adminDashboardApi.getDashboard(selectedShop, timeFilter).then(data => {
        setAnalyticsData(data);
      }).catch((e: unknown) => {
        if ((e as { statusCode?: number })?.statusCode !== 401) {
          console.error("Failed to load community dashboard:", e);
        }
      });
    }
  }, [activeTab, timeFilter, selectedShop, hasAccess, user]);

  
  const [pendingShops, setPendingShops] = useState<ShopAdminDto[]>([]);
  const [activeShops, setActiveShops] = useState<ShopView[]>([]);
  const [pendingProducts, setPendingProducts] = useState<PendingProductRow[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [disputes, setDisputes] = useState<DisputeAdminDto[]>([]);
  const [isLoadingDisputes, setIsLoadingDisputes] = useState(false);
  
  const [frozenOrders, setFrozenOrders] = useState<FrozenOrderQueueItemDto[]>([]);
  const [isLoadingFrozenOrders, setIsLoadingFrozenOrders] = useState(false);

  // Modals
  const [viewShop, setViewShop] = useState<ShopView | null>(null);
  const [viewProduct, setViewProduct] = useState<PendingProductRow | null>(null);

  // Filters
  const [shopSearch, setShopSearch] = useState("");
  const [shopFilter, setShopFilter] = useState("PENDING");
  const [productFilter, setProductFilter] = useState("ALL");

  const filteredPendingShops = pendingShops.map(pendingShopToView).filter(s => (s.name?.includes(shopSearch) || s.ownerEmail?.includes(shopSearch)));
  const filteredActiveShops = activeShops.filter(s => (s.name.includes(shopSearch) || (s.ownerName ?? "").includes(shopSearch)));
  
  const currentShops = shopFilter === "PENDING" ? filteredPendingShops : filteredActiveShops;

  const filteredProducts = pendingProducts.filter(p => productFilter === "ALL" || p.moderationStatus === productFilter);

  const [isLoadingShops, setIsLoadingShops] = useState(false);

  useEffect(() => {
    if (!hasAccess || !user) return;

    if (activeTab === 'shops') {
      setIsLoadingShops(true);
      if (shopFilter === 'PENDING') {
        adminShopApi.getPending().then(res => {
          setPendingShops(res.items);
        }).catch(err => {
          if ((err as { statusCode?: number })?.statusCode !== 401) {
            console.error("Failed to fetch pending shops:", err);
          }
        }).finally(() => setIsLoadingShops(false));
      } else if (shopFilter === 'ACTIVE') {
        shopApi.listPublic().then(res => {
          // Map to match the expected format for activeShops
          const mapped = res.items.map((s): ShopView => ({
            id: s.id,
            name: s.name,
            ownerName: "Owner of " + s.name, // Mock ownerName since public list doesn't have it
            communityName: "Community",
            createdAt: s.createdAt,
            details: s.description || "ไม่มีรายละเอียด",
            address: "", // Need to fetch separately or ignore
            status: "ACTIVE",
            paymentBank: "-",
            paymentAccount: "-",
            paymentName: "-",
            followerCount: (s as PublicShopDto & { followerCount?: number }).followerCount || 0
          }));
          setActiveShops(mapped);
        }).catch(err => {
          if ((err as { statusCode?: number })?.statusCode !== 401) {
            console.error("Failed to fetch active shops:", err);
          }
        }).finally(() => setIsLoadingShops(false));
      }
    }
    if (activeTab === 'products') {
      setIsLoadingProducts(true);
      adminProductApi.getPending().then(res => {
        setPendingProducts(res.items.map((p): PendingProductRow => ({ ...p, status: "NEW" })));
      }).catch(err => {
        if ((err as { statusCode?: number })?.statusCode !== 401) {
          console.error("Failed to fetch pending products:", err);
        }
      }).finally(() => setIsLoadingProducts(false));
    }
    if (activeTab === 'disputes') {
      setIsLoadingDisputes(true);
      disputeAdminApi.getOpen().then(res => {
        setDisputes(res.items);
      }).catch(err => {
        if ((err as { statusCode?: number })?.statusCode !== 401) {
          console.error("Failed to fetch open disputes:", err);
        }
      }).finally(() => setIsLoadingDisputes(false));
    }
    if (activeTab === 'frozen') {
      setIsLoadingFrozenOrders(true);
      adminFrozenOrderApi.getQueue().then(res => {
        setFrozenOrders(res.items);
      }).catch(err => {
        if ((err as { statusCode?: number })?.statusCode !== 401) {
          console.error("Failed to fetch frozen orders:", err);
        }
      }).finally(() => setIsLoadingFrozenOrders(false));
    }
  }, [activeTab, shopFilter, hasAccess, user]);


  // Handlers
  const handleApproveShop = async (shop: ShopAdminDto) => {
    if(confirm(`ยืนยันการอนุมัติร้านค้า "${shop.name}"?`)) {
      try {
        await adminShopApi.approve(shop.id, shop.reviewRevision);
        setPendingShops(pendingShops.filter(s => s.id !== shop.id));
        alert("อนุมัติร้านค้าสำเร็จ");
        setViewShop(null);
      } catch (error) {
        alert("Error approving shop: " + getErrorMessage(error));
      }
    }
  };

  const handleRejectShop = async (shop: ShopAdminDto) => {
    const reason = prompt("กรุณาระบุเหตุผลการปฏิเสธ:");
    if(reason) {
      if (reason.length < 5) {
        alert("เหตุผลสั้นเกินไป กรุณาระบุให้ชัดเจน");
        return;
      }
      try {
        await adminShopApi.reject(shop.id, shop.reviewRevision, reason);
        setPendingShops(pendingShops.filter(s => s.id !== shop.id));
        alert("ปฏิเสธร้านค้าสำเร็จ");
        setViewShop(null);
      } catch (error) {
        alert("Error rejecting shop: " + getErrorMessage(error));
      }
    }
  };

  const handleSuspendShop = async (id: string) => {
    if(confirm("คำเตือน: การระงับร้านค้าจะทำให้ 'คำสั่งซื้อที่ค้างอยู่' ของร้านนี้ถูกแช่แข็ง (Freeze) ทันที\n\nยืนยันที่จะระงับร้านค้านี้หรือไม่?")) {
      const reason = prompt("กรุณาระบุเหตุผลการระงับ:");
      if (!reason) return;
      if (reason.length < 5) {
        alert("เหตุผลสั้นเกินไป");
        return;
      }
      try {
        await adminShopApi.suspend(id, reason);
        setActiveShops(activeShops.filter(s => s.id !== id));
        setViewShop(null);
        alert("ระงับร้านค้าและแช่แข็งคำสั่งซื้อเรียบร้อยแล้ว");
      } catch (err) {
        alert("Error suspending shop: " + getErrorMessage(err));
      }
    }
  };

  const handleRuleDispute = async (disputeId: string, verdict: "BUYER_WINS" | "SHOP_WINS") => {
    const reason = prompt(`กรุณาระบุเหตุผลในการตัดสินให้ ${verdict === "BUYER_WINS" ? "ผู้ซื้อ" : "ร้านค้า"} ชนะ:`);
    if (!reason) return;
    if (reason.length < 10) {
      alert("เหตุผลสั้นเกินไป กรุณาระบุให้ชัดเจน (อย่างน้อย 10 ตัวอักษร)");
      return;
    }
    if (confirm(`ยืนยันคำตัดสินให้ ${verdict === "BUYER_WINS" ? "ผู้ซื้อ" : "ร้านค้า"} ชนะ?\nการตัดสินนี้ไม่สามารถเปลี่ยนแปลงได้`)) {
      try {
        await disputeAdminApi.rule(disputeId, verdict, reason);
        setDisputes(disputes.filter(d => d.id !== disputeId));
        alert("บันทึกคำตัดสินเรียบร้อยแล้ว");
      } catch (err) {
        alert("Error ruling dispute: " + getErrorMessage(err));
      }
    }
  };

  const handleApproveProduct = async (product: PendingProductRow) => {
    if(confirm(`ยืนยันการอนุมัติสินค้า "${product.name}"?`)) {
      try {
        await adminProductApi.approve(product.id, product.reviewRevision);
        setPendingProducts(pendingProducts.filter(p => p.id !== product.id));
        setViewProduct(null);
        alert("อนุมัติสินค้าเรียบร้อยแล้ว");
      } catch (err) {
        alert("Error approving product: " + getErrorMessage(err));
      }
    }
  };

  const handleRuleFrozenOrder = async (orderId: string, verdict: 'RELEASE' | 'TERMINATE') => {
    const actionText = verdict === 'RELEASE' ? 'ปล่อยให้ดำเนินการต่อ (Release)' : 'ยกเลิก/คืนเงิน (Terminate)';
    const reason = prompt(`กรุณาระบุเหตุผลในการ ${actionText}:`);
    if (!reason) return;
    if (reason.length < 10) {
      alert("เหตุผลสั้นเกินไป กรุณาระบุให้ชัดเจน (อย่างน้อย 10 ตัวอักษร)");
      return;
    }
    if (confirm(`ยืนยันการตัดสินให้ ${actionText}?\nการตัดสินนี้ไม่สามารถเปลี่ยนแปลงได้`)) {
      try {
        await adminFrozenOrderApi.ruleFrozenOrder(orderId, { verdict, reason });
        setFrozenOrders(frozenOrders.filter(o => o.id !== orderId));
        alert("บันทึกคำตัดสินเรียบร้อยแล้ว");
      } catch (err) {
        alert("Error ruling frozen order: " + getErrorMessage(err));
      }
    }
  };

  const handleRejectProduct = async (product: PendingProductRow) => {
    const reason = prompt("กรุณาระบุเหตุผลการปฏิเสธ:");
    if(reason) {
      if (reason.length < 5) {
        alert("เหตุผลสั้นเกินไป กรุณาระบุให้ชัดเจน");
        return;
      }
      try {
        await adminProductApi.reject(product.id, product.reviewRevision, "PROHIBITED", reason);
        setPendingProducts(pendingProducts.filter(p => p.id !== product.id));
        setViewProduct(null);
        alert("ปฏิเสธสินค้าเรียบร้อยแล้ว");
      } catch (err) {
        alert("Error rejecting product: " + getErrorMessage(err));
      }
    }
  };

  if (isAuthLoading || !user || !hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-[#16A085]"></i>
          <p className="text-gray-500 font-bold">กำลังตรวจสอบสิทธิ์แอดมินชุมชน...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white shadow-sm">
              <i className="fa-solid fa-shield-halved text-xl"></i>
            </div>
            <h1 className="text-xl font-black tracking-tight text-gray-800">Community <span className="text-purple-600">Admin</span></h1>
          </Link>
          <Link href="/" className="text-sm font-bold text-gray-500 hover:text-purple-600 bg-gray-50 hover:bg-purple-50 px-4 py-2 rounded-full transition-all flex items-center gap-2">
            <i className="fa-solid fa-house"></i> กลับหน้าหลัก
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-10">
        <Breadcrumb items={[{ label: "Community Admin", href: "/admin/community" }]} />
        {/* Community Info */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-3xl p-8 md:p-10 text-white mb-8 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <i className="fa-solid fa-shield-halved text-9xl"></i>
          </div>
          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="w-24 h-24 bg-white/20 rounded-2xl flex items-center justify-center text-white shadow-sm border-4 border-white/30 backdrop-blur-sm flex-shrink-0">
              <i className="fa-solid fa-shield-halved text-4xl"></i>
            </div>
            <div className="text-center sm:text-left">
              <h2 className="text-3xl font-black mb-2 tracking-wide">ผู้ดูแลระบบชุมชนบ้านดง</h2>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-sm mb-4">
                <span className="font-bold bg-white/20 px-3 py-1.5 rounded-full shadow-sm"><i className="fa-solid fa-location-dot mr-1.5"></i> จ.ปทุมธานี</span>
                <span className="bg-green-400/80 text-white px-3 py-1.5 rounded-full font-bold shadow-sm text-xs uppercase tracking-widest"><i className="fa-solid fa-circle text-[8px] animate-pulse mr-1.5"></i> ออนไลน์</span>
              </div>
              <p className="text-sm text-purple-200 font-medium bg-black/20 p-3 rounded-xl border border-white/10 inline-block">
                <i className="fa-solid fa-circle-info mr-2"></i> สิทธิ์ของคุณ: อนุมัติร้านค้า • อนุมัติสินค้า • จัดการข้อพิพาทเบื้องต้น • จัดการออเดอร์แช่แข็ง
              </p>
            </div>
          </div>
        </div>

        {/* Tabs Desktop */}
        <div className="hidden lg:flex overflow-x-auto hide-scrollbar gap-3 mb-8 pb-2 px-1">
          {tabs.map((tab) => (
            <button key={tab.value} onClick={() => setActiveTab(tab.value as Tab)}
              className={`flex items-center gap-2 px-5 py-3 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm border-2 ${
                activeTab === tab.value 
                  ? "bg-purple-600 text-white border-purple-600 shadow-md scale-105" 
                  : "bg-white text-gray-600 border-transparent hover:border-purple-200 hover:text-purple-600"
              }`}>
              <i className={`${tab.icon} ${activeTab === tab.value ? "text-white" : "text-gray-400"}`}></i> {tab.label}
            </button>
          ))}
        </div>

        {/* Hamburger Mobile */}
        <div className="lg:hidden flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm mb-6 border border-gray-100">
          <div className="font-bold text-gray-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
              <i className={`${tabs.find(t => t.value === activeTab)?.icon}`}></i>
            </div>
            {tabs.find(t => t.value === activeTab)?.label}
          </div>
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <i className="fa-solid fa-bars"></i>
          </button>
        </div>

        {/* Mobile Menu Drawer */}
        <div className={`fixed inset-0 z-50 flex justify-end lg:hidden transition-opacity duration-300 ${isMobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? "opacity-100" : "opacity-0"}`} onClick={() => setIsMobileMenuOpen(false)}></div>
          <div className={`relative w-[280px] h-full bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="font-black text-lg text-gray-800">เมนูการจัดการ</h3>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {tabs.map((tab) => (
                <button 
                  key={tab.value} 
                  onClick={() => {
                    setActiveTab(tab.value as Tab);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-3 px-5 py-4 rounded-xl text-sm font-bold transition-all ${
                    activeTab === tab.value 
                      ? "bg-purple-50 text-purple-700 shadow-sm" 
                      : "text-gray-600 hover:bg-gray-50 hover:text-purple-600"
                  }`}>
                  <i className={`${tab.icon} w-5 text-center ${activeTab === tab.value ? "text-purple-600" : "text-gray-400"}`}></i> {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "dashboard" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <h3 className="font-black text-gray-800 text-xl flex items-center gap-2">
                <i className="fa-solid fa-chart-line text-purple-500"></i> สรุปผลการดำเนินงาน
              </h3>
              
              {/* Filters */}
              <div className="flex flex-row flex-wrap gap-3">
                <CustomSelect 
                  value={timeFilter}
                  onChange={setTimeFilter}
                  options={[
                    { label: "วันนี้ (Today)", value: "TODAY" },
                    { label: "สัปดาห์นี้ (This Week)", value: "WEEK" },
                    { label: "เดือนนี้ (This Month)", value: "MONTH" },
                    { label: "12 เดือนล่าสุด", value: "12MONTHS" },
                    { label: "ปีนี้ (This Year)", value: "YEAR" }
                  ]}
                />
                
                <CustomSelect 
                  value={selectedShop}
                  onChange={setSelectedShop}
                  options={[
                    { label: "ทุกชุมชนที่ดูแล (All)", value: "ALL" },
                    // In a real app, populate this with the list of communities the admin manages
                  ]}
                  className="[&>button]:bg-purple-50 [&>button]:border-purple-200 [&>button]:text-purple-700"
                />
              </div>
            </div>
            
            {/* Queues (Action Required) */}
            <h4 className="font-bold text-gray-800 mt-4 mb-2 flex items-center gap-2">
              <i className="fa-solid fa-clipboard-list text-orange-500"></i> คิวงานที่ต้องจัดการ
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-orange-50/50 rounded-2xl p-4 border border-orange-100 text-center flex flex-col justify-center cursor-pointer hover:bg-orange-100 transition-colors" onClick={() => { setActiveTab('shops'); setShopFilter('PENDING'); }}>
                <div className="text-2xl font-black text-orange-600">{queues.pendingShopApprovals}</div>
                <div className="text-[10px] font-bold text-orange-800 mt-1">ร้านรออนุมัติ</div>
              </div>
              <div className="bg-orange-50/50 rounded-2xl p-4 border border-orange-100 text-center flex flex-col justify-center cursor-pointer hover:bg-orange-100 transition-colors" onClick={() => { setActiveTab('shops'); setShopFilter('ACTIVE'); }}>
                <div className="text-2xl font-black text-orange-600">{queues.pendingShopEdits}</div>
                <div className="text-[10px] font-bold text-orange-800 mt-1">ร้านรอแก้โปรไฟล์</div>
              </div>
              <div className="bg-purple-50/50 rounded-2xl p-4 border border-purple-100 text-center flex flex-col justify-center cursor-pointer hover:bg-purple-100 transition-colors" onClick={() => setActiveTab('products')}>
                <div className="text-2xl font-black text-purple-600">{queues.pendingProductChecks}</div>
                <div className="text-[10px] font-bold text-purple-800 mt-1">สินค้ารอตรวจ</div>
              </div>
              <div className="bg-red-50/50 rounded-2xl p-4 border border-red-100 text-center flex flex-col justify-center cursor-pointer hover:bg-red-100 transition-colors" onClick={() => setActiveTab('disputes')}>
                <div className="text-2xl font-black text-red-600">{queues.openDisputes}</div>
                <div className="text-[10px] font-bold text-red-800 mt-1">ข้อพิพาทเปิดอยู่</div>
              </div>
              <div className="bg-cyan-50/50 rounded-2xl p-4 border border-cyan-100 text-center flex flex-col justify-center cursor-pointer hover:bg-cyan-100 transition-colors" onClick={() => setActiveTab('frozen')}>
                <div className="text-2xl font-black text-cyan-600">{queues.frozenOrders}</div>
                <div className="text-[10px] font-bold text-cyan-800 mt-1">ออเดอร์แช่แข็ง</div>
              </div>
            </div>

            {/* Dashboard Stats */}
            <h4 className="font-bold text-gray-800 mt-2 mb-2 flex items-center gap-2">
              <i className="fa-solid fa-chart-pie text-blue-500"></i> ภาพรวม
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-green-50 text-green-500 rounded-full flex items-center justify-center text-xl mb-3">
                  <i className="fa-solid fa-sack-dollar"></i>
                </div>
                <p className="text-sm text-gray-500 font-medium mb-1">ยอดขายสุทธิ</p>
                <h4 className="text-xl font-black text-gray-800">฿{displaySales.toLocaleString()}</h4>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-purple-50 text-purple-500 rounded-full flex items-center justify-center text-xl mb-3">
                  <i className="fa-solid fa-store"></i>
                </div>
                <p className="text-sm text-gray-500 font-medium mb-1">ร้านค้าที่เปิดอยู่</p>
                <h4 className="text-xl font-black text-gray-800">{displayActiveShops.toLocaleString()} <span className="text-xs text-gray-400 font-normal">ร้าน</span></h4>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-yellow-50 text-yellow-500 rounded-full flex items-center justify-center text-xl mb-3">
                  <i className="fa-solid fa-tags"></i>
                </div>
                <p className="text-sm text-gray-500 font-medium mb-1">สินค้าที่ขายอยู่</p>
                <h4 className="text-xl font-black text-gray-800">{displayActiveProducts.toLocaleString()} <span className="text-xs text-gray-400 font-normal">รายการ</span></h4>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center text-xl mb-3">
                  <i className="fa-solid fa-ban"></i>
                </div>
                <p className="text-sm text-gray-500 font-medium mb-1">ร้านถูกระงับ/แบน</p>
                <h4 className="text-xl font-black text-gray-800">{(overview.suspendedShops + overview.bannedOwners).toLocaleString()} <span className="text-xs text-gray-400 font-normal">ร้าน</span></h4>
              </div>
            </div>

            {selectedShop === "ALL" ? (
              <>
            <div className="flex flex-col gap-6">
              {/* Order Trend Line Chart */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                  <i className="fa-solid fa-arrow-trend-up text-blue-500"></i> แนวโน้มการสั่งซื้อ (7 วันล่าสุด)
                </h4>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dynamicTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={40} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value) => [`฿${Number(value).toLocaleString()}`, 'ยอดขาย']}
                        labelStyle={{ fontWeight: 'bold', color: '#374151' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="sales" 
                        name="ยอดขาย" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} 
                        activeDot={{ r: 6, strokeWidth: 0, fill: '#3b82f6' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            </>
            ) : (
            <>
              {/* Specific Shop Charts */}
              <div className="flex flex-col gap-6">
                
                {/* Trend Chart (Shop Specific) */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                  <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-arrow-trend-up text-blue-500"></i> แนวโน้มการสั่งซื้อ (ร้าน {selectedShop === 'ALL' ? 'ทั้งหมด' : activeShops.find((s) => s.id === selectedShop)?.name || ''})
                  </h4>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dynamicTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={40} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value) => [`${value} ออเดอร์`, 'ยอดสั่งซื้อ']}
                          labelStyle={{ fontWeight: 'bold', color: '#374151' }}
                        />
                        <Line type="monotone" dataKey="sales" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0, fill: '#8b5cf6' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </div>
            </>
            )}

          </div>
        )}

        {activeTab === "shops" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <h3 className="font-black text-gray-800 text-xl flex items-center gap-2">
                <i className="fa-solid fa-store text-gray-400"></i> จัดการร้านค้า 
                <span className="bg-purple-100 text-purple-600 text-sm px-2.5 py-0.5 rounded-full">{currentShops.length}</span>
              </h3>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <select 
                  value={shopFilter}
                  onChange={e => setShopFilter(e.target.value)}
                  className="input-minimal bg-white border border-gray-200 text-sm py-2 px-4 rounded-full outline-none focus:border-purple-500 shadow-sm"
                >
                  <option value="PENDING">รออนุมัติ</option>
                  <option value="ACTIVE">เปิดใช้งานแล้ว</option>
                </select>
                <div className="relative w-full sm:w-64">
                  <input 
                    type="text" 
                    placeholder="ค้นหาร้านค้า, ชื่อผู้สมัคร..." 
                    value={shopSearch}
                    onChange={e => setShopSearch(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-purple-500 shadow-sm" 
                  />
                  <i className="fa-solid fa-magnifying-glass absolute left-4 top-2.5 text-gray-400"></i>
                </div>
              </div>
            </div>
            {isLoadingShops ? (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400 flex flex-col items-center justify-center gap-3">
                <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                <p>กำลังโหลดข้อมูลร้านค้า...</p>
              </div>
            ) : currentShops.map((shop) => (
              <div key={shop.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-5 transition-all hover:shadow-md hover:border-purple-200">
                <div className="flex items-center gap-4 w-full sm:w-auto text-center sm:text-left cursor-pointer group" onClick={() => setViewShop(shop)}>
                  <div className="w-16 h-16 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 shadow-inner group-hover:bg-purple-600 group-hover:text-white transition">
                    <i className="fa-solid fa-shop"></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-800 text-lg mb-1 group-hover:text-purple-600 transition hover:underline">{shop.name}</h4>
                    <p className="text-sm text-gray-500 font-medium">
                      {shopFilter === "PENDING" ? (
                        <>ผู้สมัคร: <span className="font-bold text-gray-700">{shop.ownerEmail}</span> <span className="mx-2 text-gray-300">|</span> 
                        วันที่ขอ: {new Date(shop.createdAt).toLocaleDateString("th-TH")}</>
                      ) : (
                        <>ผู้สมัคร: <span className="font-bold text-gray-700">{shop.ownerName}</span> <span className="mx-2 text-gray-300">|</span> 
                        วันที่: {shop.createdAt}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <button onClick={() => setViewShop(shop)} className="flex-1 sm:flex-none bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2" title="ดูข้อมูล">
                    <i className="fa-solid fa-eye"></i>
                  </button>
                  {shopFilter === "PENDING" ? (
                    <>
                      <button onClick={() => shop.pending && handleApproveShop(shop.pending)} className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2">
                        <i className="fa-solid fa-check"></i> อนุมัติ
                      </button>
                      <button onClick={() => shop.pending && handleRejectShop(shop.pending)} className="flex-1 sm:flex-none bg-white border border-red-100 text-red-500 hover:border-red-500 hover:bg-red-50 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2">
                        <i className="fa-solid fa-xmark"></i> ปฏิเสธ
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleSuspendShop(shop.id)} className="flex-1 sm:flex-none bg-red-50 text-red-600 hover:bg-red-500 hover:text-white px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2">
                      <i className="fa-solid fa-ban"></i> ระงับการใช้งาน
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!isLoadingShops && currentShops.length === 0 && (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400">ไม่มีร้านค้าที่รอการอนุมัติ</div>
            )}
          </div>
        )}

        {activeTab === "products" && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <h3 className="font-black text-gray-800 text-xl flex items-center gap-2">
                <i className="fa-solid fa-tags text-gray-400"></i> สินค้ารอการอนุมัติ
                <span className="bg-purple-100 text-purple-600 text-sm px-2.5 py-0.5 rounded-full">{filteredProducts.length}</span>
              </h3>
              <select 
                value={productFilter}
                onChange={e => setProductFilter(e.target.value)}
                className="input-minimal bg-white border border-gray-200 text-sm py-2 px-4 rounded-full outline-none focus:border-purple-500 shadow-sm w-full sm:w-auto"
              >
                <option value="ALL">ทุกสถานะ</option>
                <option value="NEW">รายการใหม่</option>
                <option value="EDITED">แก้ไขข้อมูล</option>
                <option value="DELETE_REQUEST">ขอลบสินค้า</option>
                <option value="PAUSE_REQUEST">ขอหยุดขาย</option>
              </select>
            </div>
            {isLoadingProducts ? (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400 flex flex-col items-center justify-center gap-3">
                <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                <p>กำลังโหลดข้อมูลสินค้า...</p>
              </div>
            ) : filteredProducts.map((product) => (
              <div key={product.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-5 transition-all hover:shadow-md hover:border-purple-200 relative overflow-hidden">
                {(product.status === "DELETE_REQUEST" || product.status === "PAUSE_REQUEST") && (product.pendingOrdersCount ?? 0) > 0 && (
                  <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm">
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i> มีออเดอร์ค้างส่ง {product.pendingOrdersCount} รายการ
                  </div>
                )}
                <div className="flex items-center gap-4 w-full sm:w-auto text-center sm:text-left cursor-pointer group" onClick={() => setViewProduct(product)}>
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 shadow-inner group-hover:text-white transition ${
                    product.status === "NEW" ? "bg-blue-50 text-blue-500 group-hover:bg-blue-500" : 
                    product.status === "EDITED" ? "bg-yellow-50 text-yellow-500 group-hover:bg-yellow-500" :
                    product.status === "DELETE_REQUEST" ? "bg-red-50 text-red-500 group-hover:bg-red-500" :
                    "bg-orange-50 text-orange-500 group-hover:bg-orange-500"
                  }`}>
                    <i className={`fa-solid ${
                      product.status === "NEW" ? "fa-box" : 
                      product.status === "EDITED" ? "fa-pen-to-square" : 
                      product.status === "DELETE_REQUEST" ? "fa-trash" : 
                      "fa-pause"
                    }`}></i>
                  </div>
                  <div>
                    <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5 mt-2 sm:mt-0">
                      <h4 className="font-bold text-gray-800 text-lg group-hover:text-purple-600 transition hover:underline">{product.name}</h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-sm ${
                        product.status === "NEW" ? "bg-blue-50 text-blue-600 border-blue-200" : 
                        product.status === "EDITED" ? "bg-yellow-50 text-yellow-600 border-yellow-200" :
                        product.status === "DELETE_REQUEST" ? "bg-red-50 text-red-600 border-red-200" :
                        "bg-orange-50 text-orange-600 border-orange-200"
                      }`}>
                        {product.status === "NEW" ? "รายการใหม่" : 
                         product.status === "EDITED" ? "แก้ไขข้อมูล" : 
                         product.status === "DELETE_REQUEST" ? "ขอลบสินค้า" : 
                         "ขอหยุดขาย"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 font-medium">
                      ร้าน: <span className="font-bold text-gray-700">{product.shopName}</span> <span className="mx-2 text-gray-300">|</span> 
                      {product.createdAt}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                  <button onClick={() => setViewProduct(product)} className="flex-1 sm:flex-none bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white px-4 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2" title="ดูข้อมูล">
                    <i className="fa-solid fa-eye"></i>
                  </button>
                  <button onClick={() => handleApproveProduct(product)} className="flex-1 sm:flex-none bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2">
                    <i className="fa-solid fa-check"></i> อนุมัติ
                  </button>
                  <button onClick={() => handleRejectProduct(product)} className="flex-1 sm:flex-none bg-white border border-red-100 text-red-500 hover:border-red-500 hover:bg-red-50 px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2">
                    <i className="fa-solid fa-xmark"></i> ปฏิเสธ
                  </button>
                </div>
              </div>
            ))}
            {!isLoadingProducts && filteredProducts.length === 0 && (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400">ไม่มีสินค้าที่รอการอนุมัติ</div>
            )}
          </div>
        )}

        {activeTab === "disputes" && (
          <div className="flex flex-col gap-5">
            <h3 className="font-black text-gray-800 text-xl flex items-center gap-2 mb-2">
              <i className="fa-solid fa-gavel text-gray-400"></i> ตัดสินข้อพิพาท 
              <span className="bg-red-100 text-red-600 text-sm px-2.5 py-0.5 rounded-full">1</span>
            </h3>
            
            {isLoadingDisputes ? (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400 flex flex-col items-center justify-center gap-3">
                <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                <p>กำลังโหลดข้อมูลข้อพิพาท...</p>
              </div>
            ) : disputes.length === 0 ? (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400">ไม่มีข้อพิพาทที่ต้องตัดสิน</div>
            ) : disputes.map((dispute) => (
              <div key={dispute.id} className="bg-white rounded-3xl shadow-sm border-2 border-red-100 overflow-hidden mb-6">
                <div className="bg-red-50 border-b border-red-100 p-5 flex justify-between items-center">
                  <div>
                    <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">รอดำเนินการ</span>
                    <h4 className="font-black text-red-700 text-lg mt-2">ออเดอร์ #{dispute.orderId.substring(0, 8)}...</h4>
                    <p className="text-sm text-red-600 font-medium mt-1"><i className="fa-solid fa-store mr-1"></i> ร้าน ID: {dispute.shopId}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500 font-medium">วันที่ร้องเรียน</p>
                    <p className="font-bold text-gray-700">{new Date(dispute.createdAt).toLocaleDateString("th-TH")}</p>
                  </div>
                </div>
                
                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Buyer Side */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                    <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-200">
                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold shadow-inner">ผ.</div>
                      <div>
                        <p className="text-xs text-gray-500 font-bold">ฝั่งผู้ซื้อ (ผู้ร้องเรียน)</p>
                        <p className="font-bold text-gray-800">ผู้ซื้อ</p>
                      </div>
                    </div>
                    <h5 className="font-bold text-gray-800 mb-2">เหตุผล:</h5>
                    <p className="text-sm text-gray-600 bg-white p-3 rounded-xl border border-gray-100 mb-4 font-medium leading-relaxed">
                      {dispute.reason}
                    </p>
                    {dispute.evidence && dispute.evidence.length > 0 && (
                      <>
                        <p className="text-xs text-gray-500 font-bold mb-2">หลักฐานแนบ:</p>
                        <div className="flex gap-2 flex-wrap">
                          {dispute.evidence.map((ev, i) => (
                            <div key={i} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs flex items-center gap-2 text-blue-600 cursor-pointer hover:bg-blue-50 transition">
                              <i className="fa-solid fa-paperclip"></i> {ev.fileName}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Seller Side */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200">
                    <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-200">
                      <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center font-bold shadow-inner">ร.</div>
                      <div>
                        <p className="text-xs text-gray-500 font-bold">ฝั่งร้านค้า</p>
                        <p className="font-bold text-gray-800">ร้านค้า</p>
                      </div>
                    </div>
                    <h5 className="font-bold text-gray-800 mb-2">คำชี้แจง:</h5>
                    <p className="text-sm text-gray-600 bg-white p-3 rounded-xl border border-gray-100 mb-4 font-medium leading-relaxed">
                      {dispute.shopResponse || "ร้านค้ายานี้ยังไม่ได้ตอบกลับ"}
                    </p>
                  </div>
                </div>

                {/* Action Panel */}
                <div className="bg-white border-t border-gray-100 p-6 flex flex-col items-center">
                  <p className="text-sm text-gray-500 font-bold mb-4 bg-gray-50 px-4 py-2 rounded-full"><i className="fa-solid fa-scale-balanced mr-2"></i> คำตัดสินของศาลชั้นต้น (ผู้ดูแลชุมชน)</p>
                  <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                    <button onClick={() => handleRuleDispute(dispute.id, "SHOP_WINS")} className="bg-white border-2 border-green-500 text-green-600 hover:bg-green-50 px-8 py-3.5 rounded-full font-bold transition-all shadow-sm">
                      <i className="fa-solid fa-store mr-2"></i> ตัดสินให้ &quot;ร้านค้า&quot; ชนะ
                    </button>
                    <button onClick={() => handleRuleDispute(dispute.id, "BUYER_WINS")} className="bg-red-500 hover:bg-red-600 text-white px-8 py-3.5 rounded-full font-bold transition-all shadow-md">
                      <i className="fa-solid fa-user-check mr-2"></i> ตัดสินให้ &quot;ผู้ซื้อ&quot; ชนะ (สั่งคืนเงิน)
                    </button>
                  </div>
                  <p className="text-xs text-red-500 mt-4 font-medium max-w-lg text-center leading-relaxed">
                    * หมายเหตุ: การตัดสินนี้เป็นที่สิ้นสุด หากผู้ซื้อชนะคดี <b>ระบบจะทำการบังคับคืนเงิน</b>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "frozen" && (
          <div className="flex flex-col gap-5">
            <h3 className="font-black text-gray-800 text-xl flex items-center gap-2 mb-2">
              <i className="fa-solid fa-snowflake text-blue-400"></i> จัดการออเดอร์แช่แข็ง (Frozen Orders)
              <span className="bg-blue-100 text-blue-600 text-sm px-2.5 py-0.5 rounded-full">{frozenOrders.length}</span>
            </h3>
            
            {isLoadingFrozenOrders ? (
              <div className="text-center py-10 bg-white rounded-3xl border border-gray-100 shadow-sm text-gray-400 flex flex-col items-center justify-center gap-3">
                <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                <p>กำลังโหลดข้อมูลออเดอร์...</p>
              </div>
            ) : frozenOrders.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center text-gray-400 shadow-sm border border-gray-100 flex flex-col items-center">
                <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-5 text-blue-200 text-5xl">
                  <i className="fa-solid fa-check-circle"></i>
                </div>
                <h3 className="font-bold text-gray-600 text-xl mb-2">ไม่มีออเดอร์ที่ถูกแช่แข็ง</h3>
                <p className="text-gray-500 font-medium">ระบบการสั่งซื้อทำงานปกติ</p>
              </div>
            ) : frozenOrders.map((order) => (
              <div key={order.id} className="bg-white rounded-3xl shadow-sm border-2 border-blue-100 overflow-hidden mb-6">
                <div className="bg-blue-50 border-b border-blue-100 p-5 flex justify-between items-center">
                  <div>
                    <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">แช่แข็ง (Frozen)</span>
                    <h4 className="font-black text-blue-700 text-lg mt-2">ออเดอร์ #{order.id.substring(0, 8)}...</h4>
                    <p className="text-sm text-blue-600 font-medium mt-1"><i className="fa-solid fa-store mr-1"></i> ร้าน ID: {order.shopId.substring(0, 8)}...</p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <p className="text-sm text-gray-500 font-medium">วันที่ถูกแช่แข็ง</p>
                    <p className="font-bold text-gray-700">{order.frozenAt ? new Date(order.frozenAt).toLocaleDateString("th-TH") : "-"}</p>
                  </div>
                </div>
                
                <div className="p-6 md:p-8">
                  <div className="flex items-start gap-4 mb-6 pb-6 border-b border-gray-100">
                    <div className="flex-1">
                      <h5 className="font-bold text-gray-800 mb-2">เหตุผลที่ถูกแช่แข็ง:</h5>
                      <div className="flex flex-wrap gap-2">
                        {order.freezeReasons.map((reason, i) => (
                          <span key={i} className="bg-red-50 text-red-600 border border-red-200 text-xs px-3 py-1 rounded-full font-bold">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                    {order.disputeAwaitingRulingId && (
                      <div className="bg-orange-50 border border-orange-200 p-3 rounded-xl text-right">
                        <p className="text-xs font-bold text-orange-600 mb-1"><i className="fa-solid fa-triangle-exclamation"></i> มีข้อพิพาทรอดำเนินการ</p>
                        <p className="text-[10px] text-orange-500">กรุณาตัดสินข้อพิพาทก่อน</p>
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <h5 className="font-bold text-gray-800 mb-3 text-sm">รายการสินค้า:</h5>
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex justify-between items-center text-sm mb-2 last:mb-0">
                          <div>
                            <p className="font-bold text-gray-700">{item.productNameAtPurchase}</p>
                            <p className="text-xs text-gray-500">{item.variantNameAtPurchase} (x{item.quantity})</p>
                          </div>
                          <p className="font-bold text-[#16A085]">฿{((item.priceAtPurchase * item.quantity) / 100).toLocaleString()}</p>
                        </div>
                      ))}
                      <div className="border-t border-gray-200 my-2"></div>
                      <div className="flex justify-between items-center text-sm">
                        <p className="font-bold text-gray-600">ค่าจัดส่ง</p>
                        <p className="font-bold text-gray-600">฿{order.shippingAmountMinor ? (order.shippingAmountMinor / 100).toLocaleString() : "-"}</p>
                      </div>
                      <div className="flex justify-between items-center text-base mt-2 pt-2 border-t border-gray-200">
                        <p className="font-black text-gray-800">ยอดรวมทั้งสิ้น</p>
                        <p className="font-black text-[#16A085]">฿{order.totalAmountMinor ? (order.totalAmountMinor / 100).toLocaleString() : "-"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Panel */}
                <div className="bg-white border-t border-gray-100 p-6 flex flex-col items-center">
                  <p className="text-sm text-gray-500 font-bold mb-4 bg-gray-50 px-4 py-2 rounded-full"><i className="fa-solid fa-gavel mr-2"></i> คำตัดสิน (Ruling)</p>
                  <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                    <button 
                      onClick={() => handleRuleFrozenOrder(order.id, "RELEASE")} 
                      disabled={!!order.disputeAwaitingRulingId}
                      className="bg-white border-2 border-green-500 text-green-600 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed px-8 py-3.5 rounded-full font-bold transition-all shadow-sm"
                    >
                      <i className="fa-solid fa-play mr-2"></i> ปล่อยออเดอร์ (Release)
                    </button>
                    <button 
                      onClick={() => handleRuleFrozenOrder(order.id, "TERMINATE")} 
                      disabled={!!order.disputeAwaitingRulingId}
                      className="bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3.5 rounded-full font-bold transition-all shadow-md"
                    >
                      <i className="fa-solid fa-ban mr-2"></i> ยกเลิก/คืนเงิน (Terminate)
                    </button>
                  </div>
                  {order.disputeAwaitingRulingId && (
                    <p className="text-xs text-orange-500 mt-4 font-medium text-center">
                      ต้องตัดสินข้อพิพาทก่อนถึงจะสามารถสั่งการออเดอร์นี้ได้
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* MODALS */}
      {viewShop && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="bg-purple-600 p-6 flex justify-between items-start text-white">
              <div className="flex gap-4 items-center">
                {viewShop.pending?.hasLogo ? (
                  <img src={`/api/v1/shops/${viewShop.id}/logo`} alt={viewShop.name} className="w-16 h-16 rounded-2xl object-cover shadow-sm bg-white" />
                ) : (
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">
                    <i className="fa-solid fa-store"></i>
                  </div>
                )}
                <div>
                  <h3 className="font-black text-2xl mb-1">{viewShop.name}</h3>
                  <p className="text-purple-200 text-sm">{viewShop.communityName || "วิสาหกิจชุมชน"}</p>
                </div>
              </div>
              <button onClick={() => setViewShop(null)} className="text-white/60 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto hide-scrollbar">
              <div className="bg-gray-50 p-4 rounded-2xl">
                <p className="text-sm text-gray-500 mb-1 font-bold">ข้อมูลร้านค้า & ที่ตั้ง</p>
                <p className="font-medium text-gray-800 whitespace-pre-line">{viewShop.details || "ไม่มีรายละเอียด"}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-2xl">
                <p className="text-xs text-gray-500 mb-1 font-bold">ที่ตั้ง</p>
                <p className="font-bold text-gray-800">{viewShop.address}</p>
              </div>
              
              <div className="border-t border-gray-100 my-2"></div>
              <h4 className="font-black text-gray-800 text-lg flex items-center gap-2">
                <i className="fa-solid fa-users text-purple-500"></i> ข้อมูลสถิติ
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-xs text-gray-500 mb-1 font-bold">ผู้ติดตามร้านค้า</p>
                  <p className="font-bold text-gray-800">{viewShop.followerCount || 0} คน</p>
                </div>
              </div>

              <div className="border-t border-gray-100 my-2"></div>
              <h4 className="font-black text-gray-800 text-lg flex items-center gap-2">
                <i className="fa-solid fa-user-shield text-purple-500"></i> ข้อมูลผู้สมัครเปิดร้าน
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-xs text-gray-500 mb-1 font-bold">ผู้สมัคร</p>
                  <p className="font-bold text-gray-800">{viewShop.ownerName}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-xs text-gray-500 mb-1 font-bold">วันที่ยื่นเรื่อง</p>
                  <p className="font-bold text-gray-800">{viewShop.createdAt}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl col-span-2">
                  <p className="text-xs text-gray-500 mb-2 font-bold">ข้อมูลช่องทางการรับเงิน</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-sm font-medium text-gray-500 w-1/3">ธนาคาร</span>
                      <span className="text-sm font-bold text-gray-800 w-2/3">{viewShop.paymentBank === 'kbank' ? 'ธนาคารกสิกรไทย' : viewShop.paymentBank === 'scb' ? 'ธนาคารไทยพาณิชย์' : viewShop.paymentBank === 'bbl' ? 'ธนาคารกรุงเทพ' : viewShop.paymentBank === 'ktb' ? 'ธนาคารกรุงไทย' : viewShop.paymentBank}</span>
                    </div>
                    <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-sm font-medium text-gray-500 w-1/3">เลขที่บัญชี</span>
                      <span className="text-sm font-bold text-gray-800 tracking-wider w-2/3">{viewShop.paymentAccount}</span>
                    </div>
                    <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-200">
                      <span className="text-sm font-medium text-gray-500 w-1/3">ชื่อบัญชี</span>
                      <span className="text-sm font-bold text-gray-800 w-2/3">{viewShop.paymentName}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              {viewShop.status === "PENDING" ? (
                <>
                  <button onClick={() => viewShop.pending && handleRejectShop(viewShop.pending)} className="px-6 py-2.5 font-bold text-red-500 bg-white border border-red-200 hover:bg-red-50 rounded-xl transition">ปฏิเสธ</button>
                  <button onClick={() => viewShop.pending && handleApproveShop(viewShop.pending)} className="px-6 py-2.5 font-bold text-white bg-green-500 hover:bg-green-600 rounded-xl shadow-md transition">อนุมัติร้านค้า</button>
                </>
              ) : (
                <button onClick={() => setViewShop(null)} className="px-6 py-2.5 font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 rounded-xl transition">ปิดหน้าต่าง</button>
              )}
            </div>
          </div>
        </div>
      )}

      {viewProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-start relative">
              <div className="flex gap-4 items-center">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl ${viewProduct.status === 'NEW' ? 'bg-blue-50 text-blue-500' : 'bg-yellow-50 text-yellow-500'}`}>
                  <i className={`fa-solid ${viewProduct.status === 'NEW' ? 'fa-box' : 'fa-pen-to-square'}`}></i>
                </div>
                <div>
                  <h3 className="font-black text-2xl text-gray-800 mb-1 pr-6">{viewProduct.name}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${viewProduct.status === 'NEW' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-yellow-50 text-yellow-600 border-yellow-200'}`}>
                    {viewProduct.status === 'NEW' ? "รายการใหม่" : "แก้ไขข้อมูล"}
                  </span>
                </div>
              </div>
              <button onClick={() => setViewProduct(null)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-800"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-xs text-gray-500 mb-1 font-bold">ราคาขาย</p>
                  <p className="font-bold text-xl text-[#16A085]">{formatProductPrice(viewProduct)}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl">
                  <p className="text-xs text-gray-500 mb-1 font-bold">จำนวนสต็อก</p>
                  <p className="font-bold text-xl text-gray-800">{viewProduct.variants.reduce((sum, v) => sum + v.stock, 0)} ชิ้น</p>
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-2xl">
                <p className="text-xs text-gray-500 mb-1 font-bold">ร้านค้า</p>
                <p className="font-bold text-gray-800"><i className="fa-solid fa-store text-gray-400 mr-2"></i> {viewProduct.shopName}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-2xl">
                <p className="text-xs text-gray-500 mb-1 font-bold">วันที่ส่งคำขอ</p>
                <p className="font-bold text-gray-800">{viewProduct.createdAt}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => handleRejectProduct(viewProduct)} className="px-6 py-2.5 font-bold text-red-500 bg-white border border-red-200 hover:bg-red-50 rounded-xl transition">ปฏิเสธ</button>
              <button onClick={() => handleApproveProduct(viewProduct)} className="px-6 py-2.5 font-bold text-white bg-green-500 hover:bg-green-600 rounded-xl shadow-md transition">อนุมัติ</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
