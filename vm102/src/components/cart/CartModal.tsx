"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { formatPrice } from "@/lib/utils";
import { CartItem } from "@/types";

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartModal({ isOpen, onClose }: CartModalProps) {
  const { cart, removeFromCart, updateQuantity, getCartGroupedByShop } = useCart();
  const shopGroups = getCartGroupedByShop();

  // Selection state: Set of selected cartItem IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);

  // Initialize selection when cart items load
  useEffect(() => {
    if (cart.length > 0) {
      if (!initializedRef.current) {
        // By default, select all orderable items
        const initialSelected = new Set(
          cart.filter((item) => item.orderable !== false).map((item) => item.id)
        );
        setSelectedIds(initialSelected);
        initializedRef.current = true;
      } else {
        // Retain selections that still exist in cart
        setSelectedIds((prev) => {
          const currentIds = new Set(cart.map((i) => i.id));
          const next = new Set<string>();
          for (const id of prev) {
            if (currentIds.has(id)) next.add(id);
          }
          return next;
        });
      }
    } else {
      setSelectedIds(new Set());
      initializedRef.current = false;
    }
  }, [cart]);

  const orderableCart = useMemo(
    () => cart.filter((item) => item.orderable !== false),
    [cart]
  );

  const selectedItems = useMemo(
    () => orderableCart.filter((item) => selectedIds.has(item.id)),
    [orderableCart, selectedIds]
  );

  const selectedTotalPriceMinor = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.priceMinor * item.qty, 0),
    [selectedItems]
  );

  const selectedCount = selectedItems.length;
  const allSelected = orderableCart.length > 0 && selectedCount === orderableCart.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // Toggle single item selection
  const toggleItem = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Toggle all items in a specific shop
  const toggleShop = (shopItems: CartItem[]) => {
    const orderableItems = shopItems.filter((i) => i.orderable !== false);
    if (orderableItems.length === 0) return;
    const allShopSelected = orderableItems.every((i) => selectedIds.has(i.id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allShopSelected) {
        orderableItems.forEach((i) => next.delete(i.id));
      } else {
        orderableItems.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  // Toggle select all items across all shops
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orderableCart.map((i) => i.id)));
    }
  };

  const selectedShopCount = useMemo(() => {
    return new Set(selectedItems.map((i) => i.shopId)).size;
  }, [selectedItems]);

  const checkoutQuery = useMemo(() => {
    return Array.from(selectedIds).join(",");
  }, [selectedIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex justify-end opacity-100 transition-opacity duration-300" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full shadow-[auto_-10px_30px_rgba(0,0,0,0.1)] flex flex-col transform transition-transform duration-300 translate-x-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-gray-100 bg-white z-10">
          <h3 className="font-bold text-lg sm:text-xl text-gray-800 flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#D4F1BB]/50 rounded-full flex items-center justify-center text-[#16A085] text-base sm:text-lg">
              <i className="fa-solid fa-cart-shopping"></i>
            </div>
            ตะกร้าสินค้า
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-gray-50 hover:bg-red-50 cursor-pointer active:scale-95" aria-label="ปิด">
            <i className="fa-solid fa-xmark text-base sm:text-lg"></i>
          </button>
        </div>

        {/* Items */}
        <div className="flex-grow overflow-y-auto p-3.5 sm:p-5 flex flex-col gap-4 sm:gap-5 bg-gray-50/50">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300 text-3xl sm:text-4xl">
                <i className="fa-solid fa-cart-arrow-down"></i>
              </div>
              <p className="font-medium text-sm sm:text-base">ยังไม่มีสินค้าในตะกร้า</p>
              <button onClick={onClose} className="mt-3 text-[#16A085] font-bold text-sm hover:underline cursor-pointer">ไปเลือกซื้อสินค้ากันเลย</button>
            </div>
          ) : (
            Object.values(shopGroups).map((group) => {
              const orderableGroupItems = group.items.filter((i) => i.orderable !== false);
              const allShopSelected = orderableGroupItems.length > 0 && orderableGroupItems.every((i) => selectedIds.has(i.id));
              const someShopSelected = !allShopSelected && orderableGroupItems.some((i) => selectedIds.has(i.id));
              const shopSelectedSubtotal = group.items
                .filter((i) => selectedIds.has(i.id))
                .reduce((sum, i) => sum + i.priceMinor * i.qty, 0);

              return (
                <div key={group.shopId} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  {/* Shop Header */}
                  <div className="flex items-center gap-2.5 px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-gray-50 bg-gray-50/40">
                    <button
                      type="button"
                      onClick={() => toggleShop(group.items)}
                      disabled={orderableGroupItems.length === 0}
                      className={`w-5 h-5 rounded flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                        orderableGroupItems.length === 0
                          ? "border-gray-200 bg-gray-100 cursor-not-allowed"
                          : allShopSelected
                            ? "bg-[#16A085] text-white border border-[#16A085] shadow-xs"
                            : someShopSelected
                              ? "bg-[#16A085]/15 text-[#16A085] border border-[#16A085]"
                              : "border-2 border-gray-300 hover:border-[#16A085] bg-white"
                      }`}
                      aria-label={allShopSelected ? "ยกเลิกเลือกร้านค้านี้" : "เลือกร้านค้านี้"}
                    >
                      {allShopSelected ? (
                        <i className="fa-solid fa-check text-[10px]"></i>
                      ) : someShopSelected ? (
                        <i className="fa-solid fa-minus text-[10px]"></i>
                      ) : null}
                    </button>

                    <div className="w-6 h-6 bg-white border border-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <i className="fa-solid fa-store text-gray-500 text-[10px]"></i>
                    </div>
                    <span className="text-xs sm:text-sm font-bold text-gray-800 truncate">{group.shopName}</span>
                    <span className="ml-auto text-[10px] sm:text-[11px] font-bold text-[#16A085] bg-[#D4F1BB]/30 px-2 py-0.5 rounded-full flex-shrink-0">
                      {group.items.length} รายการ
                    </span>
                  </div>

                  {/* Items in shop */}
                  <div className="flex flex-col divide-y divide-gray-50 p-1.5 sm:p-2">
                    {group.items.map((item) => {
                      const isSelected = selectedIds.has(item.id);
                      const isItemOrderable = item.orderable !== false;

                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 relative group rounded-xl transition ${
                            isSelected ? "bg-[#16A085]/[0.02]" : ""
                          }`}
                        >
                          {/* Item Checkbox */}
                          <button
                            type="button"
                            onClick={() => isItemOrderable && toggleItem(item.id)}
                            disabled={!isItemOrderable}
                            className={`w-5 h-5 rounded flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                              !isItemOrderable
                                ? "border-gray-200 bg-gray-100 cursor-not-allowed opacity-50"
                                : isSelected
                                  ? "bg-[#16A085] text-white border border-[#16A085] shadow-xs"
                                  : "border-2 border-gray-300 hover:border-[#16A085] bg-white"
                            }`}
                            aria-label={isSelected ? "ยกเลิกเลือกสินค้านี้" : "เลือกสินค้านี้"}
                          >
                            {isSelected && <i className="fa-solid fa-check text-[10px]"></i>}
                          </button>

                          <img src={item.image} alt={item.name} className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl border border-gray-100 flex-shrink-0" />
                          <div className="flex flex-col flex-grow min-w-0 py-0.5">
                            <h4 className="text-xs sm:text-sm font-bold text-gray-800 line-clamp-2 leading-tight mb-1 pr-6">{item.name}</h4>
                            <span className="text-[10px] sm:text-[11px] text-gray-400 mb-auto">{item.variantName}</span>
                            <div className="flex items-end justify-between mt-1.5 sm:mt-2">
                              <span className="text-[#16A085] font-bold text-xs sm:text-sm">{formatPrice(item.priceMinor)}</span>
                              <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-0.5 shadow-inner">
                                <button onClick={() => updateQuantity(item.id, item.qty - 1)} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-white rounded-full text-gray-600 hover:text-[#16A085] transition shadow-xs active:scale-90 text-xs sm:text-sm font-bold cursor-pointer" aria-label="ลดจำนวน">-</button>
                                <span className="text-xs font-bold w-6 sm:w-7 text-center">{item.qty}</span>
                                <button onClick={() => updateQuantity(item.id, item.qty + 1)} className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-white rounded-full text-gray-600 hover:text-[#16A085] transition shadow-xs active:scale-90 text-xs sm:text-sm font-bold cursor-pointer" aria-label="เพิ่มจำนวน">+</button>
                              </div>
                            </div>
                          </div>
                          <button 
                            type="button"
                            onClick={() => removeFromCart(item.id)} 
                            className="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition w-7 h-7 flex items-center justify-center bg-white rounded-full shadow-2xs border border-gray-100 cursor-pointer active:scale-90"
                            title="ลบออกจากตะกร้า"
                            aria-label="ลบออกจากตะกร้า"
                          >
                            <i className="fa-solid fa-trash text-xs sm:text-[10px]"></i>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Shop Subtotal */}
                  <div className="flex justify-between items-center px-3.5 sm:px-4 py-2.5 sm:py-3 bg-gray-50/70 text-xs sm:text-sm border-t border-gray-50">
                    <span className="text-gray-500 font-medium">รวมร้านนี้</span>
                    <span className="text-[#16A085] font-bold text-sm sm:text-base">{formatPrice(shopSelectedSubtotal)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="p-4 sm:p-5 border-t border-gray-100 bg-white z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            {selectedShopCount > 1 && (
              <div className="flex items-center gap-2 p-2.5 bg-emerald-50 rounded-xl border border-emerald-100 mb-3">
                <i className="fa-solid fa-circle-info text-[#16A085] text-xs flex-shrink-0"></i>
                <span className="text-[11px] text-[#16A085] font-medium leading-relaxed">
                  สินค้าจาก {selectedShopCount} ร้านค้า จะถูกแยกคำสั่งซื้อให้อัตโนมัติ
                </span>
              </div>
            )}

            {/* Shopee-style "เลือกทั้งหมด" toolbar */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-2.5 cursor-pointer select-none text-left"
                aria-label={allSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
              >
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center transition-all flex-shrink-0 ${
                    allSelected
                      ? "bg-[#16A085] text-white border border-[#16A085] shadow-xs"
                      : someSelected
                        ? "bg-[#16A085]/15 text-[#16A085] border border-[#16A085]"
                        : "border-2 border-gray-300 hover:border-[#16A085] bg-white"
                  }`}
                >
                  {allSelected ? (
                    <i className="fa-solid fa-check text-[10px]"></i>
                  ) : someSelected ? (
                    <i className="fa-solid fa-minus text-[10px]"></i>
                  ) : null}
                </div>
                <span className="text-xs sm:text-sm font-bold text-gray-700">
                  เลือกทั้งหมด ({orderableCart.length})
                </span>
              </button>

              {selectedCount > 0 && (
                <span className="text-[11px] text-[#16A085] font-bold bg-[#D4F1BB]/30 px-2.5 py-0.5 rounded-full">
                  เลือก {selectedCount} ชิ้น
                </span>
              )}
            </div>

            {/* Price breakdown */}
            <div className="flex justify-between items-center mb-3.5 sm:mb-5">
              <div>
                <span className="text-gray-500 font-bold text-xs sm:text-sm block">ยอดรวมที่เลือก</span>
                <span className="text-[9px] sm:text-[10px] text-gray-400 font-medium">ยังไม่รวมค่าจัดส่ง (ร้านค้าจะแจ้งภายหลัง)</span>
              </div>
              <div className="text-right">
                <span className="text-[#16A085] font-black text-xl sm:text-2xl block leading-none">{formatPrice(selectedTotalPriceMinor)}</span>
              </div>
            </div>

            {/* Checkout action */}
            {selectedCount > 0 ? (
              <Link
                href={`/checkout?items=${checkoutQuery}`}
                onClick={onClose}
                className="btn-minimal block w-full text-center font-bold py-3.5 sm:py-4 rounded-full shadow-md transition-all text-xs sm:text-sm active:scale-98"
              >
                สั่งซื้อสินค้า ({selectedCount} ชิ้น)
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="block w-full text-center font-bold py-3.5 sm:py-4 rounded-full bg-gray-200 text-gray-400 text-xs sm:text-sm cursor-not-allowed shadow-none"
              >
                กรุณาเลือกสินค้าอย่างน้อย 1 รายการ
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
