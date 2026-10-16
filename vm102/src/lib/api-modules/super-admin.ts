import { api } from "./core";

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
}

export interface IssueStatusDto {
  name: string;
  value: number;
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
    const raw = await api.get<BackendPlatformDashboardResponse>(`/admin/dashboard/platform${queryString ? `?${queryString}` : ''}`);
    if (raw && (raw.users || raw.communities || raw.admins)) {
      return {
        totalCommunities: raw.communities?.total ?? 0,
        totalAdmins: (raw.admins?.superAdmins ?? 0) + (raw.admins?.communityAdmins ?? 0),
        totalUsers: raw.users?.total ?? 0,
        totalAppeals: 0,
        totalSales: 0,
        totalOrders: 0,
        bannedUsers: raw.users?.banned ?? 0,
        pendingAppeals: raw.users?.erasureQueued ?? 0,
        pendingShops: 0,
        salesByLocation: [],
        platformTrend: [],
        issueStatus: [],
      };
    }
    return (raw as unknown as PlatformDashboardDto) || {
      totalCommunities: 0,
      totalAdmins: 0,
      totalUsers: 0,
      totalAppeals: 0,
      totalSales: 0,
      totalOrders: 0,
      bannedUsers: 0,
      pendingAppeals: 0,
      pendingShops: 0,
      salesByLocation: [],
      platformTrend: [],
      issueStatus: [],
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

