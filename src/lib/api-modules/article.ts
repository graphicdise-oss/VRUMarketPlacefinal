import { apiFetch, ApiRequestError } from './core';
import { ApiError } from '@/types';

export interface Article {
  id: string;
  title: string;
  category: string;
  image: string | null;
  authorName: string;
  excerpt: string | null;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface ListArticlesQuery {
  category?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ArticlePage {
  items: Article[];
  nextCursor?: string;
}

export type CreateArticleDto = Omit<Article, 'id' | 'createdAt'>;
export type UpdateArticleDto = Partial<CreateArticleDto>;

export const articleApi = {
  list: async (query?: ListArticlesQuery): Promise<ArticlePage> => {
    const params = new URLSearchParams();
    if (query?.category && query.category !== 'ทั้งหมด') params.append('category', query.category);
    if (query?.search) params.append('search', query.search);
    if (query?.limit) params.append('limit', query.limit.toString());
    if (query?.cursor) params.append('cursor', query.cursor);

    return apiFetch<ArticlePage>(`/articles?${params.toString()}`);
  },

  getById: async (id: string): Promise<Article> => {
    return apiFetch<Article>(`/articles/${id}`);
  },

  create: async (data: CreateArticleDto): Promise<Article> => {
    return apiFetch<Article>('/articles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: UpdateArticleDto): Promise<Article> => {
    return apiFetch<Article>(`/articles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string): Promise<void> => {
    return apiFetch<void>(`/articles/${id}`, {
      method: 'DELETE',
    });
  },
};
