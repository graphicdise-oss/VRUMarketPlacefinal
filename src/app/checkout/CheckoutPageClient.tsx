"use client";

import Link from "next/link";

import { useCart } from "@/components/cart/CartProvider";
import { formatPrice } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { Address } from "@/types";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { useSearchParams } from "next/navigation";
import { buyerOrderApi, addressApi, couponApi, CouponDto, UserCouponClaimDto } from "@/lib/api";

export default function CheckoutPageClient() {
  const searchParams = useSearchParams();
  const shopIdParam = searchParams.get("shopId");
  
  const { cart: fullCart, getCartGroupedByShop, clearCart, removeFromCart, refreshCart } = useCart();
  const isPlacingOrderRef = useRef(false);
  
  // Filter cart by shopId if provided
  const cart = shopIdParam ? fullCart.filter(item => item.shopId === shopIdParam) : fullCart;
  const totalPriceMinor = cart.reduce((sum, item) => sum + item.priceMinor * item.qty, 0);
  
  const shopGroups = getCartGroupedByShop();
  
  // Filter shop groups if shopId provided
  let filteredShopGroups = shopGroups;
  if (shopIdParam && shopGroups[shopIdParam]) {
    filteredShopGroups = { [shopIdParam]: shopGroups[shopIdParam] };
  } else if (shopIdParam) {
    filteredShopGroups = {};
  }
  
  const shopCount = Object.keys(filteredShopGroups).length;
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const { user } = useAuth();

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
      // Gather all orderable items
      const itemsToCheckout = cart.filter(i => i.orderable !== false).map(i => ({
        cartItemId: i.id,
        quantity: i.qty,
        priceAmountMinor: i.priceMinor,
      }));

      if (itemsToCheckout.length === 0) {
        await refreshCart();
        alert("ตะกร้าว่างหรือไม่มีสินค้าที่สั่งได้ กรุณากลับไปตรวจสอบตะกร้า");
        isPlacingOrderRef.current = false;
        setIsSubmitting(false);
        return;
      }

      const couponsPayload = Object.entries(selectedCoupons)
        .filter(([, val]) => val !== null)
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
      
      // If we only checked out one shop, remove only those items from cart
      if (shopIdParam) {
        for (const item of itemsToCheckout) {
          await removeFromCart(item.cartItemId);
        }
      } else {
        await clearCart();
      }
      
      isPlacingOrderRef.current = false;
      setIsSubmitting(false);
    } catch (error) {
      console.error("Failed to place order:", error);
      // The server cart may have changed under us (already ordered, other tab, item no longer orderable).
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

  if (cart.length === 0) {
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
            <h2 className="text-2xl font-bold text-gray-700 mb-3">ตะกร้าของคุณว่างเปล่า</h2>
            <p className="text-gray-500 mb-8">คุณยังไม่มีสินค้าในตะกร้า ลองเลือกดูสินค้าชุมชนของเราสิครับ</p>
            <Link href="/" className="btn-minimal font-bold px-8 py-3.5 rounded-full inline-block shadow-md">
              เลือกซื้อสินค้าเลย
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-sm">
              <i className="fa-solid fa-leaf text-xl"></i>
            </div>
            <h1 className="text-xl font-black tracking-tight text-gray-800">VRU <span className="text-[#16A085]">Marketplace</span></h1>
          </Link>
          <Link href="/" className="text-sm font-bold text-gray-500 hover:text-[#16A085] bg-gray-50 hover:bg-[#D4F1BB]/30 px-4 py-2 rounded-full transition flex items-center gap-2">
            <i className="fa-solid fa-house"></i> กลับหน้าหลัก
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-10">
        <Breadcrumb items={[{ label: "ชำระเงิน" }]} />
        <h2 className="text-2xl md:text-3xl font-black text-gray-800 mb-8 flex items-center gap-3">
          <div className="w-12 h-12 bg-[#16A085] rounded-2xl flex items-center justify-center text-white shadow-sm">
            <i className="fa-solid fa-file-invoice text-xl"></i>
          </div>
          ยืนยันคำสั่งซื้อ
        </h2>

        {/* แจ้งเตือน: แยกออเดอร์ */}
        {shopCount > 1 && (
          <div className="bg-[#D4F1BB]/30 border border-[#16A085]/30 rounded-2xl p-5 mb-8 flex items-start gap-4">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-[#16A085] flex-shrink-0 shadow-sm mt-1">
              <i className="fa-solid fa-info text-xl"></i>
            </div>
            <div>
              <p className="text-base font-bold text-gray-800 mb-1">สินค้าจาก {shopCount} ร้าน จะถูกแยกเป็น {shopCount} คำสั่งซื้อ</p>
              <p className="text-sm text-gray-600 font-medium">เนื่องจากระบบสนับสนุนให้รายได้เข้าสู่ชุมชนโดยตรง แต่ละร้านจึงมีบัญชีรับเงินแยกกัน การโอนเงินจะทำแยกต่อคำสั่งซื้อครับ</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Orders Breakdown */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* ที่อยู่จัดส่ง */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-lg text-gray-800 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
                    <i className="fa-solid fa-location-dot"></i>
                  </div>
                  ที่อยู่สำหรับการจัดส่ง
                </h3>
                <Link href="/profile/addresses" className="text-sm text-[#16A085] font-bold hover:underline bg-[#D4F1BB]/30 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                  <i className="fa-solid fa-pen text-xs"></i> จัดการที่อยู่
                </Link>
              </div>
              
              <div className="relative mb-4">
                <select 
                  value={selectedAddress} 
                  onChange={(e) => setSelectedAddress(e.target.value)}
                  className="w-full appearance-none bg-gray-50 border-2 border-gray-100 text-gray-800 text-sm font-medium py-3.5 px-5 rounded-2xl focus:outline-none focus:border-[#16A085] focus:bg-white transition-all shadow-inner"
                >
                  {addresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.recipientName} ({addr.phone}) - {addr.houseNumber} ต.{addr.subdistrictNameTh} อ.{addr.districtNameTh} จ.{addr.provinceNameTh} {addr.postalCode} {addr.isDefault ? "(ค่าเริ่มต้น)" : ""}
                    </option>
                  ))}
                  {addresses.length === 0 && <option value="">ยังไม่มีที่อยู่จัดส่ง กรุณาเพิ่มที่อยู่ใหม่</option>}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <i className="fa-solid fa-chevron-down"></i>
                </div>
              </div>

              {/* Show selected address details */}
              {addresses.find(a => a.id === selectedAddress) && (
                <div className="p-5 bg-white border-2 border-[#16A085]/20 rounded-2xl text-sm relative overflow-hidden shadow-sm">
                  <div className="absolute top-0 left-0 w-1 h-full bg-[#16A085]"></div>
                  <p className="font-black text-gray-800 mb-2 text-base">{addresses.find(a => a.id === selectedAddress)?.recipientName} <span className="text-gray-500 font-medium ml-2 text-sm">{addresses.find(a => a.id === selectedAddress)?.phone}</span></p>
                  <p className="text-gray-600 leading-relaxed font-medium">{addresses.find(a => a.id === selectedAddress)?.houseNumber} ต.{addresses.find(a => a.id === selectedAddress)?.subdistrictNameTh} อ.{addresses.find(a => a.id === selectedAddress)?.districtNameTh} จ.{addresses.find(a => a.id === selectedAddress)?.provinceNameTh} {addresses.find(a => a.id === selectedAddress)?.postalCode}</p>
                </div>
              )}
            </div>

            {/* รายการสินค้าแยกตามร้าน */}
            {Object.values(filteredShopGroups).map((group, idx) => {
              const currentCoupon = selectedCoupons[group.shopId];
              const shopDiscount = currentCoupon?.discountMinor || 0;
              const shopNetSubtotal = Math.max(0, group.subtotalMinor - shopDiscount);

              return (
                <div key={group.shopId} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500">
                      <i className="fa-solid fa-store text-xs"></i>
                    </div>
                    <span className="font-bold text-gray-800 text-lg">{group.shopName}</span>
                    {shopCount > 1 && <span className="ml-auto text-xs bg-gray-200 text-gray-600 px-3 py-1 rounded-full font-bold">คำสั่งซื้อที่ {idx + 1}</span>}
                  </div>
                  
                  <div className="divide-y divide-gray-50 p-2">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex gap-4 p-4">
                        <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-2xl border border-gray-100 flex-shrink-0" />
                        <div className="flex-grow min-w-0 flex flex-col justify-center">
                          <h4 className="text-base font-bold text-gray-800 line-clamp-1 mb-1">{item.name}</h4>
                          <p className="text-xs text-gray-400 font-medium mb-auto">{item.variantName}</p>
                          <div className="flex items-end justify-between mt-2">
                            <span className="text-[#16A085] font-black">{formatPrice(item.priceMinor)}</span>
                            <span className="text-xs font-bold text-gray-500 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">จำนวน: {item.qty}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Coupon Bar for Shop */}
                  <div className="px-6 py-3.5 bg-gradient-to-r from-teal-50/50 to-emerald-50/30 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#16A085]/10 text-[#16A085] flex items-center justify-center text-xs">
                        <i className="fa-solid fa-ticket"></i>
                      </div>
                      <div>
                        <span className="text-sm font-bold text-gray-800">โค้ดส่วนลดร้านค้า</span>
                        {currentCoupon && (
                          <span className="ml-2 text-xs font-mono font-bold bg-[#16A085] text-white px-2 py-0.5 rounded-md">
                            {currentCoupon.coupon.code} (-{formatPrice(currentCoupon.discountMinor)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentCoupon ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openVoucherModal(group.shopId, group.shopName, group.subtotalMinor)}
                            className="text-xs text-[#16A085] font-bold hover:underline"
                          >
                            เปลี่ยน
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveCoupon(group.shopId)}
                            className="text-xs text-red-500 font-bold hover:underline"
                          >
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openVoucherModal(group.shopId, group.shopName, group.subtotalMinor)}
                          className="text-xs font-bold text-[#16A085] hover:text-[#117A65] flex items-center gap-1 bg-white px-3 py-1.5 rounded-full border border-teal-200 shadow-sm"
                        >
                          เลือกโค้ดส่วนลด <i className="fa-solid fa-chevron-right text-[10px]"></i>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-50 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-sm text-gray-600">
                      <span>รวมราคาสินค้าร้านนี้</span>
                      <span className="font-bold text-gray-800">{formatPrice(group.subtotalMinor)}</span>
                    </div>
                    {shopDiscount > 0 && (
                      <div className="flex justify-between items-center text-sm text-[#16A085]">
                        <span className="font-medium flex items-center gap-1">
                          <i className="fa-solid fa-tag text-xs"></i> ส่วนลดคูปอง
                        </span>
                        <span className="font-bold">-{formatPrice(shopDiscount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-base pt-1 border-t border-gray-100">
                      <span className="text-sm font-bold text-gray-700">ยอดรวมร้านนี้</span>
                      <span className="font-black text-[#16A085] text-lg">{formatPrice(shopNetSubtotal)}</span>
                    </div>
                  </div>
                  <div className="px-6 py-4 bg-[#16A085]/5 flex items-center gap-3 text-sm border-t border-[#16A085]/10">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[#16A085] shadow-sm">
                      <i className="fa-solid fa-truck-fast text-xs"></i>
                    </div>
                    <span className="text-gray-700 font-medium">ค่าจัดส่ง: <b className="text-[#16A085]">รอร้านค้าประเมินและแจ้งให้ทราบภายหลัง</b></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sticky top-24">
              <h3 className="font-black text-xl text-gray-800 mb-6 flex items-center gap-2">
                <i className="fa-solid fa-receipt text-gray-400"></i> สรุปคำสั่งซื้อ
              </h3>
              
              <div className="space-y-4 mb-6 text-sm font-medium">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">ยอดรวมสินค้า ({cart.length} ชิ้น)</span>
                  <span className="font-bold text-gray-800 text-base">{formatPrice(totalPriceMinor)}</span>
                </div>
                {totalDiscountMinor > 0 && (
                  <div className="flex justify-between items-center text-[#16A085]">
                    <span className="font-bold flex items-center gap-1.5">
                      <i className="fa-solid fa-ticket text-xs"></i> ส่วนลดจากคูปอง
                    </span>
                    <span className="font-black text-base">-{formatPrice(totalDiscountMinor)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">ค่าจัดส่ง</span>
                  <span className="text-[#16A085] font-bold bg-[#D4F1BB]/30 px-2 py-0.5 rounded-full text-xs">ร้านแจ้งภายหลัง</span>
                </div>
                
                <div className="border-t-2 border-gray-100 border-dashed pt-4 flex justify-between items-end mt-2">
                  <span className="font-bold text-gray-600">ยอดชำระเบื้องต้น</span>
                  <div className="text-right">
                    <span className="font-black text-[#16A085] text-3xl block leading-none">{formatPrice(netTotalPriceMinor)}</span>
                    {totalDiscountMinor > 0 && (
                      <span className="text-[11px] text-gray-400 font-medium block mt-1">ประหยัดไป {formatPrice(totalDiscountMinor)}</span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6">
                <p className="text-xs text-yellow-700 font-medium leading-relaxed">
                  <i className="fa-solid fa-circle-exclamation text-yellow-500 mr-1.5"></i>
                  คุณยังไม่ต้องชำระเงินในขั้นตอนนี้ ร้านค้าจะทำการประเมินค่าจัดส่งภายใน 24 ชม. หลังยืนยันออเดอร์ หากค่าจัดส่งสูงเกินไป คุณสามารถกดยกเลิกได้
                </p>
              </div>
              
              <button 
                onClick={handlePlaceOrder} 
                disabled={isSubmitting}
                className="w-full btn-minimal text-white font-bold py-4 rounded-full shadow-md transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <><i className="fa-solid fa-spinner fa-spin mr-2"></i> กำลังประมวลผล...</>
                ) : (
                  <><i className="fa-solid fa-check mr-2"></i> ยืนยันการสั่งซื้อเลย</>
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
