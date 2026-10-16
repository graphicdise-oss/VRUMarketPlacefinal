import { api } from "./core";
import { CommunityAnalyticsDto } from "./shop";

export interface CommunityDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export const communityApi = {
  list: (params?: { limit?: number; cursor?: string }) => {
    const query = new URLSearchParams();
    if (params?.cursor) query.append("cursor", params.cursor);
    query.append("limit", (params?.limit || 50).toString());
    return api.get<{ items: CommunityDto[]; nextCursor?: string }>(`/communities?${query.toString()}`);
  },
  getById: (id: string) => api.get<CommunityDto>(`/communities/${id}`),
  create: (name: string, description: string | null) => api.post<CommunityDto>(`/communities`, { name, description }),
  update: (id: string, name: string, description: string | null) => api.patch<CommunityDto>(`/communities/${id}`, { name, description }),
  delete: (id: string) => api.delete<void>(`/communities/${id}`),
};

export interface CommunityAdminEntryDto {
  userId: string;
  email: string;
  assignedAt: string;
  assignedBy: string;
  bannedAt: string | null;
}

export const communityAdminApi = {
  list: (communityId: string, cursor?: string) => 
    api.get<{ items: CommunityAdminEntryDto[]; nextCursor?: string }>(`/communities/${communityId}/admins?limit=50${cursor ? `&cursor=${cursor}` : ''}`),
  assign: (communityId: string, userId: string) => 
    api.post<CommunityAdminEntryDto>(`/communities/${communityId}/admins`, { userId }),
  revoke: (communityId: string, userId: string) => 
    api.delete<void>(`/communities/${communityId}/admins/${userId}`),
  getDashboard: (communityId: string, timeFilter?: string) =>
    api.get<CommunityAnalyticsDto>(`/communities/${communityId}/analytics/dashboard${timeFilter ? `?timeFilter=${timeFilter}` : ''}`),
};

export interface CommunityRequestDto {
  id: string;
  name: string;
  description: string;
  location: string | null;
  requesterId: string;
  status: string;
  reason: string | null;
  createdAt: string;
}

export const communityRequestApi = {
  create: (name: string, description: string, location?: string) => 
    api.post<CommunityRequestDto>('/community-requests', { name, description, location }),
  listPending: (cursor?: string) => 
    api.get<{ items: CommunityRequestDto[]; nextCursor?: string; hasMore: boolean }>(
      `/community-requests/pending?limit=50${cursor ? `&cursor=${cursor}` : ''}`
    ),
  approve: (id: string) => 
    api.post<CommunityRequestDto>(`/community-requests/${id}/approve`, {}),
  reject: (id: string, reason?: string) => 
    api.post<CommunityRequestDto>(`/community-requests/${id}/reject`, { reason }),
};
