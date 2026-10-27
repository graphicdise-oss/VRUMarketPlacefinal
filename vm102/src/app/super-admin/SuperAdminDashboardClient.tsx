"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { HeatMapPoint } from "@/components/map/HeatMapDisplay";
import { superAdminApi, PlatformDashboardDto, LocationStatsDto } from "@/lib/api";
import dynamic from "next/dynamic";
import BroadcastTab from "./components/BroadcastTab";
import CategoriesTab from "./components/CategoriesTab";
import DisputesTab from "./components/DisputesTab";
import UsersTab from "./components/UsersTab";
import CommunitiesTab from "./components/CommunitiesTab";
import AdminsTab from "./components/AdminsTab";
import BannersTab from "./components/BannersTab";
import AuditLogTab from "./components/AuditLogTab";
import ArticleAdminClient from "@/app/admin/articles/ArticleAdminClient";

const DashboardTab = dynamic(() => import("./components/DashboardTab"), {
  ssr: false,
  loading: () => (
    <div className="p-12 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#16A085] border-t-transparent rounded-full animate-spin"></div>
    </div>
  ),
});

type Tab = "dashboard" | "communities" | "admins" | "categories" | "users" | "disputes" | "broadcast" | "banners" | "articles" | "audit-log";

const tabs: { value: Tab; label: string; icon: string }[] = [
  { value: "dashboard", label: "แดชบอร์ด", icon: "fa-solid fa-chart-line" },
  { value: "communities", label: "จัดการชุมชน", icon: "fa-solid fa-users-viewfinder" },
  { value: "admins", label: "แอดมินชุมชน", icon: "fa-solid fa-user-shield" },
  { value: "categories", label: "หมวดหมู่กลาง", icon: "fa-solid fa-list" },
  { value: "users", label: "จัดการ User", icon: "fa-solid fa-user-xmark" },
  { value: "articles", label: "จัดการเรื่องราวชุมชน", icon: "fa-solid fa-newspaper" },
  { value: "banners", label: "จัดการแบนเนอร์", icon: "fa-solid fa-images" },
  { value: "disputes", label: "ข้อพิพาท", icon: "fa-solid fa-gavel" },
  { value: "broadcast", label: "Broadcast", icon: "fa-solid fa-bullhorn" },
  { value: "audit-log", label: "Audit Log", icon: "fa-solid fa-clock-rotate-left" },
];

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6'];

