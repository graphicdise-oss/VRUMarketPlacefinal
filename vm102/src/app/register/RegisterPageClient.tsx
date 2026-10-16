"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { authApi, legalApi, ApiRequestError } from "@/lib/api";
import { useEffect } from "react";

export default function RegisterPageClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [privacyVersion, setPrivacyVersion] = useState("");
  const [termsVersion, setTermsVersion] = useState("");

  useEffect(() => {
    // โหลดเวอร์ชันนโยบายและข้อตกลง (บังคับตาม FRONTEND-NOTES.md)
    legalApi.getPrivacyPolicy().then((res) => setPrivacyVersion(res.version)).catch(console.error);
    legalApi.getTermsOfService().then((res) => setTermsVersion(res.version)).catch(console.error);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    if (password.length < 8) {
      setError("รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร");
      return;
    }

    if (!privacyVersion || !termsVersion) {
      setError("ไม่สามารถโหลดข้อตกลงและนโยบายได้ กรุณารีเฟรชหน้าเว็บ");
      return;
    }

    setLoading(true);
    try {
      await authApi.register({
        email,
        password,
        acceptedPrivacyPolicyVersion: privacyVersion,
        acceptedTermsOfServiceVersion: termsVersion,
        confirmedAgeOrGuardianConsent: true,
      });
      setSubmitted(true);
    } catch (err: unknown) {
      let errMessage = "เกิดข้อผิดพลาดในการลงทะเบียน";
      if (err instanceof ApiRequestError) {
        // บางที Class Validator คืนค่า message เป็น array ของ string
        errMessage = Array.isArray(err.message) ? err.message.join(", ") : err.message || err.error;
      } else if (err instanceof Error) {
        errMessage = err.message;
      }
      setError(errMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D2F0CF] via-[#6DC99C] to-[#42A578] flex items-center justify-center p-4 sm:p-8 relative overflow-hidden z-0">
      {/* Angled Dark Green Background */}
      <div
        className="absolute bottom-0 left-0 w-full h-[60%] bg-gradient-to-r from-[#296043] to-[#519B70] -z-10"
        style={{ clipPath: "polygon(0 40%, 100% 90%, 100% 100%, 0 100%)" }}
      ></div>
      {/* Shadow line to emphasize the split */}
      <div
        className="absolute bottom-0 left-0 w-full h-[60%] bg-black/10 -z-20 blur-sm"
        style={{ clipPath: "polygon(0 38%, 100% 88%, 100% 100%, 0 100%)" }}
      ></div>

      <div className="max-w-5xl w-full relative z-10 min-h-[600px] flex flex-col md:flex-row">
        
        {/* Card Background Layer (with border and rounded corners) */}
        <div className="absolute inset-0 flex rounded-[3rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border-[8px] border-white/90 overflow-hidden z-0 pointer-events-none">
          {/* Left Side Background (Transparent as requested) */}
          <div className="hidden md:block w-1/2 bg-transparent"></div>
          {/* Right Side Background (White) */}
          <div className="w-full md:w-1/2 bg-white h-full"></div>
        </div>

        {/* Content Layer */}
        
        {/* Left Side - Visual/Illustration (Popping out left, flush bottom) */}
        <div className="hidden md:block w-1/2 relative z-20">
          <Image
            src="/images/Icon01.png"
            alt="Register Illustration"
            width={600}
            height={600}
            className="absolute bottom-[-6px] left-[8%] w-[100%] max-w-none h-auto drop-shadow-[0_15px_25px_rgba(0,0,0,0.3)] object-contain object-bottom z-[100] pointer-events-none"
            priority
          />
        </div>

        {/* Right Side - Form */}
        <div className="w-full md:w-1/2 p-8 sm:p-12 md:p-16 flex flex-col justify-center relative z-20">
          
          <div className="flex justify-center mb-8">
            <Link href="/" className="flex items-center gap-3 group">
              <Image src="/logo.png" alt="VRU Marketplace Logo" width={56} height={56} className="w-14 h-14 object-contain group-hover:scale-105 transition-transform duration-300" />
              <div className="flex flex-col leading-none items-center">
                <div className="text-2xl font-bold tracking-tight text-[#16A085]">
                  VRU <span className="text-gray-800">Marketplace</span>
                </div>
                <div className="text-[10px] font-black tracking-[0.2em] uppercase mt-1 bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent relative">
                  Thai Trade
                </div>
              </div>
            </Link>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-[#D4F1BB] rounded-full flex items-center justify-center text-[#16A085] text-4xl mx-auto mb-6 shadow-inner">
                <i className="fa-regular fa-envelope"></i>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">ลงทะเบียนสำเร็จ!</h2>
              <p className="text-gray-600 mb-6 text-sm">เราได้ส่งลิงก์ยืนยันตัวตนไปที่อีเมลของคุณแล้ว กรุณาตรวจสอบอีเมลและคลิกลิงก์เพื่อเปิดใช้งานบัญชี</p>
              <Link href="/login" className="inline-block font-medium py-3 px-8 rounded-full bg-[#A5E3A9] text-gray-800 hover:bg-[#8DD693] shadow-[0_4px_15px_rgba(165,227,169,0.4)] hover:shadow-[0_6px_20px_rgba(165,227,169,0.6)] transform hover:-translate-y-0.5 transition-all duration-300">
                กลับไปหน้าเข้าสู่ระบบ
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h2 className="text-[2.5rem] leading-tight font-medium text-gray-800 mb-1">สร้างบัญชีผู้ใช้</h2>
                <p className="text-sm text-gray-500 font-medium">เข้าร่วมแพลตฟอร์มสินค้าชุมชนของเรา</p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50/80 rounded-2xl text-sm text-red-600 flex items-center gap-3 backdrop-blur-sm">
                  <i className="fa-solid fa-circle-exclamation"></i> {error}
                </div>
              )}

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <input 
                    type="email" 
                    required 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    className="w-full px-6 py-4 rounded-full bg-[#E3EDE8] border-none shadow-[inset_0_3px_6px_rgba(0,0,0,0.06),0_2px_0_rgba(255,255,255,0.8)] text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-[#A5E3A9] focus:outline-none transition-all" 
                    placeholder="อีเมล" 
                  />
                </div>
                <div>
                  <input 
                    type="password" 
                    required 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    className="w-full px-6 py-4 rounded-full bg-[#E3EDE8] border-none shadow-[inset_0_3px_6px_rgba(0,0,0,0.06),0_2px_0_rgba(255,255,255,0.8)] text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-[#A5E3A9] focus:outline-none transition-all" 
                    placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" 
                  />
                </div>
                <div>
                  <input 
                    type="password" 
                    required 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    className="w-full px-6 py-4 rounded-full bg-[#E3EDE8] border-none shadow-[inset_0_3px_6px_rgba(0,0,0,0.06),0_2px_0_rgba(255,255,255,0.8)] text-sm text-gray-700 placeholder-gray-400 focus:ring-2 focus:ring-[#A5E3A9] focus:outline-none transition-all" 
                    placeholder="ยืนยันรหัสผ่าน" 
                  />
                </div>

                <div className="flex items-start px-2 py-2">
                  <input type="checkbox" required className="h-4 w-4 mt-0.5 text-[#16A085] focus:ring-[#16A085] border-gray-300 rounded" />
                  <label className="ml-2 text-xs text-gray-500 leading-tight">
                    ฉันมีอายุ 20 ปีขึ้นไป หรือผู้ปกครองรับทราบและยินยอมแล้ว<br/>
                    และฉันยอมรับ <a href="#" className="font-bold text-[#16A085] hover:underline">ข้อกำหนดการใช้งาน</a> และ <a href="#" className="font-bold text-[#16A085] hover:underline">นโยบายความเป็นส่วนตัว</a>
                  </label>
                </div>

                <div className="pt-6">
                  <button 
                    type="submit" 
                    disabled={loading} 
                    className="w-full flex justify-center items-center gap-2 py-4 px-4 font-medium rounded-full bg-[#A5E3A9] text-gray-800 hover:bg-[#8DD693] shadow-[0_4px_15px_rgba(165,227,169,0.4)] hover:shadow-[0_6px_20px_rgba(165,227,169,0.6)] transform hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {loading ? <><i className="fa-solid fa-spinner fa-spin mr-2"></i> กำลังสร้างบัญชี...</> : "สร้างบัญชี"}
                  </button>
                </div>
              </form>



              <div className="mt-8 text-center text-sm text-gray-500">
                มีบัญชีอยู่แล้วใช่ไหม?{" "}
                <Link href="/login" className="font-bold text-[#16A085] hover:underline">
                  เข้าสู่ระบบ
                </Link>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}