"use client";

import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { legalApi } from "@/lib/api";

export default function PrivacyClient() {
  const [version, setVersion] = useState("2026-09-29");

  useEffect(() => {
    legalApi.getPrivacyPolicy().then((res) => {
      if (res?.version) setVersion(res.version);
    }).catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Header />
      <main className="flex-grow max-w-4xl mx-auto w-full px-4 sm:px-6 py-10">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-10 space-y-8">
          {/* Header */}
          <div className="border-b border-gray-100 pb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-50 text-[#16A085] rounded-full text-xs font-bold mb-3">
              <i className="fa-solid fa-shield-halved"></i> PDPA Compliance
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              นโยบายความเป็นส่วนตัว (Privacy Policy)
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              VRU Marketplace · มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ · เวอร์ชัน: <span className="font-mono font-bold text-gray-700">{version}</span>
            </p>
          </div>

          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">1</span>
              ผู้ควบคุมข้อมูลส่วนบุคคล (Data Controller)
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <p>
                ผู้ควบคุมข้อมูลส่วนบุคคลตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) คือ{" "}
                <strong className="text-gray-800">มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ จังหวัดปทุมธานี</strong> (&quot;มหาวิทยาลัย&quot; หรือ &quot;เรา&quot;)
              </p>
              <p>
                ฐานข้อมูลทั้งหมดเป็นกรรมสิทธิ์ของมหาวิทยาลัยฯ โดยสมบูรณ์ มหาวิทยาลัยเป็นผู้กำหนดวัตถุประสงค์และวิธีการในการประมวลผลข้อมูลส่วนบุคคลบนแพลตฟอร์ม VRU Marketplace
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">2</span>
              ข้อมูลส่วนบุคคลที่เราเก็บรวบรวม
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <p>เราเก็บรวบรวมข้อมูลส่วนบุคคลเท่าที่จำเป็นต่อการให้บริการซื้อขายสินค้าและจัดการชุมชน ได้แก่:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>ข้อมูลบัญชีผู้ใช้:</strong> อีเมล, รหัสผ่าน (เข้ารหัสด้วย Argon2id ไม่สามารถถอดรหัสกลับได้), สถานะการยืนยันอีเมล</li>
                <li><strong>ข้อมูลที่อยู่จัดส่ง:</strong> ชื่อผู้รับ, หมายเลขโทรศัพท์, ที่อยู่จัดส่งพัสดุ และรหัสไปรษณีย์</li>
                <li><strong>ข้อมูลร้านค้า (สำหรับผู้ขาย):</strong> ชื่อร้าน, คำอธิบายร้าน, เบอร์โทรศัพท์ติดต่อ, พิกัดตำแหน่งที่ตั้งร้าน, บัญชีธนาคารหรือพร้อมเพย์สำหรับรับเงิน</li>
                <li><strong>ข้อมูลคำสั่งซื้อและการชำระเงิน:</strong> รายการสินค้าที่สั่งซื้อ, สลิปหลักฐานการโอนเงิน, สลิปการจัดส่งพัสดุ, ข้อมูลบัญชีรับเงินคืน (เมื่อมีคำสั่งคืนเงิน)</li>
                <li><strong>ข้อมูลการสื่อสาร:</strong> ประวัติข้อความสนทนาในระบบแชทระหว่างผู้ซื้อและร้านค้า, ข้อความและหลักฐานในกระบวนการระงับข้อพิพาท</li>
                <li><strong>ข้อมูลจราจรทางคอมพิวเตอร์ (Log):</strong> IP Address, User-Agent, วันเวลาและเส้นทางการเข้าใช้งาน ตามมาตรา 26 แห่ง พ.ร.บ. ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ฯ (จัดเก็บอย่างน้อย 90 วัน)</li>
              </ul>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">3</span>
              อายุของผู้ใช้งานและความยินยอม
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed pl-9">
              <p>
                ผู้ใช้งานต้องมีอายุตั้งแต่ 20 ปีบริบูรณ์ขึ้นไป หรือหากมีอายุต่ำกว่า 20 ปีบริบูรณ์ ต้องได้รับความยินยอมจากผู้แทนโดยชอบธรรม (ผู้ปกครอง) ก่อนการสมัครสมาชิกและทำธุรกรรมบนแพลตฟอร์ม
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">4</span>
              วัตถุประสงค์ในการประมวลผลข้อมูล
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <ul className="list-disc pl-5 space-y-1">
                <li>เพื่อสร้างและจัดการบัญชีผู้ใช้งาน ยืนยันตัวตน และรักษาความปลอดภัยของระบบ</li>
                <li>เพื่ออำนวยความสะดวกในการซื้อขาย ส่งคำสั่งซื้อ ชำระเงิน และจัดส่งสินค้าระหว่างผู้ซื้อและผู้ขาย</li>
                <li>เพื่อเป็นหลักฐานในการระงับข้อพิพาทและคุ้มครองสิทธิ์ของผู้ซื้อและผู้ขายอย่างเป็นธรรม</li>
                <li>เพื่อปฏิบัติตามกฎหมายและระเบียบของทางราชการที่เกี่ยวข้อง</li>
              </ul>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">5</span>
              สิทธิของเจ้าของข้อมูลส่วนบุคคล
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <p>ท่านมีสิทธิตามกฎหมาย PDPA ในการ:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>ขอเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคลของท่าน</li>
                <li>ขอแก้ไขข้อมูลส่วนบุคคลให้ถูกต้อง เป็นปัจจุบัน และสมบูรณ์</li>
                <li>ขอให้ลบ ทำลาย หรือระงับการใช้ข้อมูลส่วนบุคคล (Account Erasure) ผ่านระบบการจัดการโปรไฟล์</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
                หมายเหตุ: เพื่อป้องกันการทุจริตและการกระทำผิดซ้ำ บัญชีที่ถูกระงับหรือมีประวัติการทุจริต ระบบจะเก็บค่าแฮชระบุตัวตน (DeletedAccountMarker ด้วย HMAC Pepper ที่เข้ารหัสปลอดภัย) เพื่อป้องกันไม่ให้ใช้อีเมลเดิมมาสมัครใหม่ได้ ตามข้อยกเว้นสิทธิในการลบของ PDPA
              </p>
            </div>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-[#E8F8F5] text-[#16A085] rounded-lg flex items-center justify-center text-xs font-black">6</span>
              การติดต่อเรา
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed pl-9">
              <p>
                หากท่านมีข้อสงสัยหรือต้องการใช้สิทธิเกี่ยวกับข้อมูลส่วนบุคคลของท่าน สามารถติดต่อได้ที่:
              </p>
              <div className="mt-2 bg-gray-50 p-4 rounded-xl border border-gray-100 text-gray-700">
                <p className="font-bold">มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์</p>
                <p className="text-xs text-gray-500 mt-1">เลขที่ 1 หมู่ 20 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 13180</p>
                <p className="text-xs text-gray-500 mt-1">อีเมลติดต่อ: support@vrumarketplace.com</p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

