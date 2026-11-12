"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { authApi } from "@/lib/api";

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
    } catch {
      // Per I16: show same success message regardless of error or account existence
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D2F0CF] via-[#6DC99C] to-[#42A578] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-gray-100 text-center">
        <div className="flex justify-center mb-6">
          <Image src="/logo.png" alt="VRU Logo" width={64} height={64} className="h-16 w-16 object-contain" />
        </div>

        <h1 className="text-2xl font-black text-gray-800 mb-2">ลืมรหัสผ่าน</h1>

        {submitted ? (
          <div className="py-6 space-y-5 text-left">
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-2xl p-5">
              <div className="flex items-center gap-2 font-bold mb-2 text-green-900">
                <i className="fa-solid fa-paper-plane text-[#16A085]"></i>
                ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว
              </div>
              <p className="text-xs text-green-700 leading-relaxed">
                หากมีบัญชีที่ตรงกับอีเมล <strong>{email}</strong> ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณแล้ว (ลิงก์มีอายุ 1 ชั่วโมง)
              </p>
              <p className="text-xs text-green-600 mt-2">
                * กรุณาตรวจสอบในกล่องข้อความและโฟลเดอร์จดหมายขยะ (Spam)
              </p>
            </div>

            <div className="text-center pt-2">
              <Link
                href="/login"
                className="inline-block w-full py-3.5 px-6 font-bold rounded-full bg-[#16A085] text-white hover:bg-[#138d75] shadow-md transition"
              >
                กลับไปหน้าเข้าสู่ระบบ
              </Link>
            </div>
          </div>
        ) : (
          <div className="py-4 space-y-6 text-left">
            <p className="text-xs text-gray-500 leading-relaxed">
              กรอกอีเมลที่ใช้ลงทะเบียน บัญชีของคุณจะได้รับลิงก์สำหรับตั้งรหัสผ่านใหม่ทางอีเมล
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">อีเมลของคุณ</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 px-4 font-bold rounded-full bg-[#16A085] text-white hover:bg-[#138d75] transition text-sm disabled:opacity-60 flex items-center justify-center gap-2 shadow-md"
              >
                {loading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> กำลังส่งคำขอ...
                  </>
                ) : (
                  "ส่งลิงก์รีเซ็ตรหัสผ่าน"
                )}
              </button>
            </form>

            <div className="text-center pt-2">
              <Link href="/login" className="text-xs text-gray-500 hover:text-gray-800">
                <i className="fa-solid fa-arrow-left mr-1"></i> กลับไปหน้าเข้าสู่ระบบ
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

