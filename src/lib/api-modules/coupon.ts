import { api } from "./core";

export type CouponDiscountType = "FIXED_AMOUNT" | "PERCENTAGE";

export interface CouponDto {
  id: string;
  shopId: string;
  shopName: string | null;
  code: string;
  name: string;
  discountType: CouponDiscountType;
  /** Satang for FIXED_AMOUNT or % (1-100) for PERCENTAGE */
  discountValue: number;
  minSpendAmountMinor: number;
  maxDiscountAmountMinor: number | null;
  quota: number;
  claimedCount: number;
  usedCount: number;
  remainingQuota: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  isClaimed?: boolean;
  isUsed?: boolean;
}

export interface UserCouponClaimDto {
  id: string;
  couponId: string;
  coupon: CouponDto;
  claimedAt: string;
  isUsed: boolean;
  usedAt: string | null;
  orderId: string | null;
}

export interface CreateCouponInput {
  code: string;
  name: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minSpendAmountMinor?: number;
  maxDiscountAmountMinor?: number;
  quota: number;
  startDate: string;
  endDate: string;
}

export interface UpdateCouponInput {
  name?: string;
  quota?: number;
  endDate?: string;
  isActive?: boolean;
}

export interface ValidateCouponResponse {
  valid: boolean;
  coupon?: CouponDto;
  discountAmountMinor: number;
  reason?: string;
}

export const couponApi = {
  // Seller endpoints
  getShopCoupons: () => api.get<CouponDto[]>("/shops/me/coupons"),
  createCoupon: (data: CreateCouponInput) => api.post<CouponDto>("/shops/me/coupons", data),
  updateCoupon: (couponId: string, data: UpdateCouponInput) => api.patch<CouponDto>(`/shops/me/coupons/${couponId}`, data),
  deleteCoupon: (couponId: string) => api.delete<{ deleted: boolean; message: string }>(`/shops/me/coupons/${couponId}`),

  // Public / Buyer storefront
  getPublicShopCoupons: (shopId: string) => api.get<CouponDto[]>(`/shops/${shopId}/coupons`),
  getFeaturedCoupons: (limit?: number) => {
    const query = limit ? `?limit=${limit}` : "";
    return api.get<CouponDto[]>(`/coupons/featured${query}`);
  },

  // Buyer claims & actions
  claimCoupon: (couponId: string) => api.post<UserCouponClaimDto>(`/coupons/${couponId}/claim`),
  getMyClaims: (shopId?: string) => {
    const query = shopId ? `?shopId=${encodeURIComponent(shopId)}` : "";
    return api.get<UserCouponClaimDto[]>(`/coupons/my-claims${query}`);
  },
  validateCoupon: (shopId: string, couponCodeOrId: string, subtotalMinor: number) =>
    api.post<ValidateCouponResponse>("/coupons/validate", { shopId, couponCodeOrId, subtotalMinor }),
};
