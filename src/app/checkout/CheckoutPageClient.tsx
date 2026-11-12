"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/components/cart/CartProvider";
import { formatPrice } from "@/lib/utils";
import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { Address, CartItem } from "@/types";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { buyerOrderApi, addressApi, couponApi, cartApi, CouponDto, UserCouponClaimDto, shopApi } from "@/lib/api";

export default function CheckoutPageClient() {
  const { cart, refreshCart } = useCart();
  const searchParams = useSearchParams();
  const itemsParam = searchParams.get("items");

  const selectedItemIds = useMemo(() => {
    if (!itemsParam) return null;
    const ids = itemsParam.split(",").map((s) => s.trim()).filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  }, [itemsParam]);

  const checkoutCart = useMemo(() => {
    if (!selectedItemIds) return cart;
    return cart.filter((item) => selectedItemIds.has(item.id));
  }, [cart, selectedItemIds]);

  const totalPriceMinor = useMemo(() => {
    return checkoutCart.reduce((sum, item) => sum + item.priceMinor * item.qty, 0);
  }, [checkoutCart]);

  const shopGroups = useMemo(() => {
    const groups: Record<string, { shopId: string; shopName: string; items: CartItem[]; subtotalMinor: number }> = {};
    for (const item of checkoutCart) {
      if (!groups[item.shopId]) {
        groups[item.shopId] = {
          shopId: item.shopId,
          shopName: item.shopName,
          items: [],
          subtotalMinor: 0,
        };
      }
      groups[item.shopId].items.push(item);
      groups[item.shopId].subtotalMinor += item.priceMinor * item.qty;
    }
    return groups;
  }, [checkoutCart]);

  const isPlacingOrderRef = useRef(false);
  const shopCount = Object.keys(shopGroups).length;
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const { user } = useAuth();
  const [shopNames, setShopNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const shopIds = Object.keys(shopGroups);
    shopIds.forEach(async (id) => {
      try {
        const s = await shopApi.getById(id);
        if (s?.name) {
          setShopNames((prev) => ({ ...prev, [id]: s.name }));
        }
      } catch {
        // Fallback
      }
    });
  }, [shopGroups]);

  // Coupon state
  const [selectedCoupons, setSelectedCoupons] = useState<Record<string, { coupon: CouponDto; discountMinor: number } | null>>({});

  // Voucher modal state
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [voucherModalShopId, setVoucherModalShopId] = useState<string | null>(null);
  const [voucherModalShopName, setVoucherModalShopName] = useState("");
  const [voucherModalSubtotalMinor, setVoucherModalSubtotalMinor] = useState(0);
  const [shopClaims, setShopClaims] = useState<UserCouponClaimDto[]>([]);
  const [isClaimsLoading, setIsClaimsLoading] = useState(false);
  const [inputCode, setInputCode] = useState("");
  const [inputCodeLoading, setInputCodeLoading] = useState(false);
  const [inputCodeError, setInputCodeError] = useState<string | null>(null);
  const [tempSelectedCoupon, setTempSelectedCoupon] = useState<{ coupon: CouponDto; discountMinor: number } | null>(null);

  useEffect(() => {
    if (user) {
      addressApi.list().then(res => {
        if (res.items && res.items.length > 0) {
          const defaultAddr = res.items.find(a => a.isDefault) || res.items[0];
          setAddresses(res.items);
          setSelectedAddress(defaultAddr.id);
        } else {
          setAddresses([]);
        }
      }).catch(console.error);
    }
  }, [user]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const openVoucherModal = async (shopId: string, shopName: string, subtotalMinor: number) => {
    setVoucherModalShopId(shopId);
    setVoucherModalShopName(shopName);
    setVoucherModalSubtotalMinor(subtotalMinor);
    setTempSelectedCoupon(selectedCoupons[shopId] || null);
    setInputCode("");
    setInputCodeError(null);
    setIsVoucherModalOpen(true);
    setIsClaimsLoading(true);

    try {
      const claims = await couponApi.getMyClaims(shopId);
      setShopClaims(claims);
    } catch (err) {
      console.error("Failed to load claims:", err);
      setShopClaims([]);
    } finally {
      setIsClaimsLoading(false);
    }
  };

  const closeVoucherModal = () => {
    setIsVoucherModalOpen(false);
    setVoucherModalShopId(null);
  };

  const handleApplyVoucherSelection = () => {
    if (voucherModalShopId) {
      setSelectedCoupons(prev => ({
        ...prev,
        [voucherModalShopId]: tempSelectedCoupon,
      }));
    }
    closeVoucherModal();
  };

  const handleRemoveCoupon = (shopId: string) => {
    setSelectedCoupons(prev => ({
      ...prev,
      [shopId]: null,
    }));
  };

  const handleValidateInputCode = async () => {
    if (!inputCode.trim() || !voucherModalShopId) return;
    setInputCodeLoading(true);
    setInputCodeError(null);
    try {
      const res = await couponApi.validateCoupon(voucherModalShopId, inputCode.trim(), voucherModalSubtotalMinor);
      if (res.valid && res.coupon) {
        setTempSelectedCoupon({
          coupon: res.coupon,
          discountMinor: res.discountAmountMinor,
        });
        // Refresh claims so the newly claimed voucher shows in the list
        const claims = await couponApi.getMyClaims(voucherModalShopId);
        setShopClaims(claims);
        setInputCode("");
      } else {
        setInputCodeError(res.reason || "โค้ดส่วนลดไม่ถูกต้องหรือไม่สามารถใช้ได้");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "ตรวจสอบโค้ดส่วนลดไม่สำเร็จ";
      setInputCodeError(message);
    } finally {
      setInputCodeLoading(false);
    }
  };

  const totalDiscountMinor = Object.values(selectedCoupons).reduce(
    (sum, item) => sum + (item?.discountMinor || 0),
    0
  );
  const netTotalPriceMinor = Math.max(0, totalPriceMinor - totalDiscountMinor);

  const handlePlaceOrder = async () => {
    if (isPlacingOrderRef.current) return;
    if (!selectedAddress) {
      alert("กรุณาเลือกที่อยู่จัดส่ง");
      return;
    }
    isPlacingOrderRef.current = true;
    setIsSubmitting(true);
    try {
      // 1. Fetch fresh cart directly from server to ensure 100% synchronized item IDs, quantities, and prices
      const freshCart = await cartApi.get();
      let freshOrderableItems = (freshCart.items || []).filter((i) => i.orderable);
      if (selectedItemIds) {
        freshOrderableItems = freshOrderableItems.filter((i) => selectedItemIds.has(i.id));
      }

      if (freshOrderableItems.length === 0) {
        await refreshCart();
        alert("ไม่มีสินค้าที่เลือกหรือสั่งได้ กรุณากลับไปตรวจสอบตะกร้า");
        isPlacingOrderRef.current = false;
        setIsSubmitting(false);
        return;
      }

      const itemsToCheckout = freshOrderableItems.map((i) => ({
        cartItemId: i.id,
        quantity: i.quantity,
        priceAmountMinor: i.priceAmountMinor,
      }));

      // Filter coupons for shops participating in this checkout
      const checkoutShopIds = new Set(freshOrderableItems.map((i) => i.shopId));
      const couponsPayload = Object.entries(selectedCoupons)
        .filter(([shopId, val]) => val !== null && checkoutShopIds.has(shopId))
        .map(([shopId, val]) => ({
          shopId,
          couponId: val!.coupon.id,
        }));

      await buyerOrderApi.checkout(
        selectedAddress,
        itemsToCheckout,
        couponsPayload.length > 0 ? { coupons: couponsPayload } : undefined
      );

      setSubmitted(true);
      await refreshCart();
      isPlacingOrderRef.current = false;
      setIsSubmitting(false);
    } catch (error) {
      console.error("Failed to place order:", error);
      await refreshCart();
      const message = error instanceof Error && error.message ? error.message : "การสั่งซื้อล้มเหลว กรุณาลองใหม่อีกครั้ง";
      alert(message);
      isPlacingOrderRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50/50">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-sm">
                <i className="fa-solid fa-leaf text-xl"></i>
              </div>
              <h1 className="text-xl font-black tracking-tight text-gray-800">VRU <span className="text-[#16A085]">Marketplace</span></h1>
            </Link>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-20 text-center">
          <div className="bg-white p-12 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-[#16A085]"></div>
            <div className="w-24 h-24 mx-auto mb-8 bg-[#D4F1BB]/50 rounded-full flex items-center justify-center border-4 border-white shadow-sm">
              <i className="fa-solid fa-check text-[#16A085] text-4xl"></i>
            </div>
            <h2 className="text-3xl font-black text-gray-800 mb-3">สั่งซื้อสำเร็จ!</h2>
            <p className="text-gray-500 mb-8 font-medium">ระบบได้สร้างคำสั่งซื้อจำนวน {shopCount} รายการเรียบร้อยแล้ว</p>
            <div className="bg-[#16A085]/5 border border-[#16A085]/20 rounded-2xl p-5 mb-10 flex items-start gap-4 text-left">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-[#16A085] flex-shrink-0 shadow-sm mt-1">
                <i className="fa-regular fa-clock text-lg"></i>
              </div>
              <div>
                <h4 className="font-bold text-[#16A085] mb-1">รอการประเมินค่าจัดส่ง</h4>
                <p className="text-sm text-gray-600 leading-relaxed">ร้านค้าจะทำการแจ้งค่าจัดส่งให้คุณทราบภายใน 24 ชั่วโมง กรุณาติดตามการอัปเดตได้ที่หน้า <b>&quot;รายการคำสั่งซื้อของฉัน&quot;</b></p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/orders" className="btn-minimal font-bold px-8 py-4 rounded-full transition shadow-md w-full sm:w-auto">
                <i className="fa-solid fa-box mr-2"></i> ดูรายการคำสั่งซื้อ
              </Link>
              <Link href="/" className="bg-white border-2 border-gray-100 text-gray-600 font-bold px-8 py-4 rounded-full hover:border-[#16A085] hover:text-[#16A085] transition shadow-sm hover:shadow w-full sm:w-auto">
                กลับหน้าหลัก
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (checkoutCart.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex flex-col">
        <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-sm">
                <i className="fa-solid fa-leaf text-xl"></i>
              </div>
              <h1 className="text-xl font-black tracking-tight text-gray-800">VRU <span className="text-[#16A085]">Marketplace</span></h1>
            </Link>
          </div>
        </header>
        <div className="flex-grow flex items-center justify-center p-4">
          <div className="text-center bg-white p-12 rounded-3xl shadow-sm border border-gray-100 max-w-md w-full">
            <div className="w-24 h-24 mx-auto mb-6 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 text-5xl">
              <i className="fa-solid fa-cart-arrow-down"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-700 mb-3">ไม่มีสินค้าที่เลือกสั่งซื้อ</h2>
            <p className="text-gray-500 mb-8">คุณยังไม่ได้เลือกสินค้าที่ต้องการชำระเงิน หรือไม่มีสินค้าในตะกร้า</p>
            <Link href="/" className="btn-minimal font-bold px-8 py-3.5 rounded-full inline-block shadow-md">
              เลือกซื้อสินค้าเลย
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentAddress = addresses.find((a) => a.id === selectedAddress) || addresses[0];

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="bg-white/90 backdrop-blur-md sticky top-0 z-50 shadow-xs border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-xs">
              <i className="fa-solid fa-leaf text-base"></i>
            </div>
            <h1 className="text-base sm:text-lg font-black tracking-tight text-gray-800">
              VRU <span className="text-[#16A085]">Marketplace</span>
            </h1>
          </Link>
          <Link
            href="/"
            className="text-xs font-bold text-gray-500 hover:text-[#16A085] bg-gray-50 hover:bg-[#D4F1BB]/30 px-3 py-1.5 rounded-full transition flex items-center gap-1.5"
          >
            <i className="fa-solid fa-house text-xs"></i>
            <span>กลับหน้าหลัก</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-7">
        <Breadcrumb items={[{ label: "ชำระเงิน" }]} />
        <div className="flex items-center justify-between mb-3.5 sm:mb-5">
          <h2 className="text-xl sm:text-2xl font-black text-gray-800 flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-emerald-50 text-[#16A085] rounded-xl flex items-center justify-center text-base sm:text-lg border border-emerald-100/60 shadow-2xs">
              <i className="fa-solid fa-file-invoice"></i>
            </div>
            ยืนยันคำสั่งซื้อ
          </h2>
          <span className="text-xs text-gray-400 font-medium hidden sm:inline">
            ตรวจสอบรายการก่อนยืนยัน
          </span>
        </div>

        {/* แจ้งเตือน: แยกออเดอร์ */}
        {shopCount > 1 && (
          <div className="bg-emerald-50/40 border border-[#16A085]/20 rounded-2xl p-3 sm:p-3.5 mb-4 sm:mb-5 flex items-start gap-2.5 text-xs sm:text-sm">
            <i className="fa-solid fa-circle-info text-[#16A085] text-sm mt-0.5 flex-shrink-0"></i>
            <p className="text-gray-700 leading-relaxed font-medium">
              สินค้าจาก <b className="text-gray-900">{shopCount} ร้าน</b> จะถูกแยกเป็น {shopCount} คำสั่งซื้อ เนื่องจากแต่ละร้านค้าชุมชนมีบัญชีรับเงินแยกกันครับ
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left: Orders Breakdown */}
          <div className="lg:col-span-2 flex flex-col gap-3.5 sm:gap-4">
            {/* ที่อยู่จัดส่ง */}
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-4 sm:p-5">
              <div className="flex justify-between items-center pb-2.5 mb-3 border-b border-gray-100">
                <h3 className="font-bold text-sm sm:text-base text-gray-800 flex items-center gap-2">
                  <i className="fa-solid fa-location-dot text-red-500 text-sm"></i>
                  <span>ที่อยู่สำหรับการจัดส่ง</span>
                </h3>
                <Link
                  href="/profile/addresses?from=checkout"
                  className="text-xs text-[#16A085] hover:text-[#117A65] font-bold flex items-center gap-1 hover:underline"
                >
                  <i className="fa-solid fa-pen text-[10px]"></i> จัดการที่อยู่
                </Link>
              </div>

              {addresses.length > 1 && (
                <div className="relative mb-2.5">
                  <select
                    value={selectedAddress}
                    onChange={(e) => setSelectedAddress(e.target.value)}
                    className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold py-2 pl-3 pr-8 rounded-xl focus:outline-none focus:border-[#16A085] cursor-pointer"
                  >
                    {addresses.map((addr) => (
                      <option key={addr.id} value={addr.id}>
                        {addr.recipientName} ({addr.phone}) - {addr.houseNumber} ต.{addr.subdistrictNameTh} {addr.isDefault ? "(ค่าเริ่มต้น)" : ""}
                      </option>
                    ))}
                  </select>
                  <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none"></i>
                </div>
              )}

              {/* Show selected address details */}
              {currentAddress ? (
                <div className="p-3 sm:p-3.5 bg-emerald-50/20 border border-emerald-100/80 rounded-xl text-xs sm:text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-gray-800 text-sm">{currentAddress.recipientName}</span>
                    <span className="text-gray-500 text-xs bg-white px-2 py-0.5 rounded-full border border-gray-200 font-medium">
                      {currentAddress.phone}
                    </span>
                    {currentAddress.isDefault && (
                      <span className="text-[10px] font-bold text-[#16A085] bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200/60">
                        ค่าเริ่มต้น
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 leading-relaxed text-xs sm:text-sm">
                    {currentAddress.houseNumber} ต.{currentAddress.subdistrictNameTh} อ.{currentAddress.districtNameTh} จ.{currentAddress.provinceNameTh} {currentAddress.postalCode}
                  </p>
                </div>
              ) : (
                <div className="py-4 px-3 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <p className="text-xs text-gray-500 mb-2">ยังไม่มีที่อยู่จัดส่ง</p>
                  <Link
                    href="/profile/addresses?from=checkout"
                    className="text-xs text-[#16A085] font-bold hover:underline"
                  >
                    + เพิ่มที่อยู่จัดส่งใหม่
                  </Link>
                </div>
              )}
            </div>

            {/* รายการสินค้าแยกตามร้าน */}
            {Object.values(shopGroups).map((group, idx) => {
              const currentCoupon = selectedCoupons[group.shopId];
              const shopDiscount = currentCoupon?.discountMinor || 0;
              const shopNetSubtotal = Math.max(0, group.subtotalMinor - shopDiscount);
              const resolvedShopName = shopNames[group.shopId] || group.shopName || "ร้านค้าชุมชน";

              return (
                <div key={group.shopId} className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50/80 border-b border-gray-100">
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 text-[#16A085] flex items-center justify-center text-xs shadow-2xs border border-emerald-100/60">
                      <i className="fa-solid fa-store"></i>
                    </div>
                    <span className="font-bold text-gray-800 text-sm sm:text-base">{resolvedShopName}</span>
                    {shopCount > 1 && (
                      <span className="ml-auto text-[11px] bg-gray-200/80 text-gray-600 px-2.5 py-0.5 rounded-full font-bold">
                        ร้านที่ {idx + 1}
                      </span>
                    )}
                  </div>
                  
                  <div className="divide-y divide-gray-50 p-1 sm:p-2">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex gap-3 p-2.5 sm:p-3">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-xl border border-gray-100 flex-shrink-0"
                        />
                        <div className="flex-grow min-w-0 flex flex-col justify-center">
                          <h4 className="text-xs sm:text-sm font-bold text-gray-800 line-clamp-1 mb-0.5">
                            {item.name}
                          </h4>
                          <p className="text-[11px] text-gray-400 font-medium mb-auto">{item.variantName}</p>
                          <div className="flex items-end justify-between mt-1">
                            <span className="text-[#16A085] font-black text-sm sm:text-base">
                              {formatPrice(item.priceMinor)}
                            </span>
                            <span className="text-[11px] font-bold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                              จำนวน: {item.qty}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Coupon Bar for Shop */}
                  <div className="px-4 py-2.5 bg-emerald-50/20 border-t border-gray-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-ticket text-[#16A085] text-xs"></i>
                      <span className="font-bold text-gray-700">โค้ดส่วนลดร้านค้า</span>
                      {currentCoupon && (
                        <span className="text-[10px] font-mono font-bold bg-[#16A085] text-white px-2 py-0.5 rounded-md">
                          {currentCoupon.coupon.code} (-{formatPrice(currentCoupon.discountMinor)})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {currentCoupon ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openVoucherModal(group.shopId, resolvedShopName, group.subtotalMinor)}
                            className="text-xs text-[#16A085] font-bold hover:underline cursor-pointer"
                          >
                            เปลี่ยน
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveCoupon(group.shopId)}
                            className="text-xs text-red-500 font-bold hover:underline cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openVoucherModal(group.shopId, resolvedShopName, group.subtotalMinor)}
                          className="text-xs font-bold text-[#16A085] hover:text-[#117A65] flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-teal-200 shadow-2xs cursor-pointer"
                        >
                          เลือกโค้ดส่วนลด <i className="fa-solid fa-chevron-right text-[9px]"></i>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Shop Subtotal: compact without redundant double lines */}
                  <div className="px-4 py-2.5 bg-gray-50/50 border-t border-gray-100 flex flex-col gap-1 text-xs sm:text-sm">
                    {shopDiscount > 0 ? (
                      <>
                        <div className="flex justify-between items-center text-gray-500 text-xs">
                          <span>รวมราคาสินค้า</span>
                          <span className="font-semibold text-gray-700">{formatPrice(group.subtotalMinor)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[#16A085] text-xs">
                          <span className="flex items-center gap-1">
                            <i className="fa-solid fa-tag text-[10px]"></i> ส่วนลดคูปอง
                          </span>
                          <span className="font-bold">-{formatPrice(shopDiscount)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                          <span className="font-bold text-gray-700">ยอดรวมร้านนี้</span>
                          <span className="font-black text-[#16A085] text-sm sm:text-base">
                            {formatPrice(shopNetSubtotal)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-gray-600 text-xs sm:text-sm">
                          ยอดรวมร้านนี้ ({group.items.reduce((sum, item) => sum + item.qty, 0)} ชิ้น)
                        </span>
                        <span className="font-black text-[#16A085] text-sm sm:text-base">
                          {formatPrice(shopNetSubtotal)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2 bg-gray-50/30 flex items-center gap-2 text-xs text-gray-500 border-t border-gray-100">
                    <i className="fa-solid fa-truck-fast text-[#16A085] text-xs"></i>
                    <span>ค่าจัดส่ง: <b className="text-[#16A085] font-semibold">รอร้านค้าประเมินและแจ้งให้ทราบภายหลัง</b></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-gray-100 p-4 sm:p-5 sticky top-20">
              <h3 className="font-bold text-base text-gray-800 mb-4 flex items-center gap-2 pb-2.5 border-b border-gray-100">
                <i className="fa-solid fa-receipt text-[#16A085] text-sm"></i> สรุปคำสั่งซื้อ
              </h3>
              
              <div className="space-y-2.5 mb-4 text-xs sm:text-sm font-medium">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">ยอดรวมสินค้า ({checkoutCart.length} ชิ้น)</span>
                  <span className="font-bold text-gray-800">{formatPrice(totalPriceMinor)}</span>
                </div>
                {totalDiscountMinor > 0 && (
                  <div className="flex justify-between items-center text-[#16A085]">
                    <span className="font-bold flex items-center gap-1.5">
                      <i className="fa-solid fa-ticket text-xs"></i> ส่วนลดจากคูปอง
                    </span>
                    <span className="font-black">-{formatPrice(totalDiscountMinor)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">ค่าจัดส่ง</span>
                  <span className="text-[#16A085] font-bold bg-emerald-50 px-2 py-0.5 rounded-md text-[11px] border border-emerald-200/60">
                    ร้านแจ้งภายหลัง
                  </span>
                </div>
                
                <div className="border-t border-gray-100 border-dashed pt-3 flex justify-between items-end mt-1">
                  <span className="font-bold text-gray-700">ยอดชำระเบื้องต้น</span>
                  <div className="text-right">
                    <span className="font-black text-[#16A085] text-2xl block leading-none">
                      {formatPrice(netTotalPriceMinor)}
                    </span>
                    {totalDiscountMinor > 0 && (
                      <span className="text-[10px] text-gray-400 font-medium block mt-1">
                        ประหยัดไป {formatPrice(totalDiscountMinor)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="bg-amber-50/80 border border-amber-200/70 rounded-xl p-2.5 sm:p-3 mb-4 text-[11px] sm:text-xs text-amber-800 flex items-start gap-2 leading-relaxed">
                <i className="fa-solid fa-circle-info text-amber-500 text-xs mt-0.5 flex-shrink-0"></i>
                <span>
                  คุณยังไม่ต้องชำระเงินในขั้นตอนนี้ ร้านค้าจะทำการประเมินค่าจัดส่งภายใน 24 ชม. หากค่าจัดส่งสูงเกินไป คุณสามารถกดยกเลิกได้
                </span>
              </div>
              
              <button 
                onClick={handlePlaceOrder} 
                disabled={isSubmitting}
                className="w-full bg-[#16A085] hover:bg-[#12876f] text-white font-bold py-3 sm:py-3.5 rounded-xl sm:rounded-2xl transition-all shadow-sm hover:shadow active:scale-98 text-sm sm:text-base flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <><i className="fa-solid fa-spinner fa-spin text-sm"></i> กำลังประมวลผล...</>
                ) : (
                  <><i className="fa-solid fa-check text-sm"></i> ยืนยันการสั่งซื้อเลย</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Voucher Selector Modal */}
        {isVoucherModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-gray-100">
              {/* Modal Header */}
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#16A085]/10 text-[#16A085] flex items-center justify-center text-lg">
                    <i className="fa-solid fa-ticket"></i>
                  </div>
                  <div>
                    <h3 className="font-black text-gray-800 text-lg">เลือกโค้ดส่วนลด</h3>
                    <p className="text-xs text-gray-500 font-medium">{voucherModalShopName}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeVoucherModal}
                  className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition"
                >
                  <i className="fa-solid fa-xmark text-sm"></i>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto flex-grow space-y-6">
                {/* Promo code input box */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-2">
                    กรอกรหัสโค้ดส่วนลด
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-grow">
                      <input
                        type="text"
                        placeholder="เช่น VRU10, WELCOME50"
                        value={inputCode}
                        onChange={(e) => {
                          setInputCode(e.target.value.toUpperCase());
                          setInputCodeError(null);
                        }}
                        className="w-full bg-gray-50 border-2 border-gray-100 uppercase font-mono text-sm font-bold py-2.5 pl-9 pr-4 rounded-xl focus:outline-none focus:border-[#16A085] focus:bg-white transition"
                      />
                      <i className="fa-solid fa-tag text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 text-xs"></i>
                    </div>
                    <button
                      type="button"
                      onClick={handleValidateInputCode}
                      disabled={inputCodeLoading || !inputCode.trim()}
                      className="btn-minimal px-5 py-2.5 rounded-xl font-bold text-xs shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {inputCodeLoading ? (
                        <i className="fa-solid fa-spinner fa-spin"></i>
                      ) : (
                        "ใช้โค้ด"
                      )}
                    </button>
                  </div>
                  {inputCodeError && (
                    <p className="text-xs font-medium text-red-500 mt-2 flex items-center gap-1">
                      <i className="fa-solid fa-circle-exclamation text-[10px]"></i>
                      {inputCodeError}
                    </p>
                  )}
                </div>

                {/* Claimed Vouchers List */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
                      โค้ดส่วนลดที่คุณเก็บไว้
                    </h4>
                    <span className="text-[11px] text-gray-400 font-medium">
                      {shopClaims.length} โค้ด
                    </span>
                  </div>

                  {isClaimsLoading ? (
                    <div className="py-8 text-center text-gray-400">
                      <i className="fa-solid fa-spinner fa-spin text-2xl text-[#16A085] mb-2"></i>
                      <p className="text-xs font-medium">กำลังโหลดคูปอง...</p>
                    </div>
                  ) : shopClaims.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-gray-50 text-center border border-dashed border-gray-200">
                      <i className="fa-solid fa-ticket-simple text-gray-300 text-3xl mb-2 block"></i>
                      <p className="text-xs font-bold text-gray-600 mb-1">ยังไม่มีโค้ดส่วนลดที่เก็บไว้</p>
                      <p className="text-[11px] text-gray-400">คุณสามารถพิมพ์รหัสคูปองในช่องด้านบน หรือไปกดเก็บโค้ดได้ที่หน้าร้านค้า</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {shopClaims.map((claim) => {
                        const coupon = claim.coupon;
                        const isSelected = tempSelectedCoupon?.coupon.id === coupon.id;
                        const isEligible = voucherModalSubtotalMinor >= coupon.minSpendAmountMinor;

                        let discountMinor = 0;
                        if (coupon.discountType === "FIXED_AMOUNT") {
                          discountMinor = Math.min(voucherModalSubtotalMinor, coupon.discountValue);
                        } else {
                          let disc = Math.round(voucherModalSubtotalMinor * (coupon.discountValue / 100));
                          if (coupon.maxDiscountAmountMinor && coupon.maxDiscountAmountMinor > 0) {
                            disc = Math.min(disc, coupon.maxDiscountAmountMinor);
                          }
                          discountMinor = Math.min(voucherModalSubtotalMinor, disc);
                        }

                        return (
                          <div
                            key={claim.id}
                            onClick={() => {
                              if (isEligible) {
                                if (isSelected) {
                                  setTempSelectedCoupon(null);
                                } else {
                                  setTempSelectedCoupon({ coupon, discountMinor });
                                }
                              }
                            }}
                            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden flex items-start gap-3 ${
                              isSelected
                                ? "border-[#16A085] bg-[#E8F8F5]/40 shadow-sm"
                                : isEligible
                                ? "border-gray-100 hover:border-gray-200 bg-white"
                                : "border-gray-100 bg-gray-50/70 opacity-60 cursor-not-allowed"
                            }`}
                          >
                            {/* Radio check icon */}
                            <div className="pt-0.5">
                              <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition ${
                                  isSelected
                                    ? "border-[#16A085] bg-[#16A085] text-white"
                                    : "border-gray-300 bg-white"
                                }`}
                              >
                                {isSelected && <i className="fa-solid fa-check text-[10px]"></i>}
                              </div>
                            </div>

                            <div className="flex-grow min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div>
                                  <span className="text-base font-black text-[#16A085]">
                                    {coupon.discountType === "FIXED_AMOUNT"
                                      ? `ลด ฿${(coupon.discountValue / 100).toLocaleString()}`
                                      : `ลด ${coupon.discountValue}%`}
                                  </span>
                                  {coupon.discountType === "PERCENTAGE" && coupon.maxDiscountAmountMinor && (
                                    <span className="ml-1 text-[11px] text-gray-500 font-medium">
                                      (สูงสุด ฿{(coupon.maxDiscountAmountMinor / 100).toLocaleString()})
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono text-xs font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                                  {coupon.code}
                                </span>
                              </div>

                              <p className="text-xs font-bold text-gray-800 line-clamp-1">{coupon.name}</p>
                              <p className="text-[11px] text-gray-500 mt-1">
                                ขั้นต่ำ ฿{(coupon.minSpendAmountMinor / 100).toLocaleString()} • หมดอายุ {new Date(coupon.endDate).toLocaleDateString("th-TH")}
                              </p>

                              {!isEligible ? (
                                <p className="text-[11px] font-bold text-amber-600 mt-2 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100 inline-block">
                                  <i className="fa-solid fa-circle-exclamation mr-1"></i>
                                  ซื้อเพิ่มอีก {formatPrice(coupon.minSpendAmountMinor - voucherModalSubtotalMinor)} เพื่อใช้โค้ดนี้
                                </p>
                              ) : isSelected ? (
                                <p className="text-[11px] font-bold text-[#16A085] mt-2">
                                  ✓ ประหยัดได้ {formatPrice(discountMinor)}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setTempSelectedCoupon(null)}
                  className="text-xs font-bold text-gray-500 hover:text-gray-700 underline"
                >
                  ไม่ใช้โค้ดส่วนลด
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeVoucherModal}
                    className="px-4 py-2.5 rounded-full border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-100 transition"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyVoucherSelection}
                    className="btn-minimal px-6 py-2.5 rounded-full text-xs font-bold shadow-sm"
                  >
                    ยืนยัน
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
