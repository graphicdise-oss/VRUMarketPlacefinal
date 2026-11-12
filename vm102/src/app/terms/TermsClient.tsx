"use client";

import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { legalApi } from "@/lib/api";

export default function TermsClient() {
  const [version, setVersion] = useState("2026-09-29");

  useEffect(() => {
    legalApi.getTermsOfService().then((res) => {
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
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold mb-3">
              <i className="fa-solid fa-file-contract"></i> User Agreement
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              ข้อกำหนดและเงื่อนไขการใช้บริการ (Terms of Service)
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              VRU Marketplace · มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ · เวอร์ชัน: <span className="font-mono font-bold text-gray-700">{version}</span>
            </p>
          </div>

          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-black">1</span>
              บทนำและขอบเขตข้อตกลง
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <p>
                VRU Marketplace เป็นแพลตฟอร์มตลาดออนไลน์ของชุมชน ดำเนินการโดย <strong className="text-gray-800">มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ จังหวัดปทุมธานี</strong> (&quot;มหาวิทยาลัย&quot; หรือ &quot;เรา&quot;) เพื่อส่งเสริมเศรษฐกิจชุมชนและสินค้าท้องถิ่น
              </p>
              <p>
                ข้อกำหนดนี้มีผลบังคับใช้ระหว่างมหาวิทยาลัยกับบุคคลทุกคนที่เข้าใช้งานแพลตฟอร์ม ทั้งผู้ซื้อ ผู้ขาย และผู้เข้าชมทั่วไป การสมัครสมาชิกหรือใช้งานต่อเนื่องถือเป็นการยอมรับข้อกำหนดนี้อย่างสมบูรณ์
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-black">2</span>
              การสมัครสมาชิกและบัญชีผู้ใช้
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <ul className="list-disc pl-5 space-y-1">
                <li>การค้นหาและดูสินค้าสามารถทำได้โดยไม่ต้องสมัครสมาชิก แต่การสั่งซื้อ การติดต่อแชท และการเปิดร้านค้าจำเป็นต้องสมัครสมาชิกและยืนยันอีเมล</li>
                <li>ผู้ใช้งานต้องให้อีเมลจริงและรักษาความปลอดภัยของรหัสผ่านตนเอง</li>
                <li>ผู้ใช้งานต้องมีอายุ 20 ปีบริบูรณ์ขึ้นไป หรือได้รับความยินยอมจากผู้แทนโดยชอบธรรม (ผู้ปกครอง) ก่อนใช้งาน</li>
              </ul>
            </div>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-black">3</span>
              การซื้อขาย การชำระเงิน และการจัดส่ง
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <ul className="list-disc pl-5 space-y-1">
                <li>การสั่งซื้อแต่ละออเดอร์เป็นการตกลงซื้อขายระหว่างผู้ซื้อและร้านค้านั้นๆ โดยตรง</li>
                <li>ร้านค้ามีหน้าที่ประเมินค่าจัดส่ง (Shipping Quote) ภายในเวลาที่กำหนด และผู้ซื้อมีสิทธิ์กดยอมรับหรือปฏิเสธค่าจัดส่งได้</li>
                <li>เมื่อกดยอมรับค่าจัดส่ง ผู้ซื้อต้องชำระเงินและอัปโหลดสลิปหลักฐานการโอนเงินภายในเวลาที่กำหนด มิฉะนั้นออเดอร์จะถูกยกเลิกอัตโนมัติ</li>
                <li>ร้านค้ามีหน้าที่ตรวจสอบสลิปการชำระเงิน จัดส่งสินค้า และอัปโหลดเลขติดตามพัสดุ (Tracking Number) พร้อมสลิปหลักฐานการส่ง</li>
              </ul>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-black">4</span>
              การระงับข้อพิพาทและการคืนเงิน (Dispute & Refund)
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <ul className="list-disc pl-5 space-y-1">
                <li>ผู้ซื้อสามารถเปิดข้อพิพาทได้ภายใน 7 วันหลังกดรับสินค้า หรือภายใน 15 วันหลังร้านค้าส่งสินค้า หากสินค้ามีปัญหา ไม่ตรงปก หรือไม่ได้รับของ</li>
                <li>แอดมินชุมชนจะเป็นผู้ตรวจพิจารณาหลักฐานและตัดสินข้อพิพาท คำตัดสินของแอดมินชุมชนถือเป็นที่สิ้นสุด</li>
                <li>กรณีคำตัดสินให้ผู้ซื้อชนะคดี ร้านค้ามีหน้าที่ดำเนินการโอนเงินคืนตามเลขบัญชีที่ผู้ซื้อระบุ และอัปโหลดสลิปหลักฐานการคืนเงินในระบบให้ครบถ้วน</li>
              </ul>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xs font-black">5</span>
              สินค้าต้องห้ามและการปฏิบัติตามกฎหมาย
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed space-y-2 pl-9">
              <p>ห้ามมิให้จำหน่ายสินค้าผิดกฎหมาย สินค้าละเมิดลิขสิทธิ์ ยาเสพติด อาวุธ สิ่งลามกอนาจาร หรือสินค้าที่ขัดต่อความสงบเรียบร้อยและศีลธรรมอันดี หากพบการฝ่าฝืน ผู้ดูแลระบบมีอำนาจสั่งระงับสินค้า ระงับร้านค้า หรือแบนบัญชีผู้ใช้ทันทีโดยไม่ต้องแจ้งล่วงหน้า</p>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

