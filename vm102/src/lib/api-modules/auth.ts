import { api, setMemoryCsrfToken } from "./core";

export const authApi = {
  /** ขอ CSRF Token ใหม่ (ทำตอนเข้าแอป, หลังล็อกอิน, และหลังล็อกเอาท์) */
  fetchCsrf: async () => {
    const data = await api.get<{ csrfToken: string }>("/auth/csrf");
    setMemoryCsrfToken(data.csrfToken);
    return data.csrfToken;
  },
  me: () => api.get<{ id: string; email: string; role: string; emailVerified: boolean }>("/auth/me", { cache: "no-store" }),
  login: (credentials: { email: string; password: string }) => api.post<{ id: string; email: string; role: string; emailVerified: boolean }>("/auth/login", credentials),
  register: (data: { email: string; password: string; acceptedPrivacyPolicyVersion: string; acceptedTermsOfServiceVersion: string; confirmedAgeOrGuardianConsent: true }) => api.post("/auth/register", data),
  logout: () => api.post("/auth/logout"),
};
