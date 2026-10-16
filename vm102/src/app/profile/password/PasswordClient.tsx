"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import MobileNav from "@/components/layout/MobileNav";
import Breadcrumb from "@/components/ui/Breadcrumb";
import ProfileSidebar from "@/app/profile/components/ProfileSidebar";
import { useAuth } from "@/lib/auth-context";

export default function PasswordClient() {
  const { user } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Custom toast notification logic
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'SUPER_ADMIN') {
      router.replace('/super-admin');
    }
  }, [user, router]);

  if (user?.role === 'SUPER_ADMIN') {
    return null;
  }

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast("รหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }
    
    setIsSaving(true);
    // Simulate API call
    setTimeout(() => {
      setIsSaving(false);
      showToast("เปลี่ยนรหัสผ่านสำเร็จ (จำลอง)");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      <Header />
      
      {toastMessage && (
        <div className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3">
            <i className="fa-solid fa-circle-check text-[#16A085]"></i>
            <span className="font-medium text-sm">{toastMessage}</span>
          </div>
        </div>
      )}

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 pt-4 pb-8 flex flex-col md:flex-row gap-8">
        
        {/* Sidebar */}
        <ProfileSidebar name={user?.displayName || ""} avatarUrl={user?.avatarUrl || null} />

        {/* Content */}
        <div className="flex-grow min-w-0">
          <Breadcrumb items={[
            { label: "โปรไฟล์", href: "/profile" },
            { label: "เปลี่ยนรหัสผ่าน" }
          ]} />
          
          <div className="bg-white rounded-3xl p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100 mt-6">
            <div className="mb-8 border-b border-gray-100 pb-6">
              <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                <div className="w-10 h-10 bg-[#16A085] rounded-xl flex items-center justify-center text-white shadow-sm">
                  <i className="fa-solid fa-lock text-lg"></i>
                </div>
                เปลี่ยนรหัสผ่าน
              </h2>
              <p className="text-gray-500 mt-2 ml-14">เพื่อความปลอดภัยของบัญชี กรุณาอย่าเปิดเผยรหัสผ่านแก่ผู้อื่น</p>
            </div>

            <form onSubmit={handleSubmit} className="max-w-xl mx-auto pt-4 pb-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">รหัสผ่านปัจจุบัน</label>
                  <input 
                    type="password" 
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••" 
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-[#16A085] focus:border-[#16A085] text-sm" 
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">รหัสผ่านใหม่</label>
                  <input 
                    type="password" 
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••" 
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-[#16A085] focus:border-[#16A085] text-sm" 
                  />
                  <p className="text-xs text-gray-400 mt-2">รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร</p>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">ยืนยันรหัสผ่านใหม่</label>
                  <input 
                    type="password" 
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••" 
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-[#16A085] focus:border-[#16A085] text-sm" 
                  />
                </div>
              </div>

              <div className="mt-10 flex justify-end">
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="bg-gradient-to-r from-[#16A085] to-[#117A65] hover:shadow-lg text-white font-bold py-3 px-10 rounded-xl shadow-md transition disabled:opacity-70 flex items-center gap-2"
                >
                  {isSaving ? (
                    <><i className="fa-solid fa-circle-notch fa-spin"></i> กำลังบันทึก...</>
                  ) : "ยืนยันการเปลี่ยนแปลง"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
