import { api } from "./core";
import type { DisputeDto } from "./dispute";
import type { Review } from "./review";
import type { PaymentChannelDto } from "./shop";

/** Mirrors backend `OrderDto['displayStatus']` — what the UI should actually render. */
export type DisplayOrderStatus =
  | "AWAITING_SHIPPING_QUOTE"
  | "AWAITING_PAYMENT"
  | "PAYMENT_SUBMITTED"
  | "PAID"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUND_ORDERED"
  | "REFUNDED"
  | "FROZEN"
  | "DISPUTED";

/**
 * Mirrors backend `OrderItemDto`. NOTE: the backend does not (yet) return `productId` or a
 * shop name / image snapshot — `productId` is therefore optional here.
 */
export interface OrderItemDto {
  id: string;
  variantId: string;
  productId?: string;
  productNameAtPurchase: string;
  variantNameAtPurchase: string;
  /** Satang, snapshotted at checkout. */
  priceAtPurchase: number;
  currency: string;
  quantity: number;
}

export interface TrackingNumberChangeDto {
  id: string;
  previousTrackingNumber: string;
  newTrackingNumber: string;
  changedAt: string;
}

/** Mirrors backend `OrderDto`. Dates are ISO strings over the wire. */
export interface OrderDto {
  id: string;
  buyerId: string;
  shopId: string;
  /** Not returned by the backend today; kept optional so callers can fall back. */
  shopName?: string;
  status: Exclude<DisplayOrderStatus, "FROZEN" | "DISPUTED">;
  displayStatus: DisplayOrderStatus;
  totalAmountMinor: number | null;
  shippingAmountMinor: number | null;
  discountAmountMinor?: number;
  couponId?: string | null;
  couponCode?: string | null;
  currency: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  subdistrictName: string;
  districtName: string;
  provinceName: string;
  postalCode: string;
  cancelledBy: "BUYER" | "SHOP" | "ADMIN" | null;
  cancelReason: string | null;
  expiresAt: string | null;
  sellerConfirmedAt: string | null;
  slipRejectionCount: number;
  slipRejectionsRemaining: number;
  items: OrderItemDto[];
  shippedAt: string | null;
  shippingCarrierId: string | null;
  shippingCarrierName: string | null;
  carrierNameOther: string | null;
  trackingNumber: string | null;
  trackingNumberHistory: TrackingNumberChangeDto[];
  completedAt: string | null;
  review: Review | null;
  disputeDeadline: string | null;
  refundOrderedAt: string | null;
  refundAccountType: "BANK_TRANSFER" | "PROMPTPAY" | null;
  refundBankName: string | null;
  refundBankAccountNumber: string | null;
  refundBankAccountName: string | null;
  refundPromptPayId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors backend `PaymentSlipDto`. */
export interface PaymentSlipDto {
  id: string;
  orderId: string;
  rejectedAt: string | null;
  rejectionReason: string | null;
  supersededAt: string | null;
  createdAt: string;
}

/** Mirrors backend `ShippingSlipDto`. */
export interface ShippingSlipDto {
  id: string;
  orderId: string;
  createdAt: string;
}

/** Mirrors backend `ShippingCarrierDto`. */
export interface ShippingCarrierDto {
  id: string;
  name: string;
  isOther: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
}

export const sellerOrderApi = {
  list: (status?: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (status && status !== "ALL") params.append("status", status);
    if (cursor) params.append("cursor", cursor);
    return api.get<Paginated<OrderDto>>(`/shops/me/orders?${params.toString()}`);
  },
  getById: (orderId: string) => api.get<OrderDto>(`/orders/${orderId}`), // uses the shared public route
  setShippingFee: (orderId: string, shippingAmountMinor: number) => api.post<OrderDto>(`/shops/me/orders/${orderId}/shipping-fee`, { shippingAmountMinor }),
  confirmPayment: (orderId: string) => api.post<OrderDto>(`/shops/me/orders/${orderId}/confirm-payment`),
  shipOrder: (orderId: string, shippingCarrierId: string, trackingNumber: string, carrierNameOther?: string) => 
    api.post<OrderDto>(`/shops/me/orders/${orderId}/ship`, { shippingCarrierId, trackingNumber, carrierNameOther }),
  uploadShippingSlip: (orderId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<ShippingSlipDto>(`/shops/me/orders/${orderId}/shipping-slips`, formData);
  },
  getShippingSlips: (orderId: string) => api.get<ShippingSlipDto[]>(`/orders/${orderId}/shipping-slips`),
  rejectSlip: (orderId: string, slipId: string, reason: string) =>
    api.post<PaymentSlipDto>(`/shops/me/orders/${orderId}/payment-slips/${slipId}/reject`, { reason }),
  getDisputes: (orderId: string) => api.get<DisputeDto[]>(`/shops/me/orders/${orderId}/dispute`),
  respondDispute: (orderId: string, response: string, files: File[]) => {
    const formData = new FormData();
    formData.append("response", response);
    files.forEach(f => formData.append("files", f));
    return api.post<DisputeDto>(`/shops/me/orders/${orderId}/dispute/respond`, formData);
  },
};

export const buyerOrderApi = {
  checkout: (
    addressId: string,
    items: { cartItemId: string; quantity: number; priceAmountMinor: number }[],
    options?: { couponId?: string; coupons?: { shopId: string; couponId: string }[] },
  ) => api.post<OrderDto>("/orders", { addressId, items, ...options }),
  list: (status?: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (status && status !== "ALL") params.append("status", status);
    if (cursor) params.append("cursor", cursor);
    return api.get<Paginated<OrderDto>>(`/orders?${params.toString()}`);
  },
  getById: (orderId: string) => api.get<OrderDto>(`/orders/${orderId}`),
  openDispute: (orderId: string, reason: string, files: File[]) => {
    const formData = new FormData();
    formData.append("reason", reason);
    files.forEach(f => formData.append("files", f));
    return api.post<unknown>(`/orders/${orderId}/dispute`, formData);
  },
  uploadSlip: (orderId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<PaymentSlipDto>(`/orders/${orderId}/payment-slips`, formData);
  },
  getSlips: (orderId: string) => api.get<PaymentSlipDto[]>(`/orders/${orderId}/payment-slips`),
  getShippingSlips: (orderId: string) => api.get<ShippingSlipDto[]>(`/orders/${orderId}/shipping-slips`),
  markReceived: (orderId: string) => api.post<OrderDto>(`/orders/${orderId}/receive`),
  rejectShippingFee: (orderId: string, reason: string) => api.post<OrderDto>(`/orders/${orderId}/reject-shipping-fee`, { reason }),
  getPaymentChannels: (orderId: string) => api.get<PaymentChannelDto[]>(`/orders/${orderId}/payment-channels`),
};

export const shippingCarrierApi = {
  list: (params?: { includeInactive?: boolean; limit?: number; cursor?: string }) => {
    const query = new URLSearchParams();
    if (params?.includeInactive) query.append("includeInactive", "true");
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.cursor) query.append("cursor", params.cursor);
    return api.get<Paginated<ShippingCarrierDto>>(`/shipping-carriers?${query.toString()}`);
  },
  create: (name: string) => api.post<ShippingCarrierDto>("/shipping-carriers", { name }),
  update: (id: string, data: { name: string; isActive: boolean }) => api.patch<ShippingCarrierDto>(`/shipping-carriers/${id}`, data),
};
