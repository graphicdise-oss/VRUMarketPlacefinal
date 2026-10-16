"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { CartItem } from "@/types";
import { cartApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getProductFallbackImage } from "@/lib/product-mapper";

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "qty" | "id"> & { qty?: number }) => Promise<void>;
  removeFromCart: (id: string) => Promise<void>;
  updateQuantity: (id: string, qty: number) => Promise<void>;
  clearCart: () => Promise<void>;
  refreshCart: () => Promise<void>;
  totalItems: number;
  totalPriceMinor: number;
  getCartGroupedByShop: () => Record<string, { shopId: string; shopName: string; items: CartItem[]; subtotalMinor: number }>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const { user, isAuthenticated, isLoading } = useAuth();

  const fetchCart = useCallback(async () => {
    if (isLoading || !isAuthenticated || !user || user.role === 'SUPER_ADMIN') {
      setCart([]);
      return;
    }
    try {
      const res = await cartApi.get();
      // Map CartItemDto to CartItem
      const mapped: CartItem[] = res.items.map((dto) => ({
        id: dto.id,
        productId: dto.productId,
        variantId: dto.variantId,
        shopId: dto.shopId,
        shopName: `ร้านค้า ${dto.shopId.slice(0, 8)}`, // Backend doesn't provide shopName in cart
        name: dto.productName,
        variantName: dto.variantName,
        priceMinor: dto.priceAmountMinor,
        qty: dto.quantity,
        image: getProductFallbackImage(dto.productName),
        orderable: dto.orderable
      }));
      setCart(mapped);
    } catch {
      setCart([]);
    }
  }, [isLoading, isAuthenticated, user]);

  useEffect(() => {
    fetchCart();
  }, [fetchCart]);

  const addToCart = useCallback(async (item: Omit<CartItem, "qty" | "id"> & { qty?: number }) => {
    if (isLoading || !isAuthenticated || !user) return;
    try {
      await cartApi.addItem(item.productId, item.variantId, item.qty || 1);
      await fetchCart();
    } catch {
      // Ignored
    }
  }, [isLoading, isAuthenticated, user, fetchCart]);

  const removeFromCart = useCallback(async (id: string) => {
    if (isLoading || !isAuthenticated || !user) return;
    try {
      await cartApi.removeItem(id);
      await fetchCart();
    } catch {
      // Ignored
    }
  }, [isLoading, isAuthenticated, user, fetchCart]);

  const updateQuantity = useCallback(async (id: string, qty: number) => {
    if (isLoading || !isAuthenticated || !user) return;
    if (qty < 1) return;
    try {
      await cartApi.updateQuantity(id, qty);
      await fetchCart();
    } catch {
      // Ignored
    }
  }, [isLoading, isAuthenticated, user, fetchCart]);

  const clearCart = useCallback(async () => {
    if (isLoading || !isAuthenticated || !user) return;
    try {
      await cartApi.clear();
      await fetchCart();
    } catch {
      // Ignored
    }
  }, [isLoading, isAuthenticated, user, fetchCart]);

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalPriceMinor = cart.reduce((sum, item) => sum + item.priceMinor * item.qty, 0);

  const getCartGroupedByShop = useCallback(() => {
    const groups: Record<string, { shopId: string; shopName: string; items: CartItem[]; subtotalMinor: number }> = {};
    cart.forEach((item) => {
      // Only group orderable items, as per backend spec (items not orderable can't be checked out)
      if (item.orderable === false) return;
      if (!groups[item.shopId]) {
        groups[item.shopId] = { shopId: item.shopId, shopName: item.shopName, items: [], subtotalMinor: 0 };
      }
      groups[item.shopId].items.push(item);
      groups[item.shopId].subtotalMinor += item.priceMinor * item.qty;
    });
    return groups;
  }, [cart]);

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, clearCart, refreshCart: fetchCart, totalItems, totalPriceMinor, getCartGroupedByShop }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}