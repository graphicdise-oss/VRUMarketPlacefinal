"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User } from "@/types";
import { authApi, shopApi } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // เช็คสถานะล็อกอินผ่าน /me endpoint
  const refreshUser = useCallback(async () => {
    try {
      // ดึง CSRF Token ทุกครั้งที่เปิดแอป ตามกฎ FRONTEND-NOTES.md
      await authApi.fetchCsrf();
      
      const userData = (await authApi.me()) as unknown as User;
      if (!userData.displayName && userData.email) {
        userData.displayName = userData.email.split("@")[0];
      }
      
      try {
        const myShop = await shopApi.getMine();
        if (myShop && myShop.id) {
          userData.shopId = myShop.id;
        }
      } catch (e) {
        // User has no shop, which is fine
      }
      
      setUser(userData);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
     
    refreshUser().finally(() => {
      if (isMounted) setIsLoading(false);
    });
    return () => { isMounted = false; };
  }, [refreshUser]);

  const login = useCallback(async (identifier: string, password: string) => {
    // ยิง API Login ของจริงไปที่ Backend
    const userData = (await authApi.login({ email: identifier, password })) as unknown as User;
    
    // หลังล็อกอินสำเร็จ CSRF Token เดิมจะใช้ไม่ได้แล้ว (ผูกกับ Session เก่า)
    // ต้องดึง Token ใหม่ทันที
    await authApi.fetchCsrf();
    
    if (!userData.displayName && userData.email) {
      userData.displayName = userData.email.split("@")[0];
    }
    
    try {
      const myShop = await shopApi.getMine();
      if (myShop && myShop.id) {
        userData.shopId = myShop.id;
      }
    } catch (e) {
      // User has no shop
    }
    
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
      // หลังล็อกเอาท์ต้องดึง CSRF ใหม่เช่นกัน
      await authApi.fetchCsrf();
    } catch (e) {
      console.log("Logout API failed", e);
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
