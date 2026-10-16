"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { shopApi, shopPaymentApi, paymentChannelApi, communityApi, CommunityDto, MyShopDto } from "@/lib/api";
import dynamic from "next/dynamic";
import { getErrorMessage } from "@/lib/utils";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] w-full bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400">
      กำลังโหลดแผนที่...
    </div>
  ),
});

export default function RegisterShopClient() {
  const { user } = useAuth();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [existingShop, setExistingShop] = useState<MyShopDto | null>(null);
  const [isCheckingShop, setIsCheckingShop] = useState(true);

  const [communities, setCommunities] = useState<CommunityDto[]>([]);

  // Files
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [formData, setFormData] = useState({
    shopName: "",
    phone: "",
    description: "",
    communityId: "",
    locationText: "",
    paymentBank: "",
    paymentAccount: "",
    paymentName: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  const [agreeTerms, setAgreeTerms] = useState(false);

  useEffect(() => {
    communityApi.list().then((res) => setCommunities(res.items)).catch(console.error);

    if (user) {
      shopApi.getMine()
        .then((shop) => {
          setExistingShop(shop);
        })
        .catch(() => {
          setExistingShop(null);
        })
        .finally(() => {
          setIsCheckingShop(false);
        });
    } else {
      setIsCheckingShop(false);
    }
  }, [user]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        alert("กรุณาเลือกไฟล์ภาพนามสกุล JPEG หรือ PNG เท่านั้น");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        alert("กรุณาเลือกไฟล์ภาพนามสกุล JPEG, PNG หรือ WEBP เท่านั้น");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
        return;
      }
      setBannerFile(file);
      setBannerPreview(URL.createObjectURL(file));
    }
  };

  const handleQrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        alert("กรุณาเลือกไฟล์ภาพนามสกุล JPEG หรือ PNG เท่านั้น");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
        return;
      }
      setQrFile(file);
      setQrPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert("กรุณาเข้าสู่ระบบก่อนทำรายการ");
      return;
    }

    if (!agreeTerms) {
      alert("กรุณาทำเครื่องหมายยินยอมปฏิบัติตามกฎระเบียบของตลาดชุมชนก่อนส่งคำขอ");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Create the shop
      await shopApi.apply({
        communityId: formData.communityId,
        name: formData.shopName.trim(),
      });

      // 2. Format description with contact phone, physical address, and map link
      const descParts: string[] = [];
      if (formData.description.trim()) {
        descParts.push(formData.description.trim());
      }
      if (formData.phone.trim()) {
        descParts.push(`📞 เบอร์โทรติดต่อ: ${formData.phone.trim()}`);
      }
      if (formData.locationText.trim()) {
        descParts.push(`📍 ที่ตั้งในชุมชน: ${formData.locationText.trim()}`);
      }
      if (formData.latitude && formData.longitude) {
        descParts.push(`🗺️ พิกัดแผนที่: https://maps.google.com/?q=${formData.latitude},${formData.longitude}`);
      }

      const formattedDescription = descParts.join("\n\n");
      if (formattedDescription) {
        await shopApi.updateProfile({
          name: formData.shopName.trim(),
          description: formattedDescription,
        });
      }

      // 3. Upload shop logo if provided
      if (logoFile) {
        try {
          await shopApi.uploadLogo(logoFile);
        } catch (logoErr) {
          console.warn("Could not upload shop logo immediately:", logoErr);
        }
      }

      // 3.1 Upload shop banner if provided
      if (bannerFile) {
        try {
          await shopApi.uploadBanner(bannerFile);
        } catch (bannerErr) {
          console.warn("Could not upload shop banner immediately:", bannerErr);
        }
      }

      // 4. Create payment channel & upload QR code if provided
      if (formData.paymentBank && formData.paymentAccount) {
        let channel;
        if (formData.paymentBank === "other") {
          channel = await shopPaymentApi.create({
            type: "PROMPTPAY",
            promptPayId: formData.paymentAccount.trim(),
          });
        } else {
          channel = await shopPaymentApi.create({
            type: "BANK_TRANSFER",
            bankName: formData.paymentBank,
            bankAccountNumber: formData.paymentAccount.trim(),
            bankAccountName: formData.paymentName.trim(),
          });
        }

        // Upload QR Image if attached
        if (channel && channel.id && qrFile) {
          try {
            await paymentChannelApi.uploadQr(channel.id, qrFile);
          } catch (qrErr) {
            console.warn("Could not upload payment QR image:", qrErr);
          }
        }
      }

      setIsSubmitting(false);
      setSuccess(true);
    } catch (error) {
      console.error("Failed to register shop:", error);
      setIsSubmitting(false);
      alert(getErrorMessage(error, "เกิดข้อผิดพลาดในการส่งคำขอเปิดร้านค้า"));
    }
  };

  if (isCheckingShop) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center text-gray-400 flex flex-col items-center gap-3">
          <i className="fa-solid fa-spinner fa-spin text-3xl text-[#16A085]"></i>
          <p className="text-sm font-medium">กำลังตรวจสอบข้อมูลร้านค้า...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#D4F1BB]/50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-[#16A085] text-2xl">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">ต้องเข้าสู่ระบบก่อน</h2>
          <p className="text-gray-500 mb-6">คุณต้องเข้าสู่ระบบสมาชิกเพื่อลงทะเบียนเปิดร้านค้าในระบบ</p>
          <Link href="/login" className="btn-minimal block w-full py-3.5 rounded-full font-bold shadow-md">
            เข้าสู่ระบบ / สมัครสมาชิก
          </Link>
        </div>
      </div>
    );
  }

  if (existingShop && existingShop.approvalStatus === "APPROVED") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner text-4xl">
            <i className="fa-solid fa-store"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">คุณมีร้านค้าเปิดอยู่แล้ว</h2>
          <p className="text-gray-600 mb-6 leading-relaxed text-sm">
            ร้านค้า <span className="font-bold text-[#16A085]">&ldquo;{existingShop.name}&rdquo;</span> ของคุณได้รับการอนุมัติและเปิดให้บริการอยู่แล้ว
          </p>
          <button
            onClick={() => router.push("/seller")}
            className="btn-minimal block w-full py-3.5 rounded-full font-bold shadow-md"
          >
            ไปที่แผงควบคุมร้านค้า (Seller Portal)
          </button>
        </div>
      </div>
    );
  }

  if (existingShop && existingShop.approvalStatus === "PENDING") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner text-4xl">
            <i className="fa-solid fa-clock"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">คำขอเปิดร้านอยู่ระหว่างการตรวจสอบ</h2>
          <p className="text-gray-600 mb-6 leading-relaxed text-sm">
            คุณได้ยื่นคำขอเปิดร้านค้า <span className="font-bold text-gray-800">&ldquo;{existingShop.name}&rdquo;</span> เรียบร้อยแล้ว ขณะนี้แอดมินชุมชนกำลังพิจารณาอนุมัติ
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-left text-xs text-amber-800">
            <p className="font-bold mb-1"><i className="fa-solid fa-circle-info mr-1"></i> เตรียมความพร้อม:</p>
            <p>คุณสามารถเข้าสู่ Seller Portal เพื่อเตรียมลงรายการสินค้าไว้ล่วงหน้าได้ สินค้าจะเปิดขายทันทีที่ร้านได้รับอนุมัติ</p>
          </div>
          <button
            onClick={() => router.push("/seller")}
            className="btn-minimal block w-full py-3.5 rounded-full font-bold shadow-md"
          >
            ไปที่แผงควบคุมร้านค้า (Seller Portal)
          </button>
        </div>
      </div>
    );
  }

  if (existingShop && existingShop.approvalStatus === "REJECTED") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner text-4xl">
            <i className="fa-solid fa-triangle-exclamation"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">คำขอเปิดร้านไม่ผ่านการอนุมัติ</h2>
          <p className="text-gray-600 mb-4 leading-relaxed text-sm">
            คำขอเปิดร้าน <span className="font-bold text-gray-800">&ldquo;{existingShop.name}&rdquo;</span> ไม่ผ่านการพิจารณา
          </p>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 text-left text-xs text-red-800">
            <p className="font-bold mb-1">เหตุผลจากแอดมินชุมชน:</p>
            <p>{existingShop.rejectionReason || "ข้อมูลไม่ครบถ้วนหรือไม่เป็นไปตามระเบียบชุมชน"}</p>
          </div>
          <button
            onClick={() => {
              setFormData((prev) => ({ ...prev, shopName: existingShop.name }));
              setExistingShop(null);
            }}
            className="btn-minimal block w-full py-3.5 rounded-full font-bold shadow-md"
          >
            <i className="fa-solid fa-pen-to-square mr-2"></i> แก้ไขข้อมูลและยื่นคำขอใหม่
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 sm:p-10 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-[#D4F1BB]/60 text-[#16A085] rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner text-4xl">
            <i className="fa-solid fa-check"></i>
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2">ส่งคำขอเปิดร้านสำเร็จ!</h2>
          <p className="text-gray-600 mb-6 leading-relaxed text-sm">
            ระบบได้รับข้อมูลร้านค้า โลโก้ และช่องทางการรับเงินของคุณแล้ว
            <br />
            เรื่องถูกส่งต่อไปยัง <span className="font-bold text-[#16A085]">แอดมินชุมชน</span> เพื่อพิจารณาอนุมัติ
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-left text-xs text-amber-800">
            <div className="flex items-start gap-2.5">
              <i className="fa-solid fa-circle-info text-amber-600 mt-0.5"></i>
              <div>
                <p className="font-bold mb-1">ขั้นตอนต่อไป:</p>
                <p>แอดมินชุมชนจะตรวจสอบข้อมูลร้าน เมื่อได้รับอนุมัติคุณจะสามารถลงขายสินค้าและรับออเดอร์ได้ทันที</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => router.push("/seller")}
            className="btn-minimal block w-full py-3.5 rounded-full font-bold shadow-md"
          >
            ไปที่แผงควบคุมร้านค้า (Seller Portal)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12">
      <div className="max-w-3xl mx-auto px-4">
        {/* Header Breadcrumb */}
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-500 hover:text-[#16A085] font-bold text-sm transition group">
            <i className="fa-solid fa-arrow-left transition-transform group-hover:-translate-x-1"></i> กลับหน้าหลัก
          </Link>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-black text-gray-800 tracking-tight">ลงทะเบียนเปิดร้านค้า</h1>
              <p className="text-gray-500 text-sm mt-1">
                กรอกข้อมูลร้านค้าของคุณเพื่อส่งเรื่องให้แอดมินชุมชนพิจารณาอนุมัติตามมาตรฐาน
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#D4F1BB]/60 text-[#16A085] rounded-full text-xs font-bold">
              <i className="fa-solid fa-shield-halved"></i> ตรวจสอบโดยชุมชน
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-10 space-y-8">

          {/* Section 1: ข้อมูลร้านค้าทั่วไป */}
          <div className="border-b border-gray-100 pb-8">
            <h3 className="text-lg font-black text-gray-800 mb-1 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-[#D4F1BB]/60 text-[#16A085] flex items-center justify-center text-sm font-bold">1</span>
              ข้อมูลร้านค้าทั่วไป
            </h3>
            <p className="text-xs text-gray-400 mb-6 ml-10">ข้อมูลพื้นฐานที่จะแสดงบนหน้าร้านค้าของคุณ</p>

            <div className="space-y-6">

              {/* Cover Banner Image Upload */}
              <div className="bg-gray-50/70 p-5 rounded-2xl border border-gray-100 flex flex-col sm:flex-row items-center gap-5">
                <input
                  type="file"
                  ref={bannerInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleBannerChange}
                />
                
                <div 
                  onClick={() => bannerInputRef.current?.click()}
                  className="relative w-full sm:w-44 h-24 rounded-2xl border-2 border-dashed border-gray-300 hover:border-[#16A085] bg-white flex flex-col items-center justify-center cursor-pointer overflow-hidden group shadow-sm transition flex-shrink-0"
                >
                  {bannerPreview ? (
                    <>
                      <img src={bannerPreview} alt="Shop banner" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                        เปลี่ยนภาพหน้าปก
                      </div>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-panorama text-gray-400 text-2xl group-hover:text-[#16A085] transition mb-1"></i>
                      <span className="text-[10px] font-bold text-gray-400 group-hover:text-[#16A085]">เพิ่มภาพหน้าปก</span>
                    </>
                  )}
                </div>

                <div className="text-center sm:text-left flex-grow">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2 justify-center sm:justify-start">
                    ภาพหน้าปก / แบนเนอร์ร้านค้า (Cover Banner)
                    <span className="text-[10px] text-[#16A085] bg-[#D4F1BB]/50 px-2 py-0.5 rounded-full font-bold">แนะนำ</span>
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    แสดงที่ส่วนหัวของหน้าร้านค้าของคุณ แนะนำอัตราส่วนแนวนอน ~1200x400 px (ไฟล์ JPG, PNG หรือ WEBP ไม่เกิน 5 MB)
                  </p>
                  {bannerPreview && (
                    <button
                      type="button"
                      onClick={() => { setBannerFile(null); setBannerPreview(null); }}
                      className="mt-2 text-xs text-red-500 hover:text-red-700 font-bold inline-flex items-center gap-1"
                    >
                      <i className="fa-solid fa-trash-can"></i> ลบภาพหน้าปก
                    </button>
                  )}
                </div>
              </div>

              {/* Logo / Profile Image Upload */}
              <div className="bg-gray-50/70 p-5 rounded-2xl border border-gray-100 flex flex-col sm:flex-row items-center gap-5">
                <input
                  type="file"
                  ref={logoInputRef}
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                
                <div 
                  onClick={() => logoInputRef.current?.click()}
                  className="relative w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 hover:border-[#16A085] bg-white flex flex-col items-center justify-center cursor-pointer overflow-hidden group shadow-sm transition"
                >
                  {logoPreview ? (
                    <>
                      <img src={logoPreview} alt="Shop logo" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                        เปลี่ยนรูป
                      </div>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-camera text-gray-400 text-2xl group-hover:text-[#16A085] transition mb-1"></i>
                      <span className="text-[10px] font-bold text-gray-400 group-hover:text-[#16A085]">เพิ่มรูปโลโก้</span>
                    </>
                  )}
                </div>

                <div className="text-center sm:text-left flex-grow">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2 justify-center sm:justify-start">
                    รูปโลโก้ร้านค้า / ป้ายร้าน
                    <span className="text-[10px] text-[#16A085] bg-[#D4F1BB]/50 px-2 py-0.5 rounded-full font-bold">แนะนำ</span>
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    อัปโหลดรูปภาพหน้าร้านหรือโลโก้สินค้า เพื่อให้ร้านของคุณดูน่าเชื่อถือ (ไฟล์ JPG หรือ PNG ขนาดไม่เกิน 5 MB)
                  </p>
                  {logoPreview && (
                    <button
                      type="button"
                      onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                      className="mt-2 text-xs text-red-500 hover:text-red-700 font-bold inline-flex items-center gap-1"
                    >
                      <i className="fa-solid fa-trash-can"></i> ลบรูปภาพ
                    </button>
                  )}
                </div>
              </div>

              {/* Shop Name */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  ชื่อร้านค้า <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={formData.shopName}
                  onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                  placeholder="ตัวอย่าง: ร้านกล้วยตากพลังงานแสงอาทิตย์คุณยาย"
                />
              </div>

              {/* Contact Phone Number */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  เบอร์โทรศัพท์ติดต่อร้านค้า <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 text-sm">
                    <i className="fa-solid fa-phone"></i>
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={20}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                    placeholder="เช่น 081-234-5678"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">ใช้สำหรับการติดต่อฉุกเฉินและแสดงบนหน้าร้านค้าเพื่อให้ผู้ซื้อติดต่อสอบถามได้</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">รายละเอียดร้านค้า</label>
                <textarea
                  rows={3}
                  maxLength={400}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition resize-none text-sm"
                  placeholder="อธิบายสั้นๆ ว่าร้านของคุณขายสินค้าประเภทใด มีจุดเด่นหรือเรื่องราวอย่างไร"
                />
              </div>

              {/* Community */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  ชุมชนที่สังกัด <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={formData.communityId}
                  onChange={(e) => setFormData({ ...formData, communityId: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                >
                  <option value="" disabled>-- เลือกชุมชนของคุณ --</option>
                  {communities.map((com) => (
                    <option key={com.id} value={com.id}>{com.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  <i className="fa-solid fa-circle-info mr-1 text-[#16A085]"></i> 1 บัญชีผู้ใช้สามารถเปิดร้านค้าได้ 1 ร้านใน 1 ชุมชนเท่านั้น
                </p>
              </div>

              {/* Physical Address in Community */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  ที่ตั้งหน้าร้าน / จุดสังเกตในชุมชน
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 text-sm">
                    <i className="fa-solid fa-location-dot"></i>
                  </span>
                  <input
                    type="text"
                    maxLength={150}
                    value={formData.locationText}
                    onChange={(e) => setFormData({ ...formData, locationText: e.target.value })}
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                    placeholder="เช่น บ้านเลขที่ 12/3 ม.2 ซอย 4 ตรงข้ามศาลาประชาคม"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">ช่วยให้แอดมินชุมชนตรวจสอบร้านค้าได้ง่าย และลูกค้าสามารถแวะไปซื้อหน้าร้านได้</p>
              </div>

              {/* Map Location */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  ปักหมุดพิกัดบนแผนที่ (ถ้ามี)
                </label>
                <p className="text-xs text-gray-500 mb-2.5">
                  คลิกบนแผนที่เพื่อปักหมุดตำแหน่งร้านค้าของคุณ จะช่วยสร้างลิงก์พิกัดนำทางบน Google Maps ให้ผู้ซื้อ
                </p>
                <MapPicker
                  latitude={formData.latitude}
                  longitude={formData.longitude}
                  onChange={(lat, lng) => setFormData({ ...formData, latitude: lat, longitude: lng })}
                />
              </div>

            </div>
          </div>

          {/* Section 2: ช่องทางการรับเงิน */}
          <div className="border-b border-gray-100 pb-8">
            <h3 className="text-lg font-black text-gray-800 mb-1 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-[#D4F1BB]/60 text-[#16A085] flex items-center justify-center text-sm font-bold">2</span>
              ช่องทางการรับเงิน
            </h3>
            <p className="text-xs text-gray-400 mb-6 ml-10">
              เพื่อให้ลูกค้าโอนเงินให้ร้านค้าได้โดยตรง ระบบไม่มีการหักค่าธรรมเนียมใดๆ
            </p>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    ธนาคาร / พร้อมเพย์ <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={formData.paymentBank}
                    onChange={(e) => setFormData({ ...formData, paymentBank: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                  >
                    <option value="" disabled>-- เลือกช่องทาง --</option>
                    <option value="ธนาคารกสิกรไทย">ธนาคารกสิกรไทย (KBANK)</option>
                    <option value="ธนาคารไทยพาณิชย์">ธนาคารไทยพาณิชย์ (SCB)</option>
                    <option value="ธนาคารกรุงเทพ">ธนาคารกรุงเทพ (BBL)</option>
                    <option value="ธนาคารกรุงไทย">ธนาคารกรุงไทย (KTB)</option>
                    <option value="ธนาคารกรุงศรีอยุธยา">ธนาคารกรุงศรีอยุธยา (BAY)</option>
                    <option value="ธนาคารออมสิน">ธนาคารออมสิน (GSB)</option>
                    <option value="ธ.ก.ส.">ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)</option>
                    <option value="other">พร้อมเพย์ (PromptPay)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    เลขที่บัญชี / เบอร์พร้อมเพย์ <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.paymentAccount}
                    onChange={(e) => setFormData({ ...formData, paymentAccount: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-mono"
                    placeholder={formData.paymentBank === "other" ? "เบอร์โทรศัพท์ หรือ เลขบัตร ปชช." : "เช่น 012-3-45678-9"}
                  />
                </div>

                {formData.paymentBank !== "other" && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      ชื่อบัญชี (ตรงตามสมุดบัญชี) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.paymentName}
                      onChange={(e) => setFormData({ ...formData, paymentName: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16A085]/30 focus:border-[#16A085] transition text-sm font-medium"
                      placeholder="เช่น นาย สมชาย ใจดี"
                    />
                  </div>
                )}
              </div>

              {/* QR Code Upload */}
              <div className="bg-gray-50/70 p-5 rounded-2xl border border-gray-100 flex flex-col sm:flex-row items-center gap-5">
                <input
                  type="file"
                  ref={qrInputRef}
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handleQrChange}
                />

                <div
                  onClick={() => qrInputRef.current?.click()}
                  className="relative w-28 h-28 rounded-2xl border-2 border-dashed border-gray-300 hover:border-[#16A085] bg-white flex flex-col items-center justify-center cursor-pointer overflow-hidden group shadow-sm transition flex-shrink-0"
                >
                  {qrPreview ? (
                    <>
                      <img src={qrPreview} alt="Payment QR Code" className="w-full h-full object-contain p-1" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                        เปลี่ยนรูป
                      </div>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-qrcode text-gray-400 text-3xl group-hover:text-[#16A085] transition mb-1"></i>
                      <span className="text-[10px] font-bold text-gray-400 group-hover:text-[#16A085]">แนบรูป QR</span>
                    </>
                  )}
                </div>

                <div className="text-center sm:text-left flex-grow">
                  <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2 justify-center sm:justify-start">
                    รูปภาพ QR Code พร้อมเพย์ หรือ QR บัญชีธนาคาร
                    <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-bold">แนะนำ</span>
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    แนบรูปภาพ QR Code จากแอปธนาคาร เพื่อให้ลูกค้าสามารถสแกนจ่ายเงินได้สะดวกรวดเร็วเมื่อสั่งซื้อสินค้า
                  </p>
                  {qrPreview && (
                    <button
                      type="button"
                      onClick={() => { setQrFile(null); setQrPreview(null); }}
                      className="mt-2 text-xs text-red-500 hover:text-red-700 font-bold inline-flex items-center gap-1"
                    >
                      <i className="fa-solid fa-trash-can"></i> ลบ QR Code
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: ข้อตกลงและนโยบายร้านค้า */}
          <div>
            <h3 className="text-lg font-black text-gray-800 mb-1 flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-[#D4F1BB]/60 text-[#16A085] flex items-center justify-center text-sm font-bold">3</span>
              ข้อตกลงและเงื่อนไข
            </h3>

            <div className="mt-4 p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="mt-1 h-5 w-5 text-[#16A085] focus:ring-[#16A085] border-gray-300 rounded cursor-pointer transition"
                />
                <span className="text-xs sm:text-sm text-gray-700 leading-relaxed font-medium">
                  ข้าพเจ้ายินยอมปฏิบัติตามกฎระเบียบของตลาดชุมชน VRU Marketplace และรับรองว่าข้อมูลและสินค้าที่จัดจำหน่ายเป็นไปตามกฎหมาย ไม่จำหน่ายสินค้าละเมิดลิขสิทธิ์ และจะจัดส่งสินค้าให้แก่ผู้ซื้ออย่างถูกต้องตรงเวลา
                </span>
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center sm:text-left">
              <i className="fa-solid fa-shield text-[#16A085] mr-1"></i> ปลอดภัย ไม่มีการหักค่าธรรมเนียมการเปิดร้าน
            </p>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Link
                href="/"
                className="w-1/2 sm:w-auto text-center px-6 py-3 rounded-full font-bold text-gray-600 hover:bg-gray-100 transition text-sm"
              >
                ยกเลิก
              </Link>
              <button
                type="submit"
                disabled={isSubmitting || !agreeTerms}
                className="w-1/2 sm:w-auto btn-minimal px-8 py-3.5 rounded-full font-bold shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-sm inline-flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> กำลังส่งคำขอ...</>
                ) : (
                  <><i className="fa-solid fa-paper-plane"></i> ส่งคำขอเปิดร้านค้า</>
                )}
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}
