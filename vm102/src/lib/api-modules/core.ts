import { ApiError } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

// เก็บ CSRF Token ใน Memory ตามกฎ FRONTEND-NOTES.md
let memoryCsrfToken: string | null = null;

export class ApiRequestError extends Error {
  statusCode: number;
  error: string;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = "ApiRequestError";
    this.statusCode = apiError.statusCode;
    this.error = apiError.error;
  }
}

export function setMemoryCsrfToken(token: string) {
  memoryCsrfToken = token;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (memoryCsrfToken) {
        headers["x-csrf-token"] = memoryCsrfToken;
      }
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      return res.status === 204;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (memoryCsrfToken && options.method && options.method !== "GET") {
    headers["x-csrf-token"] = memoryCsrfToken;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  // ท่ามาตรฐานตาม FRONTEND-NOTES.md: หากเจอ 401 ให้ refresh เงียบๆ 1 ครั้งแล้วยิงซ้ำ
  if (response.status === 401 && !isRetry && endpoint !== "/auth/login" && endpoint !== "/auth/refresh" && endpoint !== "/auth/csrf") {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      return apiFetch<T>(endpoint, options, true);
    }
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiRequestError(data as ApiError);
  }

  return data as T;
}

export async function apiFetchBlob(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<Blob> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (memoryCsrfToken && options.method && options.method !== "GET") {
    headers["x-csrf-token"] = memoryCsrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers, credentials: "include" });

  if (response.status === 401 && !isRetry) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      return apiFetchBlob(endpoint, options, true);
    }
  }

  if (!response.ok) {
    let data: ApiError;
    try {
      data = (await response.json()) as ApiError;
    } catch {
      data = { statusCode: response.status, error: "Error", message: "โหลดไฟล์ไม่สำเร็จ" } as ApiError;
    }
    throw new ApiRequestError(data);
  }

  return response.blob();
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) => apiFetch<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, body?: unknown, options?: RequestInit) => apiFetch<T>(endpoint, { ...options, method: "POST", body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) }),
  patch: <T>(endpoint: string, body?: unknown, options?: RequestInit) => apiFetch<T>(endpoint, { ...options, method: "PATCH", body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) }),
  put: <T>(endpoint: string, body?: unknown, options?: RequestInit) => apiFetch<T>(endpoint, { ...options, method: "PUT", body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) }),
  delete: <T>(endpoint: string, options?: RequestInit) => apiFetch<T>(endpoint, { ...options, method: "DELETE" }),
};
