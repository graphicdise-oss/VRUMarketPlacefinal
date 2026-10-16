import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="bg-white border-t-[6px] border-[#16A085] mt-10">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row items-center md:items-start justify-evenly gap-10 text-center md:text-left">
          <div className="flex flex-col items-center md:items-start">
            <div className="flex items-center gap-3 mb-4 group">
              <Image src="/logo.png" alt="VRU Marketplace Logo" width={56} height={56} className="w-14 h-14 object-contain group-hover:scale-105 transition-transform duration-300" />
              <div className="flex flex-col leading-none items-center">
                <span className="text-xl font-bold tracking-tight text-[#16A085]">VRU <span className="text-gray-800">Marketplace</span></span>
                <div className="text-[11px] font-black tracking-[0.2em] uppercase mt-1 bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                  Thai Trade
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-6 leading-relaxed max-w-xs">สินค้าท้องถิ่น ส่งตรงจากชุมชนถึงมือคุณด้วยความใส่ใจและเชื่อถือได้</p>
            <div className="flex gap-4 text-xl justify-center md:justify-start">
              <a href="#" className="w-10 h-10 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 hover:text-[#1877F2] hover:bg-blue-50 transition"><i className="fa-brands fa-facebook"></i></a>
              <a href="#" className="w-10 h-10 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 hover:text-[#E1306C] hover:bg-pink-50 transition"><i className="fa-brands fa-instagram"></i></a>
              <a href="#" className="w-10 h-10 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 hover:text-[#00B900] hover:bg-green-50 transition"><i className="fa-brands fa-line"></i></a>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-gray-800 mb-6">เมนูหลัก</h4>
            <ul className="space-y-3 text-sm text-gray-500 font-medium">
              <li><Link href="/" className="hover:text-[#16A085] transition">หน้าแรก</Link></li>
              <li><Link href="/shops" className="hover:text-[#16A085] transition">ร้านค้าทั้งหมด</Link></li>
              <li><Link href="/products" className="hover:text-[#16A085] transition">สินค้า</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-gray-800 mb-6">บริการลูกค้า</h4>
            <ul className="space-y-3 text-sm text-gray-500 font-medium">
              <li><Link href="/chat" className="hover:text-[#16A085] transition">ติดต่อร้านค้า</Link></li>
              <li><Link href="/orders" className="hover:text-[#16A085] transition">ติดตามสถานะคำสั่งซื้อ</Link></li>
              <li><Link href="/login" className="hover:text-[#16A085] transition font-bold text-[#16A085]">เข้าสู่ระบบ / สร้างบัญชี</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 pt-6 pb-20 md:pb-6 text-center text-xs text-gray-400 font-medium border-t border-gray-100">
        &copy; 2026 มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ สงวนลิขสิทธิ์
      </div>
    </footer>
  );
}