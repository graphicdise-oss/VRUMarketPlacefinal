"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import Breadcrumb from "@/components/ui/Breadcrumb";
import ProfileSidebar from "./components/ProfileSidebar";

export default function ProfileClient() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Phone OTP States
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [refCode, setRefCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        showToast("ไฟล์มีขนาดเกิน 1MB");
        return;
      }
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setAvatarUrl(url);
    }
  };

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      router.replace('/super-admin');
      return;
    }
    if (user) {
      setName(user.displayName);
      setEmail(user.email);
      setPhone(""); // Phone not supported in User model currently
    }
  }, [user, router]);

  if (user?.role === 'SUPER_ADMIN') {
    return null;
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      // 1. ตรวจสอบว่ามีการเปลี่ยนรูปหรือไม่ ถ้ามีให้เตรียม FormData อัปโหลด
      if (selectedFile) {
        const formData = new FormData();
        formData.append("avatar", selectedFile);
        
        // [เตรียมรองรับ Backend] ยกเลิกคอมเมนต์ด้านล่างเมื่อเชื่อม API จริง
        // const uploadRes = await api.upload<{ avatarUrl: string }>("/users/me/avatar", formData);
        // console.log("Uploaded new avatar:", uploadRes.avatarUrl);
      }
      
      // 2. บันทึกข้อมูลส่วนตัว (ชื่อ, เบอร์โทร)
      // [เตรียมรองรับ Backend] ยกเลิกคอมเมนต์ด้านล่างเมื่อเชื่อม API จริง
      // await api.patch("/users/me", { displayName: name, phone });

      // จำลองการ Delay สำหรับ UI
      setTimeout(() => {
        setIsSaving(false);
        showToast("บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว");
      }, 800);
    } catch (error) {
      console.error("Save error:", error);
      showToast("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 pt-6 md:pt-8 pb-0">
        <Breadcrumb items={[{ label: "โปรไฟล์" }]} />
      </div>
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 pt-4 pb-8 flex flex-col md:flex-row gap-8">
        
        {/* Sidebar */}
        <ProfileSidebar name={name} avatarUrl={avatarUrl} />

        {/* Content */}
        <div className="flex-grow bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-10">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">ข้อมูลส่วนตัว</h2>
          
          <form onSubmit={handleSave}>
            <div className="flex flex-col md:flex-row gap-8 lg:gap-12 mb-8 items-start">
              
              {/* Left Side: Avatar */}
              <div className="flex-shrink-0 flex flex-col items-center justify-start w-full md:w-1/3 md:pr-8 md:border-r border-gray-100 pt-2">
                <div className="w-28 h-28 bg-gray-50 rounded-full border border-gray-200 overflow-hidden mb-5">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400 text-4xl font-bold">
                      <i className="fa-regular fa-user"></i>
                    </div>
                  )}
                </div>
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium px-4 py-2 rounded text-sm transition shadow-sm mb-4"
                >
                  เลือกรูป
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="image/jpeg, image/png" 
                  className="hidden" 
                />
                <div className="text-center text-gray-400 text-xs space-y-1">
                  <p>ขนาดไฟล์: สูงสุด 1 MB</p>
                  <p>ไฟล์ที่รองรับ: .JPEG, .PNG</p>
                </div>
              </div>

              {/* Right Side: Form */}
              <div className="flex-grow space-y-6 w-full md:w-2/3 md:pl-4">
                
                {/* Username */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right">ชื่อผู้ใช้</label>
                  <div className="flex-grow">
                    <p className="text-sm font-medium text-gray-800">{email.split("@")[0]}</p>
                  </div>
                </div>

                {/* Name */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right">ชื่อ - นามสกุล</label>
                  <div className="flex-grow">
                    <input 
                      type="text" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required 
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-[#16A085] focus:border-[#16A085] text-sm" 
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right">อีเมล</label>
                  <div className="flex-grow">
                    <p className="text-sm font-medium text-gray-500">{email}</p>
                    <p className="text-xs text-gray-400 mt-1">(ไม่สามารถเปลี่ยนอีเมลได้)</p>
                  </div>
                </div>

                {/* Phone */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right sm:pt-2">หมายเลขโทรศัพท์</label>
                  <div className="flex-grow">
                    {!isEditingPhone ? (
                      <div className="flex items-center gap-3 sm:pt-2">
                        <p className="text-sm font-medium text-gray-800">{phone ? `********${phone.slice(-2)}` : "ยังไม่ได้ตั้งค่า"}</p>
                        <button type="button" onClick={() => setIsEditingPhone(true)} className="text-xs text-[#16A085] font-bold underline cursor-pointer hover:text-[#117A65]">การเปลี่ยนแปลง</button>
                      </div>
                    ) : (
                      <div className="space-y-4 bg-gray-50/80 p-5 rounded-2xl border border-gray-100 shadow-sm mt-1">
                        {!otpSent ? (
                          <>
                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5">เบอร์โทรศัพท์ใหม่</label>
                              <input 
                                type="tel" 
                                value={newPhone}
                                onChange={(e) => setNewPhone(e.target.value)}
                                placeholder="08X-XXX-XXXX"
                                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-[#16A085] focus:border-[#16A085] text-sm bg-white" 
                              />
                            </div>
                            <div className="flex gap-3">
                              <button 
                                type="button" 
                                onClick={() => {
                                  if (newPhone.length >= 9) {
                                    setOtpSent(true);
                                    setRefCode(Math.floor(1000 + Math.random() * 9000).toString());
                                    showToast("ระบบได้ส่งรหัส OTP ไปยังเบอร์ของคุณแล้ว");
                                  } else {
                                    showToast("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
                                  }
                                }}
                                className="flex-1 bg-gradient-to-r from-[#16A085] to-[#117A65] hover:shadow-md text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all"
                              >
                                รับรหัส OTP
                              </button>
                              <button 
                                type="button" 
                                onClick={() => setIsEditingPhone(false)}
                                className="flex-1 bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-center mb-2">
                              <p className="text-sm font-bold text-gray-800">ยืนยันรหัส OTP</p>
                              <p className="text-xs text-gray-500 mt-1">รหัสอ้างอิง: REF-{refCode}</p>
                            </div>
                            <div>
                              <input 
                                type="text" 
                                maxLength={6}
                                value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="••••••"
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-[#16A085] focus:border-[#16A085] text-lg font-bold text-center tracking-[0.5em] bg-white" 
                              />
                            </div>
                            <div className="flex gap-3">
                              <button 
                                type="button" 
                                onClick={() => {
                                  if (otpCode.length === 6) {
                                    setPhone(newPhone);
                                    setIsEditingPhone(false);
                                    setOtpSent(false);
                                    setOtpCode("");
                                    showToast("อัปเดตเบอร์โทรศัพท์สำเร็จ");
                                  } else {
                                    showToast("กรุณากรอก OTP ให้ครบ 6 หลัก");
                                  }
                                }}
                                className="flex-1 bg-gradient-to-r from-[#16A085] to-[#117A65] hover:shadow-md text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all"
                              >
                                ยืนยัน
                              </button>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setOtpSent(false);
                                  setOtpCode("");
                                }}
                                className="flex-1 bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm"
                              >
                                เปลี่ยนเบอร์
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Gender */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 pt-2">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right">เพศ</label>
                  <div className="flex-grow flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="gender" value="male" checked={gender === "male"} onChange={(e) => setGender(e.target.value)} className="w-4 h-4 text-[#16A085] focus:ring-[#16A085]" />
                      <span className="text-sm text-gray-700">ชาย</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="gender" value="female" checked={gender === "female"} onChange={(e) => setGender(e.target.value)} className="w-4 h-4 text-[#16A085] focus:ring-[#16A085]" />
                      <span className="text-sm text-gray-700">หญิง</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="gender" value="other" checked={gender === "other"} onChange={(e) => setGender(e.target.value)} className="w-4 h-4 text-[#16A085] focus:ring-[#16A085]" />
                      <span className="text-sm text-gray-700">อื่นๆ</span>
                    </label>
                  </div>
                </div>

                {/* Date of Birth */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                  <label className="sm:w-1/4 text-sm font-bold text-gray-700 text-left sm:text-right">วันเกิด</label>
                  <div className="flex-grow flex items-center gap-3">
                    <select value={birthDay} onChange={(e) => setBirthDay(e.target.value)} className="w-1/3 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-[#16A085] focus:border-[#16A085] text-sm bg-white">
                      <option value="">วัน</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} className="w-1/3 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-[#16A085] focus:border-[#16A085] text-sm bg-white">
                      <option value="">เดือน</option>
                      {["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."].map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                    </select>
                    <select value={birthYear} onChange={(e) => setBirthYear(e.target.value)} className="w-1/3 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-[#16A085] focus:border-[#16A085] text-sm bg-white">
                      <option value="">ปี</option>
                      {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y + 543}</option>)}
                    </select>
                  </div>
                </div>
                
                <div className="pt-6 flex justify-center sm:justify-start sm:pl-[calc(25%+1.5rem)]">
                  <button 
                    type="submit" 
                    disabled={isSaving}
                    className="bg-[#16A085] hover:bg-[#117A65] text-white font-bold py-2.5 px-8 rounded shadow-sm transition disabled:opacity-70 flex items-center gap-2"
                  >
                    {isSaving ? (
                      <><i className="fa-solid fa-circle-notch fa-spin"></i> กำลังบันทึก...</>
                    ) : "บันทึก"}
                  </button>
                </div>

              </div>

            </div>
          </form>

          {/* ปุ่มออกจากระบบสำหรับหน้าจอมือถือ (เห็นชัดเจนทันทีในหน้าโปรไฟล์ ไม่ต้องเปิดเมนูย่อย) */}
          <div className="mt-6 md:hidden">
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("คุณต้องการออกจากระบบหรือไม่?")) {
                  await logout();
                  router.push("/login");
                }
              }}
              className="w-full py-3.5 px-4 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 border border-red-200 shadow-xs transition cursor-pointer"
            >
              <i className="fa-solid fa-right-from-bracket text-base"></i>
              <span>ออกจากระบบ</span>
            </button>
          </div>

        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
