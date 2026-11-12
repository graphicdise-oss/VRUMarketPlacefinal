"use client";
import React from "react";
import {
  BarChart,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Line,
} from "recharts";
import CustomSelect from "@/components/ui/CustomSelect";
import HeatMapDisplay, { HeatMapPoint } from "@/components/map/HeatMapDisplay";
import type {
  CategorySalesDto,
  IssueStatusDto,
  LocationStatsDto,
  PlatformDashboardDto,
  TopProductDto,
  TrendPointDto,
} from "@/lib/api-modules/super-admin";
import { getCategoryStyle, COLOR_PRESETS } from "@/lib/category-styles";

export interface DashboardTabProps {
  timeFilter: string;
  setTimeFilter: (value: string) => void;
  locationType: string;
  setLocationType: (value: string) => void;
  selectedLocation: string;
  setSelectedLocation: (value: string) => void;
  totalPlatformSales: number;
  totalPlatformOrders: number;
  dynamicBarData: LocationStatsDto[];
  dynamicTrendData: TrendPointDto[];
  mapPoints: HeatMapPoint[];
  dashboardStats: PlatformDashboardDto | null;
  bannedUsersCount: number;
  pendingAppealsCount: number;
  pendingShopsCount: number;
  issueStatusData: IssueStatusDto[];
  COLORS: string[];
}

const CATEGORY_CHART_COLORS = [
  "#16A085", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6",
  "#10b981", "#ef4444", "#06b6d4", "#84cc16", "#64748b"
];

