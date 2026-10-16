import { api } from "./core";

export interface PublicShopDto {
  id: string;
  name: string;
  description: string | null;
  communityId: string;
  communityName?: string;
  hasLogo: boolean;
  hasBanner: boolean;
  province: string | null;
  productCount: number;
  averageRating: number | null;
  reviewCount: number;
  approvalStatus: string;
  createdAt: string;
}

export interface MyShopDto {
  id: string;
  communityId: string;
  name: string;
  description: string | null;
  hasLogo: boolean;
  hasBanner?: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  closedAt: string | null;
  suspendedAt: string | null;
  rejectionReason: string | null;
  pendingName: string | null;
  pendingDescription: string | null;
  hasPendingLogo: boolean;
  profileChangeRequestedAt: string | null;
  profileChangeRejectionReason: string | null;
  createdAt: string;
}

export const shopApi = {
  apply: (data: { communityId: string; name: string }) => api.post<MyShopDto>("/shops", data),
  getMine: () => api.get<MyShopDto>("/shops/me"),
  getById: (id: string) => api.get<PublicShopDto>(`/shops/${id}`),
  updateProfile: (data: { name: string; description: string | null }) => api.patch<MyShopDto>("/shops/me", data),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<MyShopDto>("/shops/me/logo", formData);
  },
  uploadBanner: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<MyShopDto>("/shops/me/banner", formData);
  },
  deleteBanner: () => api.delete<MyShopDto>("/shops/me/banner"),
  listPublic: (params?: { communityId?: string; cursor?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.communityId) query.append("communityId", params.communityId);
    if (params?.cursor) query.append("cursor", params.cursor);
    query.append("limit", (params?.limit || 50).toString());
    return api.get<{ items: PublicShopDto[]; nextCursor?: string }>(`/shops?${query.toString()}`);
  },
  getFollowStatus: (id: string) => api.get<{ followerCount: number; isFollowing: boolean }>(`/shops/${id}/follow-status`),
  follow: (id: string) => api.post<{ success: boolean }>(`/shops/${id}/follow`, {}),
  unfollow: (id: string) => api.delete<{ success: boolean }>(`/shops/${id}/follow`),
};

export interface ShopStatsDto {
  awaitingShippingFeeCount: number;
  awaitingPaymentConfirmCount: number;
  awaitingShipmentCount: number;
  pendingRefundCount: number;
  actionableDisputeCount: number;
  awaitingBuyerPaymentCount: number;
  awaitingBuyerReceiveCount: number;
  frozenOrderCount: number;
  activeProductCount: number;
  pendingProductCount: number;
  rejectedProductCount: number;
  hiddenProductCount: number;
  totalSales: number;
  reviewAverage: number;
  reviewCount: number;
  followerCount: number;
}

export const shopAnalyticsApi = {
  getSummary: async (): Promise<ShopStatsDto> => {
    type Raw = Record<string, Record<string, number> | undefined>;
    const raw = await api.get<Raw & ShopStatsDto>("/shops/me/dashboard") as Raw & ShopStatsDto;
    if (raw && (raw.todo || raw.sales || raw.catalog)) {
      return {
        awaitingShippingFeeCount: raw.todo?.awaitingShippingQuote ?? 0,
        awaitingPaymentConfirmCount: raw.todo?.awaitingPaymentConfirmation ?? 0,
        awaitingShipmentCount: raw.todo?.awaitingShipment ?? 0,
        pendingRefundCount: raw.todo?.awaitingRefundSlip ?? 0,
        actionableDisputeCount: raw.todo?.disputesAwaitingResponse ?? 0,
        awaitingBuyerPaymentCount: raw.waiting?.awaitingBuyerPayment ?? 0,
        awaitingBuyerReceiveCount: raw.waiting?.shippedAwaitingReceipt ?? 0,
        frozenOrderCount: raw.waiting?.frozen ?? 0,
        activeProductCount: raw.catalog?.live ?? 0,
        pendingProductCount: raw.catalog?.pendingReview ?? 0,
        rejectedProductCount: raw.catalog?.rejected ?? 0,
        hiddenProductCount: raw.catalog?.hiddenByShop ?? 0,
        totalSales: (raw.sales?.confirmed ?? 0) / 100, // convert minor units to baht
        reviewAverage: raw.rating?.averageRating ?? 0,
        reviewCount: raw.rating?.reviewCount ?? 0,
        followerCount: 0,
      };
    }
    return raw as ShopStatsDto;
  },
};

export interface ShopAnalyticsSummaryDto {
  id: string;
  name: string;
  sales: number;
  orders: number;
  volume: number;
  products: number;
  lat: number;
  lng: number;
}

export interface TrendDataDto {
  name: string;
  orders: number;
}

export interface CommunityAnalyticsDto {
  shopData: ShopAnalyticsSummaryDto[];
  trendData: TrendDataDto[];
}

export const communityAnalyticsApi = {
  getDashboard: (communityId: string, timeFilter: string = 'WEEK') => 
    api.get<CommunityAnalyticsDto>(`/communities/${communityId}/analytics/dashboard?timeFilter=${timeFilter}`),
};

export const shopPaymentApi = {
  create: (data: {
    type: "BANK_TRANSFER" | "PROMPTPAY";
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    promptPayId?: string;
  }) => api.post<PaymentChannelDto>("/shops/me/payment-channels", data),
  list: () => api.get<PaymentChannelDto[]>("/shops/me/payment-channels"),
};

export interface PaymentChannelDto {
  id: string;
  type: "BANK_TRANSFER" | "PROMPTPAY";
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  promptPayId: string | null;
  hasQrImage: boolean;
  createdAt: string;
  updatedAt: string;
}

export const paymentChannelApi = {
  list: () => api.get<PaymentChannelDto[]>("/shops/me/payment-channels"),
  create: (data: Omit<PaymentChannelDto, 'id' | 'hasQrImage' | 'createdAt' | 'updatedAt'>) => api.post<PaymentChannelDto>("/shops/me/payment-channels", data),
  update: (id: string, data: Omit<PaymentChannelDto, 'id' | 'hasQrImage' | 'createdAt' | 'updatedAt'>) => api.patch<PaymentChannelDto>(`/shops/me/payment-channels/${id}`, data),
  delete: (id: string) => api.delete<void>(`/shops/me/payment-channels/${id}`),
  uploadQr: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<PaymentChannelDto>(`/shops/me/payment-channels/${id}/qr-image`, formData);
  },
};
