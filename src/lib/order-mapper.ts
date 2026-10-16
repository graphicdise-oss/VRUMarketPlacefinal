import type { Order, OrderItem, OrderStatus } from "@/types";
import type { OrderDto, OrderItemDto } from "@/lib/api-modules/order";
import { getProductFallbackImage } from "@/lib/product-mapper";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

export function mapOrderItemDto(i: OrderItemDto): OrderItem {
  const fallback = getProductFallbackImage(i.productNameAtPurchase);
  return {
    id: i.id,
    productId: i.productId ?? "",
    variantId: i.variantId,
    productNameAtPurchase: i.productNameAtPurchase,
    variantNameAtPurchase: i.variantNameAtPurchase,
    priceAtPurchaseMinor: i.priceAtPurchase,
    qty: i.quantity,
    imageAtPurchase: i.productId ? `${API_URL}/products/${i.productId}/images/first` : fallback,
  };
}

/** Maps the backend `OrderDto` into the UI's `Order` view-model (both buyer and seller sides). */
export function mapOrderDto(o: OrderDto): Order {
  return {
    id: o.id,
    buyerId: o.buyerId,
    shopId: o.shopId,
    shopName: o.shopName || "ร้านค้าชุมชน",
    status: o.displayStatus as OrderStatus,
    items: (o.items || []).map(mapOrderItemDto),
    shippingAddress: {
      recipientName: o.recipientName || "-",
      phone: o.phone || "-",
      addressLine: o.houseNumber || "-",
      subDistrict: o.subdistrictName || "-",
      district: o.districtName || "-",
      province: o.provinceName || "-",
      postalCode: o.postalCode || "-",
    },
    shippingCostMinor: o.shippingAmountMinor ?? undefined,
    totalAmountMinor: o.totalAmountMinor ?? undefined,
    discountAmountMinor: o.discountAmountMinor ?? 0,
    couponId: o.couponId ?? undefined,
    couponCode: o.couponCode ?? undefined,
    createdAt: o.createdAt,
    shippingQuoteDeadline: o.status === "AWAITING_SHIPPING_QUOTE" ? o.expiresAt ?? undefined : undefined,
    paymentDeadline: o.status === "AWAITING_PAYMENT" ? o.expiresAt ?? undefined : undefined,
    confirmationDeadline: o.status === "PAYMENT_SUBMITTED" ? o.expiresAt ?? undefined : undefined,
    shippedAt: o.shippedAt ?? undefined,
    completedAt: o.completedAt ?? undefined,
    sellerConfirmedAt: o.sellerConfirmedAt ?? undefined,
    shippingProvider: o.shippingCarrierName ?? undefined,
    trackingNumber: o.trackingNumber ?? undefined,
    rejectionReason: o.cancelReason ?? undefined,
  };
}
