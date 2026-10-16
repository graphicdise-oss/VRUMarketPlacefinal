import { api } from "./core";
import { ProductDto } from "./product";

export interface ShopAdminDto {
  id: string;
  communityId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  description: string | null;
  hasLogo: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  closedAt: string | null;
  suspendedAt: string | null;
  ownerBannedAt: string | null;
  rejectionReason: string | null;
  ownerDisputeLostCount: number;
  ownerPriorDisputeLostCount: number;
  createdAt: string;
  reviewRevision: number;
  followerCount: number;
}

export const adminShopApi = {
  getPending: (cursor?: string) => api.get<{ items: ShopAdminDto[]; nextCursor?: string }>(`/shops/pending?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  approve: (id: string, reviewRevision: number) => api.post<ShopAdminDto>(`/shops/${id}/approve`, { reviewRevision }),
  reject: (id: string, reviewRevision: number, reason: string) => api.post<ShopAdminDto>(`/shops/${id}/reject`, { reviewRevision, reason }),
  suspend: (shopId: string, reason: string) => api.post<ShopAdminDto>(`/shops/${shopId}/suspend`, { reason }),
  unsuspend: (shopId: string) => api.post<ShopAdminDto>(`/shops/${shopId}/unsuspend`),
};

export const adminProductApi = {
  getPending: (cursor?: string) => api.get<{ items: ProductDto[]; nextCursor?: string }>(`/products/pending?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  approve: (id: string, reviewRevision: number) => api.post<ProductDto>(`/products/${id}/approve`, { reviewRevision }),
  reject: (id: string, reviewRevision: number, category: string, reason: string) => api.post<ProductDto>(`/products/${id}/reject`, { reviewRevision, category, reason }),
  getAdmin: (productId: string) => api.get<ProductDto>(`/products/${productId}/admin`),
};

export interface FrozenOrderQueueItemDto {
  id: string;
  shopId: string;
  communityId: string;
  status: string;
  frozenAt: string | null;
  freezeReasons: string[];
  totalAmountMinor: number | null;
  shippingAmountMinor: number | null;
  currency: string;
  items: {
    productNameAtPurchase: string;
    variantNameAtPurchase: string;
    priceAtPurchase: number;
    currency: string;
    quantity: number;
  }[];
  hasPaymentSlip: boolean;
  disputeAwaitingRulingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const adminFrozenOrderApi = {
  getQueue: (cursor?: string) => 
    api.get<{ items: FrozenOrderQueueItemDto[]; nextCursor?: string }>(`/frozen-orders?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  ruleFrozenOrder: (orderId: string, payload: { verdict: 'RELEASE' | 'TERMINATE'; reason: string }) => 
    api.post<void>(`/orders/${orderId}/freeze-ruling`, payload),
};

export interface AdminDashboardQueuesDto {
  pendingShopApprovals: number;
  pendingShopEdits: number;
  pendingProductChecks: number;
  openDisputes: number;
  frozenOrders: number;
}

export interface AdminDashboardOverviewDto {
  activeShops: number;
  suspendedShops: number;
  bannedOwners: number;
  activeProducts: number;
  ordersByStatus: Record<string, number>;
}

export interface AdminTrendDataDto {
  name: string;
  sales: number;
}

export interface AdminDashboardSalesDto {
  totalSales: number;
  trend: AdminTrendDataDto[];
}

export interface AdminDashboardDto {
  queues: AdminDashboardQueuesDto;
  overview: AdminDashboardOverviewDto;
  sales: AdminDashboardSalesDto;
}

interface DashboardDailyPoint {
  date?: string;
  label?: string;
  amountMinor?: number;
  confirmedSalesMinor?: number;
  sales?: number;
  orderCount?: number;
}

interface BackendDashboardQueue {
  pendingShops?: number;
  pendingProfileChanges?: number;
  pendingProducts?: number;
  openDisputes?: number;
  frozenOrders?: number;
}

interface BackendDashboardOverview {
  liveShops?: number;
  suspendedShops?: number;
  ownerBannedShops?: number;
  liveProducts?: number;
  ordersPlacedByStatus?: Record<string, number>;
}

interface BackendDashboardSales {
  amountMinor?: number;
  confirmed?: number;
  daily?: DashboardDailyPoint[];
  series?: DashboardDailyPoint[];
}

interface BackendDashboardFigures {
  queue?: BackendDashboardQueue;
  overview?: BackendDashboardOverview;
  sales?: BackendDashboardSales;
}

interface BackendAdminDashboardResponse {
  total?: BackendDashboardFigures;
  communities?: BackendDashboardFigures[];
}

function resolveDateRange(timeFilter?: string): { from?: string; to?: string } {
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

const isUUID = (str?: string): str is string => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export const adminDashboardApi = {
  getDashboard: async (communityIdFilter?: string, timeFilter: string = 'WEEK'): Promise<AdminDashboardDto> => {
    const params = new URLSearchParams();
    if (isUUID(communityIdFilter)) {
      params.append("communityId", communityIdFilter);
    }
    const { from, to } = resolveDateRange(timeFilter);
    if (from) params.append("from", from);
    if (to) params.append("to", to);

    const queryString = params.toString();
    const raw = await api.get<BackendAdminDashboardResponse>(`/admin/dashboard${queryString ? `?${queryString}` : ''}`);
    if (raw && (raw.total || raw.communities)) {
      const source = raw.total || (raw.communities && raw.communities[0]) || {};
      const q = source.queue || {};
      const o = source.overview || {};
      const s = source.sales || {};
      return {
        queues: {
          pendingShopApprovals: q.pendingShops ?? 0,
          pendingShopEdits: q.pendingProfileChanges ?? 0,
          pendingProductChecks: q.pendingProducts ?? 0,
          openDisputes: q.openDisputes ?? 0,
          frozenOrders: q.frozenOrders ?? 0,
        },
        overview: {
          activeShops: o.liveShops ?? 0,
          suspendedShops: o.suspendedShops ?? 0,
          bannedOwners: o.ownerBannedShops ?? 0,
          activeProducts: o.liveProducts ?? 0,
          ordersByStatus: o.ordersPlacedByStatus ?? {},
        },
        sales: {
          totalSales: (s.amountMinor ?? s.confirmed ?? 0) / 100,
          trend: Array.isArray(s.daily)
            ? s.daily.map((item: DashboardDailyPoint) => ({
                name: item.date || item.label || '',
                date: item.date || '',
                sales: (item.amountMinor ?? item.confirmedSalesMinor ?? item.sales ?? 0) / 100,
                orderCount: item.orderCount ?? 0,
              }))
            : Array.isArray(s.series)
            ? s.series.map((item: DashboardDailyPoint) => ({
                name: item.date || item.label || '',
                date: item.date || '',
                sales: (item.confirmedSalesMinor ?? item.sales ?? 0) / 100,
                orderCount: item.orderCount ?? 0,
              }))
            : [],
        },
      };
    }
    return (raw as unknown as AdminDashboardDto) || {
      queues: { pendingShopApprovals: 0, pendingShopEdits: 0, pendingProductChecks: 0, openDisputes: 0, frozenOrders: 0 },
      overview: { activeShops: 0, suspendedShops: 0, bannedOwners: 0, activeProducts: 0, ordersByStatus: {} },
      sales: { totalSales: 0, trend: [] }
    };
  }
};
