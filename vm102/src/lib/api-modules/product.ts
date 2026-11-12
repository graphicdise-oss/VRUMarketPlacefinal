import { api } from "./core";

export interface CategoryDto {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  isActive: boolean;
  createdAt: string;
}

export const categoryApi = {
  list: (cursor?: string) => api.get<{ items: CategoryDto[]; nextCursor?: string; hasMore: boolean }>(`/categories?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  create: (name: string, icon?: string, color?: string) => api.post<CategoryDto>('/categories', { name, icon, color }),
  update: (id: string, data: { name?: string; isActive?: boolean; icon?: string; color?: string }) => api.patch<CategoryDto>(`/categories/${id}`, data),
};

export interface ProductVariantDto {
  id: string;
  name: string;
  priceAmountMinor: number;
  stock: number;
  soldCount?: number;
}

export interface ProductDto {
  id: string;
  shopId: string;
  categoryId: string;
  name: string;
  description: string;
  moderationStatus: "PENDING" | "APPROVED" | "REJECTED";
  shopPublishStatus: "PUBLISHED" | "UNPUBLISHED";
  deletedAt: string | null;
  shopClosedAt: string | null;
  shopSuspendedAt: string | null;
  rejectionCategory: string | null;
  rejectionReason: string | null;
  imageCount: number;
  createdAt: string;
  variants: ProductVariantDto[];
  images?: { id: string; createdAt: string }[];
  reviewRevision: number;
}

export interface PublicProductDto extends Omit<ProductDto, "moderationStatus" | "shopPublishStatus" | "deletedAt" | "rejectionCategory" | "rejectionReason" | "reviewRevision"> {
  shopName: string;
  categoryNameTh: string;
  communityId: string;
  /** Units sold (orders at PAID/SHIPPED/COMPLETED) across every option. */
  soldCount: number;
}

export const productApi = {
  // --- SELLER ROUTES ---
  create: (data: {
    name: string;
    description: string;
    categoryId: string;
    variants: { name: string; priceAmountMinor: number; stock: number; }[];
  }) => api.post<ProductDto>("/products", data),
  addImage: (productId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<ProductDto>(`/products/${productId}/images`, formData);
  },
  listMine: (cursor?: string) => api.get<{ items: ProductDto[]; nextCursor?: string }>(`/products/mine?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  update: (productId: string, data: {
    name?: string;
    description?: string;
    categoryId?: string;
    variants?: { name: string; priceAmountMinor: number; stock: number; }[];
  }) => api.patch<ProductDto>(`/products/${productId}`, data),
  
  // --- PUBLIC ROUTES ---
  listPublic: (params?: { shopId?: string; communityId?: string; categoryId?: string; sort?: string; cursor?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.shopId) query.append("shopId", params.shopId);
    if (params?.communityId) query.append("communityId", params.communityId);
    if (params?.categoryId) query.append("categoryId", params.categoryId);
    if (params?.sort) query.append("sort", params.sort);
    if (params?.cursor) query.append("cursor", params.cursor);
    query.append("limit", (params?.limit || 20).toString());
    return api.get<{ items: PublicProductDto[]; nextCursor?: string }>(`/products?${query.toString()}`);
  },
  searchPublic: (params: { q: string; communityId?: string; categoryId?: string; cursor?: string; limit?: number }) => {
    const query = new URLSearchParams({ q: params.q });
    if (params.communityId) query.append("communityId", params.communityId);
    if (params.categoryId) query.append("categoryId", params.categoryId);
    if (params.cursor) query.append("cursor", params.cursor);
    query.append("limit", (params.limit || 20).toString());
    return api.get<{ items: PublicProductDto[]; nextCursor?: string }>(`/products/search?${query.toString()}`);
  },
  getPublicById: (productId: string) => api.get<PublicProductDto>(`/products/${productId}`),
  getTrendingKeywords: async (): Promise<string[]> => {
    try {
      const res = await api.get<{ keywords: string[] }>("/products/search/trending");
      return res?.keywords || [];
    } catch {
      return [];
    }
  },
};
