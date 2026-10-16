
"use client";
import React from "react";
import { BarChart, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Line } from "recharts";
import CustomSelect from "@/components/ui/CustomSelect";
import HeatMapDisplay, { HeatMapPoint } from "@/components/map/HeatMapDisplay";
import type { IssueStatusDto, LocationStatsDto, PlatformDashboardDto, TrendPointDto } from "@/lib/api-modules/super-admin";

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

  return (
    
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                  <i className="fa-solid fa-chart-line text-[#16A085]"></i> สรุปผลแพลตฟอร์ม
                </h2>
                
                <div className="flex flex-row flex-wrap gap-3 w-full sm:w-auto">
                  <CustomSelect 
                    value={timeFilter}
                    onChange={setTimeFilter}
                    options={[
                      { label: "วันนี้", value: "TODAY" },
                      { label: "สัปดาห์นี้", value: "WEEK" },
                      { label: "เดือนนี้", value: "MONTH" },
                      { label: "ปีนี้", value: "YEAR" }
                    ]}
                  />
                  
                  <div className="flex gap-2 bg-gray-100 p-1 rounded-full items-center">
                    <button 
                      onClick={() => { setLocationType("PROVINCE"); setSelectedLocation("ALL"); }}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${locationType === "PROVINCE" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      ระดับจังหวัด
                    </button>
                    <button 
                      onClick={() => { setLocationType("COMMUNITY"); setSelectedLocation("ALL"); }}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${locationType === "COMMUNITY" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
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
                    className="[&>button]:bg-teal-50 [&>button]:border-teal-200 [&>button]:text-teal-700"
                  />
                </div>
              </div>

              {/* Stats Overview */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-[#16A085] to-teal-700 p-6 rounded-3xl text-white shadow-sm flex flex-col justify-between">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-teal-100 font-medium text-sm">ยอดขายรวมสุทธิ</p>
                      <h3 className="text-3xl font-black mt-1">฿{totalPlatformSales.toLocaleString()}</h3>
                    </div>
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-xl backdrop-blur-sm">
                      <i className="fa-solid fa-sack-dollar"></i>
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-gray-100 p-6 rounded-3xl shadow-sm flex flex-col justify-between">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-gray-500 font-medium text-sm">จำนวนออเดอร์ทั้งหมด</p>
                      <h3 className="text-3xl font-black mt-1 text-gray-800">{totalPlatformOrders.toLocaleString()}</h3>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center text-xl">
                      <i className="fa-solid fa-box"></i>
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                
                {/* Line Chart: Platform Trend (Spans 2 columns) */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 xl:col-span-2">
                  <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-arrow-trend-up text-blue-500"></i> แนวโน้มแพลตฟอร์ม (ยอดขายรายวัน/เดือน)
                  </h4>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dynamicTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} />
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString()} width={70} />
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={50} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value, name) => {
                            if (name === 'ยอดสั่งซื้อ') return [`${Number(value).toLocaleString()} ออเดอร์`, name];
                            return [`฿${Number(value).toLocaleString()}`, name];
                          }}
                          labelStyle={{ fontWeight: 'bold', color: '#374151' }}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }} />
                        {/* We use Bar for Sales (Gross) and Line for Orders to make a rich Composed Chart */}
                        <Bar yAxisId="left" dataKey="sales" name="ยอดขายรวม (บาท)" fill="#16A085" opacity={0.2} radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="orders" name="ยอดสั่งซื้อ" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6, strokeWidth: 0, fill: '#3b82f6' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                
                {/* Bar Chart: Sales by Location */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                  <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-chart-column text-[#16A085]"></i> ยอดขายแยกตาม{locationType === "PROVINCE" ? "จังหวัด" : "ชุมชน"} (บาท)
                  </h4>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dynamicBarData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString()} width={70} />
                        <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => [`฿${Number(value).toLocaleString()}`, 'ยอดขาย']} />
                        <Bar dataKey="sales" name="ยอดขาย" fill="#16A085" radius={[6, 6, 0, 0]} maxBarSize={40}>
                          {dynamicBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Bar Chart: Orders by Location */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                  <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-boxes-stacked text-blue-500"></i> จำนวนออเดอร์แยกตาม{locationType === "PROVINCE" ? "จังหวัด" : "ชุมชน"}
                  </h4>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dynamicBarData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString()} width={50} />
                        <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => [`${Number(value).toLocaleString()} ออเดอร์`, 'จำนวนออเดอร์']} />
                        <Bar dataKey="orders" name="จำนวนออเดอร์" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={40}>
                          {dynamicBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#3b82f6', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6'][index % 5]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Pie Chart: Communities by Province */}
                {locationType === "PROVINCE" && selectedLocation === "ALL" && (
                  <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col xl:col-span-2">
                    <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                      <i className="fa-solid fa-chart-pie text-purple-500"></i> สัดส่วนชุมชนรายจังหวัด
                    </h4>
                    <div className="flex-grow flex items-center justify-center min-h-[300px]">
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={dashboardStats?.salesByLocation || []}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={120}
                            paddingAngle={5}
                            dataKey="communities"
                            nameKey="name"
                            label={({ percent = 0 }) => `${(percent * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            {(dashboardStats?.salesByLocation || []).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value) => [`${value} ชุมชน`, 'จำนวนชุมชน']} />
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
                {/* Heat Map Section */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 mt-8">
                  <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-map-location-dot text-red-500"></i> แผนที่ความหนาแน่นยอดขายบนแพลตฟอร์ม (Heat Map)
                  </h4>
                  <HeatMapDisplay 
                    points={mapPoints} 
                    centerLat={14.1500} 
                    centerLng={100.8000} 
                    zoom={9} 
                  />
                </div>

              {/* Issues & Reports Dashboard */}
              <div className="mt-8">
                <h3 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-3">
                  <i className="fa-solid fa-triangle-exclamation text-orange-500"></i> สรุปปัญหาและข้อร้องเรียนแพลตฟอร์ม
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-red-50 p-5 rounded-3xl border border-red-100 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center text-xl">
                      <i className="fa-solid fa-user-slash"></i>
                    </div>
                    <div>
                      <p className="text-red-800 text-xs font-bold mb-1">ผู้ใช้ที่ถูกระงับ (Banned)</p>
                      <h3 className="text-2xl font-black text-red-600">{bannedUsersCount} <span className="text-sm font-medium">บัญชี</span></h3>
                    </div>
                  </div>
                  <div className="bg-orange-50 p-5 rounded-3xl border border-orange-100 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center text-xl">
                      <i className="fa-solid fa-gavel"></i>
                    </div>
                    <div>
                      <p className="text-orange-800 text-xs font-bold mb-1">ข้อพิพาทที่รอตัดสิน (Pending)</p>
                      <h3 className="text-2xl font-black text-orange-600">{pendingAppealsCount} <span className="text-sm font-medium">คดี</span></h3>
                    </div>
                  </div>
                  <div className="bg-yellow-50 p-5 rounded-3xl border border-yellow-100 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 text-yellow-600 rounded-2xl flex items-center justify-center text-xl">
                      <i className="fa-solid fa-shop-lock"></i>
                    </div>
                    <div>
                      <p className="text-yellow-800 text-xs font-bold mb-1">ร้านค้าที่รอตรวจสอบ</p>
                      <h3 className="text-2xl font-black text-yellow-600">{pendingShopsCount} <span className="text-sm font-medium">ร้าน</span></h3>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 flex flex-col">
                    <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                      <i className="fa-solid fa-chart-pie text-red-500"></i> สัดส่วนสถานะข้อพิพาท
                    </h4>
                    <div className="flex-grow flex items-center justify-center min-h-[300px]">
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={issueStatusData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
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
                          <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Bar Chart: Issues by Location */}
                  <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                    <h4 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                      <i className="fa-solid fa-triangle-exclamation text-orange-500"></i> ปัญหาแยกตาม{locationType === "PROVINCE" ? "จังหวัด" : "ชุมชน"} (คดี)
                    </h4>
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dynamicBarData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => Number(value).toLocaleString()} width={70} />
                          <Tooltip 
                            contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(value) => [`${Number(value).toLocaleString()} คดี`, 'จำนวนปัญหา']}
                          />
                          <Bar dataKey="issues" name="จำนวนปัญหา" fill="#f97316" radius={[6, 6, 0, 0]} maxBarSize={40}>
                            {dynamicBarData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={['#ef4444', '#f97316', '#f59e0b', '#8b5cf6', '#3b82f6'][index % 5]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>


              </div>

    </div>
  );
}