export default function DashboardTab(props: DashboardTabProps) {
  const {
    timeFilter, setTimeFilter,
    locationType, setLocationType,
    selectedLocation, setSelectedLocation,
    totalPlatformSales, totalPlatformOrders,
    dynamicBarData, dynamicTrendData,
    mapPoints, dashboardStats,
    bannedUsersCount, pendingAppealsCount, pendingShopsCount,
    issueStatusData, COLORS
  } = props;

  const categorySalesList: CategorySalesDto[] = dashboardStats?.categorySales || [];
  const topProductsList: TopProductDto[] = dashboardStats?.topProducts || [];
  const totalCatSalesAmount = categorySalesList.reduce((acc, c) => acc + c.totalSales, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-white p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl border border-gray-100 shadow-2xs">
        <div>
          <h2 className="text-lg sm:text-2xl font-black text-gray-800 flex items-center gap-2 sm:gap-3">
            <i className="fa-solid fa-chart-line text-[#16A085]"></i> สรุปผลแพลตฟอร์ม
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">ภาพรวมการเติบโต ยอดขาย และกิจกรรมทั้งหมดบน VRU Marketplace</p>
        </div>
        
        <div className="grid grid-cols-1 xs:grid-cols-2 sm:flex sm:flex-row flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
          <CustomSelect 
            value={timeFilter}
            onChange={setTimeFilter}
            options={[
              { label: "วันนี้", value: "TODAY" },
              { label: "สัปดาห์นี้", value: "WEEK" },
              { label: "เดือนนี้", value: "MONTH" },
              { label: "ปีนี้", value: "YEAR" }
            ]}
            className="w-full sm:w-auto text-xs sm:text-sm"
          />
          
          <div className="flex gap-1 sm:gap-2 bg-gray-100 p-1 rounded-full items-center justify-center col-span-1 xs:col-span-2 sm:col-span-1">
            <button 
              onClick={() => { setLocationType("PROVINCE"); setSelectedLocation("ALL"); }}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs font-bold transition-all text-center ${locationType === "PROVINCE" ? "bg-white text-gray-800 shadow-2xs" : "text-gray-500 hover:text-gray-700"}`}
            >
              ระดับจังหวัด
            </button>
            <button 
              onClick={() => { setLocationType("COMMUNITY"); setSelectedLocation("ALL"); }}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-full text-xs font-bold transition-all text-center ${locationType === "COMMUNITY" ? "bg-white text-gray-800 shadow-2xs" : "text-gray-500 hover:text-gray-700"}`}
            >
              ระดับชุมชน
            </button>
          </div>

          <CustomSelect 
            value={selectedLocation}
            onChange={setSelectedLocation}
            options={[
              { label: "ภาพรวมทั้งหมด (All)", value: "ALL" },
              ...(locationType === "PROVINCE" 
                ? (dashboardStats?.salesByLocation || []).map((loc) => ({ label: loc.name, value: loc.name }))
                : (dashboardStats?.salesByLocation || []).map((com) => ({ label: com.name, value: com.name })))
            ]}
            className="w-full sm:w-auto text-xs sm:text-sm [&>button]:bg-teal-50 [&>button]:border-teal-200 [&>button]:text-teal-700"
          />
        </div>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="bg-gradient-to-br from-[#16A085] to-teal-700 p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl text-white shadow-2xs flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2 sm:mb-4">
            <div className="min-w-0 pr-1">
              <p className="text-teal-100 font-medium text-xs sm:text-sm truncate">ยอดขายรวมสุทธิ</p>
              <h3 className="text-base sm:text-2xl md:text-3xl font-black mt-0.5 sm:mt-1 truncate">฿{totalPlatformSales.toLocaleString()}</h3>
            </div>
            <div className="w-9 h-9 sm:w-12 sm:h-12 bg-white/20 rounded-xl sm:rounded-2xl flex items-center justify-center text-base sm:text-xl backdrop-blur-sm flex-shrink-0">
              <i className="fa-solid fa-sack-dollar"></i>
            </div>
          </div>
          <div className="text-[10px] sm:text-xs text-teal-100/90 font-medium flex items-center gap-1">
            <i className="fa-solid fa-circle-check"></i> รวมคำสั่งซื้อที่ยืนยันแล้ว
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl shadow-2xs flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2 sm:mb-4">
            <div className="min-w-0 pr-1">
              <p className="text-gray-500 font-medium text-xs sm:text-sm truncate">จำนวนคำสั่งซื้อ</p>
              <h3 className="text-base sm:text-2xl md:text-3xl font-black mt-0.5 sm:mt-1 text-gray-800 truncate">{totalPlatformOrders.toLocaleString()} <span className="text-[10px] sm:text-xs font-normal text-gray-400">ออเดอร์</span></h3>
            </div>
            <div className="w-9 h-9 sm:w-12 sm:h-12 bg-blue-50 text-blue-500 rounded-xl sm:rounded-2xl flex items-center justify-center text-base sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-bag-shopping"></i>
            </div>
          </div>
          <div className="text-[10px] sm:text-xs text-blue-600 font-medium flex items-center gap-1">
            <i className="fa-solid fa-receipt"></i> นับตามรอบเวลาที่เลือก
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl shadow-2xs flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2 sm:mb-4">
            <div className="min-w-0 pr-1">
              <p className="text-gray-500 font-medium text-xs sm:text-sm truncate">ยอดสั่งซื้อเฉลี่ย (AOV)</p>
              <h3 className="text-base sm:text-2xl md:text-3xl font-black mt-0.5 sm:mt-1 text-gray-800 truncate">
                ฿{totalPlatformOrders > 0 ? Math.round(totalPlatformSales / totalPlatformOrders).toLocaleString() : "0"}
              </h3>
            </div>
            <div className="w-9 h-9 sm:w-12 sm:h-12 bg-purple-50 text-purple-500 rounded-xl sm:rounded-2xl flex items-center justify-center text-base sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-calculator"></i>
            </div>
          </div>
          <div className="text-[10px] sm:text-xs text-purple-600 font-medium flex items-center gap-1">
            <i className="fa-solid fa-chart-simple"></i> เฉลี่ยต่อคำสั่งซื้อ
          </div>
        </div>

        <div className="bg-white border border-gray-100 p-3.5 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl shadow-2xs flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2 sm:mb-4">
            <div className="min-w-0 pr-1">
              <p className="text-gray-500 font-medium text-xs sm:text-sm truncate">ชุมชนเครือข่าย มรว.</p>
              <h3 className="text-base sm:text-2xl md:text-3xl font-black mt-0.5 sm:mt-1 text-gray-800 truncate">
                {(dashboardStats?.salesByLocation || []).length} <span className="text-[10px] sm:text-xs font-normal text-gray-400">แห่ง</span>
              </h3>
            </div>
            <div className="w-9 h-9 sm:w-12 sm:h-12 bg-amber-50 text-amber-500 rounded-xl sm:rounded-2xl flex items-center justify-center text-base sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-landmark"></i>
            </div>
          </div>
          <div className="text-[10px] sm:text-xs text-amber-600 font-medium flex items-center gap-1">
            <i className="fa-solid fa-location-dot"></i> ปทุมธานี & อยุธยา
          </div>
        </div>
      </div>

      {/* Main Trend Line & Bar Composed Chart */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 sm:mb-6">
          <h4 className="font-bold text-gray-800 text-xs sm:text-base flex items-center gap-2">
            <i className="fa-solid fa-arrow-trend-up text-blue-500"></i> แนวโน้มยอดขายและจำนวนคำสั่งซื้อรายวัน
          </h4>
          <span className="text-xs text-gray-400 font-medium">แกนซ้าย: ยอดขาย (บาท) | แกนขวา: จำนวนออเดอร์</span>
        </div>
        <div className="h-64 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dynamicTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => Number(value).toLocaleString()} width={50} />
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={35} />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                formatter={(value, name) => {
                  if (name === 'ยอดสั่งซื้อ') return [`${Number(value).toLocaleString()} ออเดอร์`, name];
                  return [`฿${Number(value).toLocaleString()}`, name];
                }}
                labelStyle={{ fontWeight: 'bold', color: '#374151' }}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', paddingBottom: '10px' }} />
              <Bar yAxisId="left" dataKey="sales" name="ยอดขายรวม (บาท)" fill="#16A085" opacity={0.8} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line yAxisId="right" type="monotone" dataKey="orders" name="ยอดสั่งซื้อ" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 0, fill: '#3b82f6' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* NEW: Sales by Category & Top Products Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Sales by Category (Donut Chart & List) */}
        <div className="lg:col-span-5 bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-gray-800 text-xs sm:text-base flex items-center gap-2">
              <i className="fa-solid fa-layer-group text-[#16A085]"></i> สัดส่วนยอดขายตามหมวดหมู่
            </h4>
            <span className="text-[11px] font-bold text-[#16A085] bg-teal-50 px-2.5 py-1 rounded-full border border-teal-100">
              {categorySalesList.length} หมวดหมู่
            </span>
          </div>

          <div className="h-56 sm:h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categorySalesList}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="totalSales"
                  nameKey="name"
                  label={({ percent = 0 }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {categorySalesList.map((entry, index) => {
                    const presetColor = entry.color && COLOR_PRESETS[entry.color] ? COLOR_PRESETS[entry.color].dotBg : null;
                    const fill = presetColor ? undefined : CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length];
                    return (
                      <Cell
                        key={`cat-cell-${index}`}
                        fill={fill || CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value, name) => [`฿${Number(value).toLocaleString()}`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category List Breakdown */}
          <div className="space-y-2 mt-2 max-h-56 overflow-y-auto pr-1">
            {categorySalesList.map((cat, idx) => {
              const style = getCategoryStyle({ name: cat.name, icon: cat.icon, color: cat.color });
              const pct = totalCatSalesAmount > 0 ? ((cat.totalSales / totalCatSalesAmount) * 100).toFixed(1) : "0";
              return (
                <div key={cat.categoryId || idx} className="flex items-center justify-between p-2 rounded-xl bg-gray-50/80 hover:bg-gray-100/80 transition-colors text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-7 h-7 rounded-lg ${style.bgColor} ${style.textColor} flex items-center justify-center text-xs flex-shrink-0`}>
                      <i className={`fa-solid ${style.icon}`}></i>
                    </div>
                    <span className="font-bold text-gray-800 truncate">{cat.name}</span>
                  </div>
                  <div className="text-right flex-shrink-0 pl-2">
                    <span className="font-black text-gray-900">฿{cat.totalSales.toLocaleString()}</span>
                    <span className="text-gray-400 text-[10px] ml-1.5 font-medium">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 5 Best-Selling Products Leaderboard */}
        <div className="lg:col-span-7 bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-gray-800 text-xs sm:text-base flex items-center gap-2">
              <i className="fa-solid fa-crown text-amber-500"></i> 5 อันดับสินค้าขายดีที่สุด (Top Products)
            </h4>
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              Hero Products
            </span>
          </div>

          <div className="divide-y divide-gray-100 flex-1 flex flex-col justify-between">
            {topProductsList.map((prod, idx) => {
              const rank = idx + 1;
              const rankBadge = 
                rank === 1 ? "bg-amber-500 text-white shadow-xs" :
                rank === 2 ? "bg-slate-400 text-white shadow-xs" :
                rank === 3 ? "bg-amber-700 text-white shadow-xs" :
                "bg-gray-100 text-gray-600";

              const style = getCategoryStyle({ name: prod.categoryName, icon: prod.categoryIcon, color: prod.categoryColor });

              return (
                <div key={prod.productId || idx} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${rankBadge}`}>
                      {rank}
                    </div>
                    <div className={`w-9 h-9 rounded-xl ${style.bgColor} ${style.textColor} flex items-center justify-center text-sm flex-shrink-0`}>
                      <i className={`fa-solid ${style.icon}`}></i>
                    </div>
                    <div className="min-w-0">
                      <h5 className="font-bold text-gray-800 text-xs sm:text-sm truncate" title={prod.name}>
                        {prod.name}
                      </h5>
                      <div className="text-[11px] text-gray-400 flex items-center gap-2 truncate mt-0.5">
                        <span className="truncate">{prod.shopName}</span>
                        <span>•</span>
                        <span className="text-[#16A085] truncate font-medium">{prod.communityName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className="font-black text-gray-900 text-xs sm:text-sm">฿{prod.totalSales.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400 font-medium">ขายแล้ว {prod.totalSold.toLocaleString()} ชิ้น</div>
                  </div>
                </div>
              );
            })}
            {topProductsList.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-xs">
                ยังไม่มีข้อมูลคำสั่งซื้อในรอบเวลานี้
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bar Chart: Sales & Orders by Location */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6">
          <h4 className="font-bold text-gray-800 text-xs sm:text-base mb-3 sm:mb-6 flex items-center gap-2">
            <i className="fa-solid fa-chart-column text-[#16A085]"></i> ยอดขายแยกตาม{locationType === "PROVINCE" ? "จังหวัด" : "ชุมชน"} (บาท)
          </h4>
          <div className="h-60 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dynamicBarData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => Number(value).toLocaleString()} width={50} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => [`฿${Number(value).toLocaleString()}`, 'ยอดขาย']} />
                <Bar dataKey="sales" name="ยอดขาย" fill="#16A085" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {dynamicBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6">
          <h4 className="font-bold text-gray-800 text-xs sm:text-base mb-3 sm:mb-6 flex items-center gap-2">
            <i className="fa-solid fa-boxes-stacked text-blue-500"></i> จำนวนออเดอร์แยกตาม{locationType === "PROVINCE" ? "จังหวัด" : "ชุมชน"}
          </h4>
          <div className="h-60 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dynamicBarData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => Number(value).toLocaleString()} width={40} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => [`${Number(value).toLocaleString()} ออเดอร์`, 'จำนวนออเดอร์']} />
                <Bar dataKey="orders" name="จำนวนออเดอร์" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {dynamicBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#3b82f6', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6'][index % 5]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Heat Map Section (Option 3: Perfectly tuned with VRU coordinates) */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 sm:mb-4">
          <h4 className="font-bold text-gray-800 text-xs sm:text-base flex items-center gap-2">
            <i className="fa-solid fa-map-location-dot text-red-500"></i> แผนที่ความหนาแน่นยอดขายบนแพลตฟอร์ม (Heat Map)
          </h4>
          <span className="text-xs text-[#16A085] bg-teal-50 px-3 py-1 rounded-full font-bold border border-teal-200">
            <i className="fa-solid fa-location-crosshairs mr-1"></i> จุดกึ่งกลาง: มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ (ปทุมธานี)
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          แสดงความหนาแน่นของยอดขายตามพิกัดชุมชนเครือข่าย มรว. (คลิกที่หมุดบนแผนที่เพื่อดูชื่อชุมชนและยอดขาย)
        </p>
        <HeatMapDisplay 
          points={mapPoints} 
          centerLat={14.1325} 
          centerLng={100.6150} 
          zoom={11} 
        />
      </div>

      {/* Issues & Reports Dashboard */}
      <div>
        <h3 className="text-base sm:text-xl font-black text-gray-800 mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3">
          <i className="fa-solid fa-triangle-exclamation text-orange-500"></i> สรุปปัญหาและข้อร้องเรียนแพลตฟอร์ม
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-red-50 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-red-100 shadow-2xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-100 text-red-600 rounded-xl sm:rounded-2xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-user-slash"></i>
            </div>
            <div className="min-w-0">
              <p className="text-red-800 text-[11px] sm:text-xs font-bold mb-0.5 truncate">ผู้ใช้ที่ถูกระงับ (Banned)</p>
              <h3 className="text-xl sm:text-2xl font-black text-red-600">{bannedUsersCount} <span className="text-xs sm:text-sm font-medium">บัญชี</span></h3>
            </div>
          </div>
          <div className="bg-orange-50 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-orange-100 shadow-2xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-100 text-orange-600 rounded-xl sm:rounded-2xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-gavel"></i>
            </div>
            <div className="min-w-0">
              <p className="text-orange-800 text-[11px] sm:text-xs font-bold mb-0.5 truncate">ข้อพิพาทที่รอตัดสิน (Pending)</p>
              <h3 className="text-xl sm:text-2xl font-black text-orange-600">{pendingAppealsCount} <span className="text-xs sm:text-sm font-medium">คดี</span></h3>
            </div>
          </div>
          <div className="bg-yellow-50 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-yellow-100 shadow-2xs flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-yellow-100 text-yellow-600 rounded-xl sm:rounded-2xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0">
              <i className="fa-solid fa-shop-lock"></i>
            </div>
            <div className="min-w-0">
              <p className="text-yellow-800 text-[11px] sm:text-xs font-bold mb-0.5 truncate">ร้านค้าที่รอตรวจสอบ</p>
              <h3 className="text-xl sm:text-2xl font-black text-yellow-600">{pendingShopsCount} <span className="text-xs sm:text-sm font-medium">ร้าน</span></h3>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xs border border-gray-100 p-3.5 sm:p-5 md:p-6 flex flex-col">
          <h4 className="font-bold text-gray-800 text-xs sm:text-base mb-2 flex items-center gap-2">
            <i className="fa-solid fa-chart-pie text-red-500"></i> สัดส่วนสถานะข้อพิพาท
          </h4>
          <div className="flex-grow flex items-center justify-center min-h-[240px]">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={issueStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  nameKey="name"
                  label={({ percent = 0 }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {issueStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#f59e0b', '#3b82f6', '#10b981', '#ef4444'][index % 4]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value) => [`${value} คดี`, 'จำนวน']}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
