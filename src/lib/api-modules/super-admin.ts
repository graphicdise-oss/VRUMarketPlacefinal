import { api } from "./core";
import type { HeatMapPoint } from "@/components/map/HeatMapDisplay";

export interface SuperAdminUserDto {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  bannedAt: string | null;
  adminCommunityIds: string[];
  hasOpenShop: boolean;
}

export interface LocationStatsDto {
  name: string;
  sales: number;
  orders: number;
  communities: number;
  issues: number;
}

export interface TrendPointDto {
  name: string;
  orders: number;
  sales?: number;
}

export interface IssueStatusDto {
  name: string;
  value: number;
}

export interface CategorySalesDto {
  categoryId: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  totalSales: number;
  totalQuantity: number;
}

export interface TopProductDto {
  productId: string;
  name: string;
  shopName: string;
  communityName: string;
  categoryName: string;
  categoryIcon?: string | null;
  categoryColor?: string | null;
  totalSales: number;
  totalSold: number;
  imageId?: string | null;
}

export interface PlatformDashboardDto {
  totalCommunities: number;
  totalAdmins: number;
  totalUsers: number;
  totalAppeals: number;
  totalSales: number;
  totalOrders: number;
  bannedUsers: number;
  pendingAppeals: number;
  pendingShops: number;
  salesByLocation: LocationStatsDto[];
  platformTrend: TrendPointDto[];
  issueStatus: IssueStatusDto[];
  mapPoints?: HeatMapPoint[];
  categorySales?: CategorySalesDto[];
  topProducts?: TopProductDto[];
}

function resolvePlatformDateRange(timeFilter?: string): { from?: string; to?: string } {
  if (!timeFilter) return {};
  const now = new Date();
  const toStr = now.toISOString().split('T')[0];
  let daysBack = 29;
  if (timeFilter === 'TODAY' || timeFilter === 'DAY') daysBack = 0;
  else if (timeFilter === 'WEEK' || timeFilter === '7DAYS') daysBack = 6;
  else if (timeFilter === 'MONTH' || timeFilter === '30DAYS') daysBack = 29;
  else if (timeFilter === '12MONTHS' || timeFilter === 'YEAR') daysBack = 364;

  const fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().split('T')[0];
  return { from: fromStr, to: toStr };
}

interface BackendPlatformDashboardResponse {
  communities?: { total?: number };
  admins?: { superAdmins?: number; communityAdmins?: number };
  users?: { total?: number; banned?: number; erasureQueued?: number };
}