export default function SuperAdminDashboardClient() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== "SUPER_ADMIN")) {
      router.push("/login?callbackUrl=/super-admin");
    }
  }, [user, isAuthLoading, router]);

  
  // Dashboard Filters
  const [timeFilter, setTimeFilter] = useState("MONTH");
  const [locationType, setLocationType] = useState("PROVINCE"); // "PROVINCE" or "COMMUNITY"
  const [selectedLocation, setSelectedLocation] = useState("ALL");
  const [dashboardStats, setDashboardStats] = useState<(PlatformDashboardDto & { mapPoints?: HeatMapPoint[] }) | null>(null);

  // Backend Integration
  useEffect(() => {
    if (!user || user.role !== "SUPER_ADMIN") return;
    const fetchDashboardStats = async () => {
      try {
        const stats = await superAdminApi.getDashboard(timeFilter, locationType, selectedLocation);
        setDashboardStats(stats);
      } catch (err) {
        console.error("Failed to load dashboard stats:", err);
      }
    };
    fetchDashboardStats();
  }, [timeFilter, locationType, selectedLocation, user]);

  // Fetch communities was removed.

  let displayBarData: LocationStatsDto[] = dashboardStats?.salesByLocation || [];
  if (selectedLocation !== "ALL") {
    displayBarData = displayBarData.filter(d => d.name === selectedLocation);
  }
  
  const dynamicBarData = displayBarData;
  
  const mapPoints: HeatMapPoint[] = dashboardStats?.mapPoints || [];

  const dynamicTrendData = dashboardStats?.platformTrend || [];

  const totalPlatformSales = dashboardStats?.totalSales || 0;
  const totalPlatformOrders = dashboardStats?.totalOrders || 0;
  
  // Real dashboard stats sync
  const totalCommunitiesCount = dashboardStats?.totalCommunities || 0;
  const totalAdminsCount = dashboardStats?.totalAdmins || 0; // Global count not available
  const totalUsersCount = dashboardStats?.totalUsers || 0; // Prepare for real data
  const totalAppealsCount = dashboardStats?.totalAppeals || 0; // Prepare for real data
  
  const bannedUsersCount = dashboardStats?.bannedUsers || 0;
  const pendingAppealsCount = dashboardStats?.pendingAppeals || 0;
  const pendingShopsCount = dashboardStats?.pendingShops || 0;
  const issueStatusData = dashboardStats?.issueStatus || [];

  // Sidebar State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Handlers
  // Handlers have been moved to tabs

  if (!mounted || isAuthLoading || !user || user.role !== "SUPER_ADMIN") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <i className="fa-solid fa-circle-notch fa-spin text-4xl text-[#16A085]"></i>
          <p className="text-gray-500 font-bold">กำลังตรวจสอบสิทธิ์ผู้ดูแลระบบ...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <header className="bg-gray-900 text-white sticky top-0 z-40 shadow-md">
        <div className="w-full px-6 md:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="bg-[#16A085] text-white w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-sm">
              <i className="fa-solid fa-server"></i>
            </div>
            <div>
              <h1 className="font-black tracking-tight text-lg leading-tight">PLATFORM <span className="text-[#16A085]">ADMIN</span></h1>
              <p className="text-[10px] text-gray-400 font-medium tracking-widest uppercase">Central Control System</p>
            </div>
          </Link>
          <Link href="/" className="text-sm font-bold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-full transition-all flex items-center gap-2 border border-gray-700">
            <i className="fa-solid fa-house"></i> กลับหน้าร้าน
          </Link>
        </div>
      </header>

      <div className="bg-white border-b border-gray-100 w-full shadow-sm relative z-30">
        <div className="w-full px-6 md:px-8 py-6">
          <Breadcrumb items={[{ label: "Platform Admin", href: "/admin/platform" }]} />
          
          {/* Dashboard Stats */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm relative overflow-hidden group hover:border-blue-200 transition-colors">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-50/80 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
              <div className="relative">
                <p className="text-gray-500 text-xs font-bold mb-1 flex items-center gap-2"><i className="fa-solid fa-users-viewfinder text-blue-500"></i> ชุมชนทั้งหมด</p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-3xl font-black text-gray-800">{totalCommunitiesCount}</h3>
                  <span className="text-sm font-bold text-gray-400">แห่ง</span>
                </div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm relative overflow-hidden group hover:border-purple-200 transition-colors">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-50/80 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
              <div className="relative">
                <p className="text-gray-500 text-xs font-bold mb-1 flex items-center gap-2"><i className="fa-solid fa-user-shield text-purple-500"></i> แอดมินชุมชน</p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-3xl font-black text-gray-800">{totalAdminsCount}</h3>
                  <span className="text-sm font-bold text-gray-400">คน</span>
                </div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm relative overflow-hidden group hover:border-green-200 transition-colors">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-green-50/80 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
              <div className="relative">
                <p className="text-gray-500 text-xs font-bold mb-1 flex items-center gap-2"><i className="fa-solid fa-users text-green-500"></i> ผู้ใช้งานระบบ</p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-3xl font-black text-gray-800">{totalUsersCount}</h3>
                  <span className="text-sm font-bold text-gray-400">บัญชี</span>
                </div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm relative overflow-hidden group hover:border-orange-200 transition-colors">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-orange-50/80 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
              <div className="relative">
                <p className="text-gray-500 text-xs font-bold mb-1 flex items-center gap-2"><i className="fa-solid fa-gavel text-orange-500"></i> ข้อพิพาททั้งหมด</p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-3xl font-black text-orange-600">{totalAppealsCount}</h3>
                  <span className="text-sm font-bold text-orange-400/80">คดี</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <main className="flex-grow w-full px-6 md:px-8 pt-6 pb-8 md:pb-10 flex flex-row gap-8 overflow-x-auto items-start">
        
        {/* Sidebar Nav (Collapsible) */}
        <div className={`${isSidebarCollapsed ? "w-20" : "w-64 lg:w-72"} flex-shrink-0 transition-all duration-300 ease-in-out`}>
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden sticky top-28">
            <div className="p-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
              {!isSidebarCollapsed && (
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 truncate">
                  เมนูการจัดการ
                </p>
              )}
              <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-white hover:shadow-sm hover:text-gray-800 transition-all mx-auto"
                title={isSidebarCollapsed ? "ขยายเมนู" : "ย่อเมนู"}
              >
                <i className={`fa-solid ${isSidebarCollapsed ? "fa-chevron-right" : "fa-chevron-left"}`}></i>
              </button>
            </div>
            <nav className="p-3 space-y-2">
              {tabs.map((tab) => (
                <button 
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value as Tab)}
                  className={`w-full flex items-center ${isSidebarCollapsed ? "justify-center px-0" : "gap-4 px-5"} py-4 rounded-2xl text-sm font-bold transition-all ${
                    activeTab === tab.value 
                      ? "bg-gray-900 text-white shadow-md" 
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                  title={isSidebarCollapsed ? tab.label : ""}
                >
                  <i className={`${tab.icon} text-lg ${isSidebarCollapsed ? "" : "w-5 text-center"} ${activeTab === tab.value ? "text-[#16A085]" : "text-gray-400"}`}></i> 
                  {!isSidebarCollapsed && <span>{tab.label}</span>}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-grow min-w-0">
          
          {activeTab === "dashboard" && (
            <DashboardTab 
              timeFilter={timeFilter} setTimeFilter={setTimeFilter}
              locationType={locationType} setLocationType={setLocationType}
              selectedLocation={selectedLocation} setSelectedLocation={setSelectedLocation}
              totalPlatformSales={totalPlatformSales} totalPlatformOrders={totalPlatformOrders}
              dynamicBarData={dynamicBarData} dynamicTrendData={dynamicTrendData}
              mapPoints={mapPoints} dashboardStats={dashboardStats}
              bannedUsersCount={bannedUsersCount} pendingAppealsCount={pendingAppealsCount} 
              pendingShopsCount={pendingShopsCount}
              issueStatusData={issueStatusData} COLORS={COLORS}
            />
          )}

          {activeTab === "communities" && (
            <CommunitiesTab />
          )}

          {activeTab === "admins" && (
            <AdminsTab />
          )}

          {activeTab === "categories" && (
            <CategoriesTab />
          )}

          {activeTab === "users" && (
            <UsersTab />
          )}

          { activeTab === "banners" && (
            <BannersTab />
          )}

          {activeTab === "articles" && (
            <ArticleAdminClient />
          )}

          {activeTab === "disputes" && user?.role === "SUPER_ADMIN" && <DisputesTab />}

          {activeTab === "broadcast" && (
            <BroadcastTab />
          )}

          {activeTab === "audit-log" && (
            <AuditLogTab />
          )}

        </div>
      </main>

      {/* MODALS EXTRACTED */}
    </div>
  );
}





