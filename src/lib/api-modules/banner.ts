import { api } from "./core";

export interface BannerDto {
  id: string;
  title?: string;
  subtitle?: string;
  tag?: string;
  imageUrl: string;
  linkUrl?: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateBannerDto {
  title?: string;
  subtitle?: string;
  tag?: string;
  imageUrl: string;
  linkUrl?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateBannerDto extends Partial<CreateBannerDto> {}

export const bannerApi = {
  getPublicBanners: async (): Promise<{ items: BannerDto[] }> => {
    return api.get<{ items: BannerDto[] }>("/public/banners", { cache: "no-store" });
  },

  getAllBanners: async (): Promise<{ items: BannerDto[] }> => {
    return api.get<{ items: BannerDto[] }>("/admin/banners");
  },

  createBanner: async (data: CreateBannerDto): Promise<BannerDto> => {
    return api.post<BannerDto>("/admin/banners", data);
  },

  updateBanner: async (id: string, data: UpdateBannerDto): Promise<BannerDto> => {
    return api.patch<BannerDto>(`/admin/banners/${id}`, data);
  },

  deleteBanner: async (id: string): Promise<void> => {
    return api.delete(`/admin/banners/${id}`);
  },
};
