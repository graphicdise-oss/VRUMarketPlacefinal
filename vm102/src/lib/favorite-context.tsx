"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { favoriteApi } from "./api";
import { useAuth } from "./auth-context";

interface FavoriteContextType {
  favoriteIds: string[];
  toggleFavorite: (productId: string) => Promise<void>;
  isFavorite: (productId: string) => boolean;
}

const FavoriteContext = createContext<FavoriteContextType | undefined>(undefined);

export function FavoriteProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      favoriteApi.list().then(products => {
        setFavoriteIds(products.map(p => p.id));
      }).catch(() => {
        setFavoriteIds([]);
      });
    } else if (!isLoading && !isAuthenticated) {
      setFavoriteIds([]);
    }
  }, [isLoading, isAuthenticated, user]);

  const toggleFavorite = async (productId: string) => {
    if (!isAuthenticated) return;
    
    const currentlyFavorite = favoriteIds.includes(productId);
    
    // Optimistic update
    setFavoriteIds(prev => 
      currentlyFavorite 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );

    try {
      if (currentlyFavorite) {
        await favoriteApi.remove(productId);
      } else {
        await favoriteApi.add(productId);
      }
    } catch {
      // Revert on error
      setFavoriteIds(prev => 
        currentlyFavorite 
          ? [...prev, productId]
          : prev.filter(id => id !== productId)
      );
    }
  };

  const isFavorite = (productId: string) => favoriteIds.includes(productId);

  return (
    <FavoriteContext.Provider value={{ favoriteIds, toggleFavorite, isFavorite }}>
      {children}
    </FavoriteContext.Provider>
  );
}

export function useFavorite() {
  const context = useContext(FavoriteContext);
  if (context === undefined) {
    throw new Error("useFavorite must be used within a FavoriteProvider");
  }
  return context;
}
