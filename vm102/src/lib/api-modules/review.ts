import { api, apiFetch } from './core';

export interface ReviewImage {
  id: string;
}

export interface Review {
  id: string;
  rating: number;
  text: string | null;
  images: ReviewImage[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewPage {
  items: Review[];
  nextCursor?: string;
}

export const reviewApi = {
  listForShop: async (shopId: string, params?: { cursor?: string; limit?: number }): Promise<ReviewPage> => {
    const query = new URLSearchParams();
    if (params?.cursor) query.append("cursor", params.cursor);
    if (params?.limit) query.append("limit", params.limit.toString());
    
    return apiFetch<ReviewPage>(`/shops/${shopId}/reviews?${query.toString()}`);
  },
  create: (orderId: string, dto: { rating: number; text?: string }) => api.post<Review>(`/orders/${orderId}/review`, dto),
  update: (orderId: string, dto: { rating: number; text?: string }) => api.patch<Review>(`/orders/${orderId}/review`, dto),
  addImage: (orderId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<Review>(`/orders/${orderId}/review/images`, formData);
  },
  removeImage: (orderId: string, imageId: string) => api.delete<Review>(`/orders/${orderId}/review/images/${imageId}`)
};
