import { api } from "./core";

export const legalApi = {
  getPrivacyPolicy: () => api.get<{ version: string }>("/legal/privacy-policy"),
  getTermsOfService: () => api.get<{ version: string }>("/legal/terms-of-service"),
};

export const areaApi = {
  getProvinces: () => api.get<{ items: { id: string; nameTh: string }[]; nextCursor?: string }>("/provinces?limit=77"),
  getDistricts: (provinceId: string) => api.get<{ items: { id: string; nameTh: string; provinceId: string }[] }>(`/districts?provinceId=${provinceId}&limit=100`),
  getSubdistricts: (districtId: string) => api.get<{ items: { id: string; nameTh: string; districtId: string; postalCodes: { id: string; postalCode: string }[] }[] }>(`/subdistricts?districtId=${districtId}&limit=100`),
};

export interface AddressDto {
  id: string;
  recipientName: string;
  phone: string;
  houseNumber: string;
  villageNumber: string | null;
  alley: string | null;
  road: string | null;
  subdistrictPostalCodeId: string;
  postalCode: string;
  subdistrictId: string;
  subdistrictNameTh: string;
  districtId: string;
  districtNameTh: string;
  provinceId: string;
  provinceNameTh: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const addressApi = {
  list: () => api.get<{ items: AddressDto[]; nextCursor?: string }>("/addresses?limit=50"),
  create: (data: Omit<AddressDto, 'id' | 'postalCode' | 'subdistrictId' | 'subdistrictNameTh' | 'districtId' | 'districtNameTh' | 'provinceId' | 'provinceNameTh' | 'isDefault' | 'createdAt' | 'updatedAt'>) => api.post<AddressDto>("/addresses", data),
  update: (id: string, data: Omit<AddressDto, 'id' | 'postalCode' | 'subdistrictId' | 'subdistrictNameTh' | 'districtId' | 'districtNameTh' | 'provinceId' | 'provinceNameTh' | 'isDefault' | 'createdAt' | 'updatedAt'>) => api.patch<AddressDto>(`/addresses/${id}`, data),
  delete: (id: string) => api.delete<void>(`/addresses/${id}`),
  setDefault: (id: string) => api.post<AddressDto>(`/addresses/${id}/default`),
};

/** Mirrors backend `NotificationDto`. */
export interface NotificationDto {
  id: string;
  type: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  readAt: string | null;
}

export const notificationApi = {
  list: (cursor?: string) => api.get<{ items: NotificationDto[]; nextCursor?: string }>(`/notifications?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.post<void>(`/notifications/${id}/read`),
  markAllRead: () => api.post<void>(`/notifications/read-all`),
};

/** Mirrors backend `CartItemDto`. */
export interface CartItemDto {
  id: string;
  variantId: string;
  quantity: number;
  productId: string;
  productName: string;
  variantName: string;
  shopId: string;
  priceAmountMinor: number;
  priceAmountMinorWhenAdded: number;
  currency: string;
  stock: number;
  orderable: boolean;
  unavailableReason: string | null;
}

/** Mirrors backend `CartDto`. */
export interface CartDto {
  items: CartItemDto[];
  orderCount: number;
}

export const cartApi = {
  get: () => api.get<CartDto>("/cart"),
  addItem: (productId: string, variantId: string, quantity: number) => api.post<CartDto>("/cart/items", { variantId, quantity }),
  updateQuantity: (cartItemId: string, quantity: number) => api.patch<CartItemDto>(`/cart/items/${cartItemId}`, { quantity }),
  removeItem: (cartItemId: string) => api.delete<void>(`/cart/items/${cartItemId}`),
  clear: () => api.delete<void>("/cart"),
};
