"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authApi } from "@/lib/api";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("ไม่พบโทเคนสำหรับการรีเซ็ตรหัสผ่าน กรุณาใช้ลิงก์ที่ได้รับจากอีเมล");
      return;
    }

    if (password.length < 8) {
      setError("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร");
      return;
    }

    if (password !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword({ token, password });
      setSuccess(true);
    } catch {
      setError("ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หมดอายุ หรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-gray-100 text-center">
      <div className="flex justify-center mb-6">
        <Image src="/logo.png" alt="VRU Logo" width={64} height={64} className="h-16 w-16 object-contain" />
      </div>

      <h1 className="text-2xl font-black text-gray-800 mb-2">ตั้งรหัสผ่านใหม่</h1>

      {success ? (
        <div className="py-6 space-y-5 text-left">
          <div className="w-16 h-16 bg-green-100 text-[#16A085] rounded-full flex items-center justify-center mx-auto text-3xl">
            <i className="fa-solid fa-circle-check"></i>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-gray-900">เปลี่ยนรหัสผ่านเรียบร้อยแล้ว!</h2>
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              ทุกเซสชันเดิมถูกออกจากระบบเรียบร้อยแล้วเพื่อความปลอดภัย กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่
            </p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full py-3.5 px-6 font-bold rounded-full bg-[#16A085] text-white hover:bg-[#138d75] shadow-md transition text-center"
          >
            ไปที่หน้าเข้าสู่ระบบ
          </Link>
        </div>
      ) : (
        <div className="py-4 space-y-6 text-left">
          {!token && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-4">
              <i className="fa-solid fa-triangle-exclamation mr-1.5 text-amber-600"></i>
              ไม่พบโทเคนใน URL กรุณากดลิงก์ที่ส่งไปทางอีเมล
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl p-4 flex items-start gap-2">
              <i className="fa-solid fa-circle-exclamation mt-0.5 flex-shrink-0"></i>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="กรอกรหัสผ่านใหม่"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">ยืนยันรหัสผ่านใหม่</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085]"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-3.5 px-4 font-bold rounded-full bg-[#16A085] text-white hover:bg-[#138d75] transition text-sm disabled:opacity-60 flex items-center justify-center gap-2 shadow-md"
            >
              {loading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...
                </>
              ) : (
                "บันทึกรหัสผ่านใหม่"
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
  );
}

export default function ResetPasswordClient() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D2F0CF] via-[#6DC99C] to-[#42A578] flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-white text-center"><i className="fa-solid fa-spinner fa-spin text-3xl"></i></div>}>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}