export const superAdminApi = {
  getDashboard: async (timeFilter: string, locationType?: string, selectedLocation?: string): Promise<PlatformDashboardDto> => {
    void locationType;
    void selectedLocation;
    const params = new URLSearchParams();
    const { from, to } = resolvePlatformDateRange(timeFilter);
    if (from) params.append("from", from);
    if (to) params.append("to", to);
    const queryString = params.toString();
    const [raw, rawAdmin] = await Promise.all([
      api.get<BackendPlatformDashboardResponse>(`/admin/dashboard/platform${queryString ? `?${queryString}` : ''}`).catch(() => null),
      api.get<{
        total?: {
          queue?: { pendingShops?: number; openDisputes?: number; frozenOrders?: number };
          sales?: { itemsMinor?: number; shippingFeesMinor?: number; orderCount?: number; ordersCount?: number; amountMinor?: number; confirmed?: number; daily?: { date: string; orderCount?: number; ordersCount?: number; amountMinor?: number; itemsMinor?: number }[] };
        };
        communities?: { name: string; queue?: { openDisputes?: number }; sales?: { amountMinor?: number; itemsMinor?: number; orderCount?: number; ordersCount?: number } }[];
        categorySales?: CategorySalesDto[];
        topProducts?: TopProductDto[];
      }>(`/admin/dashboard${queryString ? `?${queryString}` : ''}`).catch(() => null),
    ]);

    const adminTotal = rawAdmin?.total;
    const q = adminTotal?.queue;
    const s = adminTotal?.sales;
    const totalSales = s ? ((s.amountMinor ?? s.itemsMinor ?? 0) / 100) : 0;
    const totalOrders = s ? (s.orderCount ?? s.ordersCount ?? s.confirmed ?? 0) : 0;
    const pendingShops = q?.pendingShops ?? 0;
    const openDisputes = q?.openDisputes ?? 0;
    const frozenOrders = q?.frozenOrders ?? 0;

    const trend: TrendPointDto[] = (s?.daily || []).map((pt) => ({
      name: pt.date,
      orders: pt.orderCount ?? pt.ordersCount ?? 0,
      sales: ((pt.amountMinor ?? pt.itemsMinor ?? 0) / 100),
    }));

    const salesByLocation: LocationStatsDto[] = (rawAdmin?.communities || []).map((c) => ({
      name: c.name,
      sales: ((c.sales?.amountMinor ?? c.sales?.itemsMinor ?? 0) / 100),
      orders: c.sales?.orderCount ?? c.sales?.ordersCount ?? 0,
      communities: 1,
      issues: c.queue?.openDisputes ?? 0,
    }));

    // Real GPS coordinates around VRU (Pathum Thani / Ayutthaya / Saraburi)
    const COMMUNITY_COORDS: Record<string, { lat: number; lng: number }> = {
      "วิสาหกิจชุมชนเกษตรอินทรีย์ มรว.": { lat: 14.1325, lng: 100.6150 },
      "กลุ่มแปรรูปผลิตภัณฑ์สมุนไพรและนวัตกรรม มรว.": { lat: 14.1180, lng: 100.6280 },
      "ศูนย์ส่งเสริมผ้าทอพื้นเมืองปทุมธานี": { lat: 14.0200, lng: 100.5300 },
      "วิสาหกิจชุมชนหัตถกรรมจักสานบางปะอิน": { lat: 14.2250, lng: 100.5750 },
    };

    const mapPoints: HeatMapPoint[] = (rawAdmin?.communities || []).map((c, idx) => {
      const coord = COMMUNITY_COORDS[c.name] || {
        lat: 14.1325 + (idx % 3) * 0.03 - 0.03,
        lng: 100.6150 + (idx % 3) * 0.04 - 0.04,
      };
      const rawSales = ((c.sales?.amountMinor ?? c.sales?.itemsMinor ?? 0) / 100);
      // Ensure positive weight so heatmap & markers are always interactive
      const weight = rawSales > 0 ? rawSales : 1000;
      return {
        id: c.name || `pt-${idx}`,
        lat: coord.lat,
        lng: coord.lng,
        weight,
        shopName: `${c.name} (ยอดขาย: ฿${rawSales.toLocaleString()})`,
      };
    });

    const issueStatus: IssueStatusDto[] = [
      { name: "ร้านค้ารออนุมัติ", value: pendingShops },
      { name: "ข้อพิพาทรอดำเนินการ", value: openDisputes },
      { name: "ออเดอร์แช่แข็ง", value: frozenOrders },
    ];

    const categorySales = rawAdmin?.categorySales || [];
    const topProducts = rawAdmin?.topProducts || [];

    if (raw && (raw.users || raw.communities || raw.admins)) {
      return {
        totalCommunities: raw.communities?.total ?? 0,
        totalAdmins: (raw.admins?.superAdmins ?? 0) + (raw.admins?.communityAdmins ?? 0),
        totalUsers: raw.users?.total ?? 0,
        totalAppeals: openDisputes,
        totalSales,
        totalOrders,
        bannedUsers: raw.users?.banned ?? 0,
        pendingAppeals: raw.users?.erasureQueued ?? 0,
        pendingShops,
        salesByLocation,
        platformTrend: trend,
        issueStatus,
        mapPoints,
        categorySales,
        topProducts,
      };
    }
    return (raw as unknown as PlatformDashboardDto) || {
      totalCommunities: 0,
      totalAdmins: 0,
      totalUsers: 0,
      totalAppeals: openDisputes,
      totalSales,
      totalOrders,
      bannedUsers: 0,
      pendingAppeals: 0,
      pendingShops,
      salesByLocation,
      platformTrend: trend,
      issueStatus,
      mapPoints,
      categorySales,
      topProducts,
    };
  },
  searchUserByEmail: (email: string) => api.get<SuperAdminUserDto>(`/admin/users?email=${encodeURIComponent(email)}`),
  banUser: (id: string, reason: string) => api.post(`/admin/users/${id}/ban`, { reason }),
  unbanUser: (id: string) => api.post(`/admin/users/${id}/unban`),
  eraseUser: (id: string, reason: string) => api.post(`/admin/users/${id}/erase`, { reason }),
  broadcastNotification: (audience: string, message: string) => api.post<{ success: boolean }>(`/admin/platform/notifications/broadcast`, { audience, message }),
  appointSuperAdmin: (email: string) => api.post<SuperAdminAppointmentDto>(`/admin/super-admins`, { email }),
};

export interface SuperAdminAppointmentDto {
  outcome: 'PROMOTED';
  userId: string;
  foldedCommunityIds: string[];
}

export interface AuditLogEntryDto {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  communityId: string | null;
  reason: string | null;
  createdAt: string;
}

export const auditLogApi = {
  list: (params?: { actorUserId?: string; action?: string; targetId?: string; communityId?: string; limit?: number; cursor?: string }) => {
    const query = new URLSearchParams();
    if (params?.actorUserId) query.append("actorUserId", params.actorUserId);
    if (params?.action) query.append("action", params.action);
    if (params?.targetId) query.append("targetId", params.targetId);
    if (params?.communityId) query.append("communityId", params.communityId);
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.cursor) query.append("cursor", params.cursor);
    return api.get<{ items: AuditLogEntryDto[]; nextCursor?: string; hasMore: boolean }>(`/admin/audit-log?${query.toString()}`);
  },
};

