"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { formatPrice } from "@/lib/utils";

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartModal({ isOpen, onClose }: CartModalProps) {
  const { cart, removeFromCart, updateQuantity, totalPriceMinor, getCartGroupedByShop } = useCart();
  const shopGroups = getCartGroupedByShop();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex justify-end opacity-100 transition-opacity duration-300" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md h-full shadow-[auto_-10px_30px_rgba(0,0,0,0.1)] flex flex-col transform transition-transform duration-300 translate-x-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-white z-10">
          <h3 className="font-bold text-xl text-gray-800 flex items-center gap-3">
            <div className="w-10 h-10 bg-[#D4F1BB]/50 rounded-full flex items-center justify-center text-[#16A085]">
              <i className="fa-solid fa-cart-shopping"></i>
            </div>
            ตะกร้าสินค้า
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 hover:bg-red-50">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Items */}
        <div className="flex-grow overflow-y-auto p-5 flex flex-col gap-5 bg-gray-50/50">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300 text-4xl">
                <i className="fa-solid fa-cart-arrow-down"></i>
              </div>
              <p className="font-medium">ยังไม่มีสินค้าในตะกร้า</p>
              <button onClick={onClose} className="mt-4 text-[#16A085] font-bold hover:underline">ไปเลือกซื้อสินค้ากันเลย</button>
            </div>
          ) : (
            Object.values(shopGroups).map((group) => (
              <div key={group.shopId} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                {/* Shop Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
                  <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                    <i className="fa-solid fa-store text-gray-500 text-[10px]"></i>
                  </div>
                  <span className="text-sm font-bold text-gray-700">{group.shopName}</span>
                  <span className="ml-auto text-[11px] font-bold text-[#16A085] bg-[#D4F1BB]/30 px-2 py-0.5 rounded-full">{group.items.length} รายการ</span>
                </div>

                {/* Items in shop */}
                <div className="flex flex-col divide-y divide-gray-50 p-2">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex gap-4 p-3 relative group">
                      <img src={item.image} alt={item.name} className="w-20 h-20 object-cover rounded-xl border border-gray-100 flex-shrink-0" />
                      <div className="flex flex-col flex-grow min-w-0 py-0.5">
                        <h4 className="text-sm font-bold text-gray-800 line-clamp-2 leading-tight mb-1 pr-6">{item.name}</h4>
                        <span className="text-[11px] text-gray-400 mb-auto">{item.variantName}</span>
                        <div className="flex items-end justify-between mt-2">
                          <span className="text-[#16A085] font-bold">{formatPrice(item.priceMinor)}</span>
                          <div className="flex items-center bg-gray-50 border border-gray-100 rounded-full p-0.5 shadow-inner">
                            <button onClick={() => updateQuantity(item.id, item.qty - 1)} className="w-7 h-7 flex items-center justify-center bg-white rounded-full text-gray-500 hover:text-[#16A085] transition shadow-sm">-</button>
                            <span className="text-xs font-bold w-7 text-center">{item.qty}</span>
                            <button onClick={() => updateQuantity(item.id, item.qty + 1)} className="w-7 h-7 flex items-center justify-center bg-white rounded-full text-gray-500 hover:text-[#16A085] transition shadow-sm">+</button>
                          </div>
                        </div>
                      </div>
                      <button 
                        type="button"
                        onClick={() => removeFromCart(item.id)} 
                        className="absolute top-2.5 right-2.5 text-gray-400 sm:text-gray-300 hover:text-red-500 transition w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center bg-white rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 shadow-sm border border-gray-100 cursor-pointer"
                        title="ลบออกจากตะกร้า"
                      >
                        <i className="fa-solid fa-trash text-xs sm:text-[10px]"></i>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Shop Subtotal & Actions */}
                <div className="flex flex-col sm:flex-row justify-between items-center px-4 py-3 bg-gray-50 gap-3">
                  <div className="flex justify-between w-full sm:w-auto items-center gap-4 text-sm">
                    <span className="text-gray-500 font-medium">รวมร้านนี้</span>
                    <span className="text-[#16A085] font-bold text-lg">{formatPrice(group.subtotalMinor)}</span>
                  </div>
                  <Link href={`/checkout?shopId=${group.shopId}`} onClick={onClose} className="w-full sm:w-auto text-center border-2 border-[#16A085] text-[#16A085] hover:bg-[#16A085] hover:text-white text-xs font-bold py-2 px-5 rounded-full transition shadow-sm hover:shadow">
                    ชำระเงินเฉพาะร้านนี้
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && Object.keys(shopGroups).length === 1 && (
          <div className="p-5 border-t border-gray-100 bg-white z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div className="flex justify-between items-center mb-5">
              <span className="text-gray-500 font-bold">ยอดรวมทั้งสิ้น</span>
              <div className="text-right">
                <span className="text-[#16A085] font-black text-2xl block leading-none">{formatPrice(totalPriceMinor)}</span>
                <span className="text-[10px] text-gray-400 font-medium">ยังไม่รวมค่าจัดส่ง (ร้านค้าจะแจ้งภายหลัง)</span>
              </div>
            </div>
            <Link href="/checkout" onClick={onClose} className="btn-minimal block w-full text-center font-bold py-4 rounded-full shadow-md transition-all text-sm">
              สั่งซื้อทั้งหมด ({cart.length} ชิ้น)
            </Link>
          </div>
        )}
        
        {cart.length > 0 && Object.keys(shopGroups).length > 1 && (
          <div className="p-5 border-t border-gray-100 bg-white z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
              <i className="fa-solid fa-circle-info text-yellow-600"></i>
              <span className="text-xs text-yellow-700 font-medium leading-relaxed">สินค้าของคุณมาจากหลายร้านค้า กรุณากดปุ่ม <b>&quot;ชำระเงินเฉพาะร้านนี้&quot;</b> ที่ด้านล่างของแต่ละร้าน เพื่อสั่งซื้อแยกกันครับ</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}