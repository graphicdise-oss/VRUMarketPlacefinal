"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { authApi } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error" | "idle">(
    token ? "loading" : "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const verifyToken = useCallback(async (t: string) => {
    setStatus("loading");
    setErrorMessage("");
    try {
      await authApi.verifyEmail(t);
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage("ลิงก์ยืนยันตัวตนนี้ไม่ถูกต้อง หมดอายุ หรือถูกใช้งานไปแล้ว");
    }
  }, []);

  useEffect(() => {
    if (token) {
      verifyToken(token);
    }
  }, [token, verifyToken]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;
    setIsResending(true);
    setResendSuccess(false);
    try {
      await authApi.resendVerification(resendEmail);
      setResendSuccess(true);
    } catch {
      // Per I16: show success message anyway so account existence is not leaked
      setResendSuccess(true);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 border border-gray-100 text-center">
      <div className="flex justify-center mb-6">
        <Image src="/logo.png" alt="VRU Logo" width={64} height={64} className="h-16 w-16 object-contain" />
      </div>

      <h1 className="text-2xl font-black text-gray-800 mb-2">ยืนยันอีเมล</h1>

      {status === "loading" && (
        <div className="py-8 space-y-4">
          <i className="fa-solid fa-spinner fa-spin text-4xl text-[#16A085]"></i>
          <p className="text-gray-600 text-sm">กำลังตรวจสอบลิงก์ยืนยันตัวตน...</p>
        </div>
      )}

      {status === "success" && (
        <div className="py-6 space-y-5">
          <div className="w-16 h-16 bg-green-100 text-[#16A085] rounded-full flex items-center justify-center mx-auto text-3xl">
            <i className="fa-solid fa-circle-check"></i>
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">ยืนยันอีเมลสำเร็จแล้ว!</h2>
            <p className="text-sm text-gray-500 mt-1">บัญชีของคุณพร้อมใช้งานแล้ว สามารถเข้าสู่ระบบได้ทันที</p>
          </div>
          <Link
            href="/login"
            className="inline-block w-full py-3.5 px-6 font-bold rounded-full bg-[#16A085] text-white hover:bg-[#138d75] shadow-md transition"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
      )}

      {(status === "error" || status === "idle") && (
        <div className="py-4 space-y-6 text-left">
          {status === "error" && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl p-4 flex items-start gap-3">
              <i className="fa-solid fa-circle-exclamation mt-0.5 text-base flex-shrink-0"></i>
              <div>
                <p className="font-bold">เกิดข้อผิดพลาด</p>
                <p className="text-xs mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {resendSuccess ? (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-4">
              <div className="flex items-center gap-2 font-bold mb-1">
                <i className="fa-solid fa-envelope-circle-check"></i>
                ส่งลิงก์ยืนยันตัวตนเรียบร้อย
              </div>
              <p className="text-xs text-green-700 leading-relaxed">
                หากมีบัญชีที่ตรงกับอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์ยืนยันใหม่ไปที่กล่องข้อความของคุณแล้ว กรุณาตรวจสอบอีเมล (รวมถึงโฟลเดอร์สแปม)
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                {status === "error"
                  ? "คุณสามารถกรอกอีเมลด้านล่างเพื่อขอรับลิงก์ยืนยันตัวตนใหม่ได้:"
                  : "กรอกอีเมลของคุณเพื่อขอรับลิงก์ยืนยันตัวตนใหม่:"}
              </p>
              <form onSubmit={handleResend} className="space-y-4">
                <input
                  type="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="กรอกอีเมลของคุณ"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#16A085]"
                />
                <button
                  type="submit"
                  disabled={isResending}
                  className="w-full py-3 px-4 font-bold rounded-xl bg-[#16A085] text-white hover:bg-[#138d75] transition text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isResending ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i> กำลังส่ง...
                    </>
                  ) : (
                    "ขอรับลิงก์ยืนยันใหม่"
                  )}
                </button>
              </form>
            </div>
          )}

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

export default function VerifyEmailClient() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D2F0CF] via-[#6DC99C] to-[#42A578] flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-white text-center"><i className="fa-solid fa-spinner fa-spin text-3xl"></i></div>}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}

