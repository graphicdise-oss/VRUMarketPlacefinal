"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Breadcrumb from "@/components/ui/Breadcrumb";
import { shopApi, paymentChannelApi, PaymentChannelDto, communityApi } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";
import dynamic from "next/dynamic";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] w-full bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400">
      กำลังโหลดแผนที่...
    </div>
  ),
});

const parseDescription = (rawDesc: string) => {
  let cleanDesc = rawDesc || "";
  let phone = "";
  let locationText = "";
  let latitude: number | null = null;
  let longitude: number | null = null;

  // Extract phone: 📞 เบอร์โทรติดต่อ: ...
  const phoneMatch = cleanDesc.match(/📞\s*เบอร์โทร(?:ศัพท์)?(?:ติดต่อ)?:\s*([^\n\r]+)/);
  if (phoneMatch) {
    phone = phoneMatch[1].trim();
    cleanDesc = cleanDesc.replace(phoneMatch[0], "");
  }

  // Extract location: 📍 ที่ตั้งในชุมชน: ... or ที่ตั้งหน้าร้าน: ...
  const locMatch = cleanDesc.match(/📍\s*(?:ที่ตั้งในชุมชน|ที่ตั้งหน้าร้าน|ที่อยู่หน้าร้าน):\s*([^\n\r]+)/);
  if (locMatch) {
    locationText = locMatch[1].trim();
    cleanDesc = cleanDesc.replace(locMatch[0], "");
  }

  // Extract map coords: 🗺️ พิกัดแผนที่: https://maps.google.com/?q=lat,lng
  const mapMatch = cleanDesc.match(/🗺️\s*พิกัดแผนที่:\s*(?:https:\/\/maps\.google\.com\/\?q=)?([0-9.-]+),([0-9.-]+)/);
  if (mapMatch) {
    const lat = parseFloat(mapMatch[1]);
    const lng = parseFloat(mapMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      latitude = lat;
      longitude = lng;
    }
    cleanDesc = cleanDesc.replace(mapMatch[0], "");
  }

  // Clean extra blank lines
  cleanDesc = cleanDesc.replace(/\n\s*\n\s*\n/g, "\n\n").trim();

  return { cleanDesc, phone, locationText, latitude, longitude };
};

const formatDescription = (cleanDesc: string, phone: string, locationText: string, lat: number | null, lng: number | null) => {
  const parts: string[] = [];
  if (cleanDesc.trim()) {
    parts.push(cleanDesc.trim());
  }
  if (phone.trim()) {
    parts.push(`📞 เบอร์โทรติดต่อ: ${phone.trim()}`);
  }
  if (locationText.trim()) {
    parts.push(`📍 ที่ตั้งในชุมชน: ${locationText.trim()}`);
  }
  if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
    parts.push(`🗺️ พิกัดแผนที่: https://maps.google.com/?q=${lat},${lng}`);
  }
  return parts.join("\n\n");
};

export default function SellerSettingsClient() {
  const router = useRouter();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState("");
  const [initialShopName, setInitialShopName] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [approvalStatus, setApprovalStatus] = useState<string>("APPROVED");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [description, setDescription] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
  const [locationText, setLocationText] = useState("");
  const [initialLocationText, setInitialLocationText] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [initialLatitude, setInitialLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [initialLongitude, setInitialLongitude] = useState<number | null>(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [hasBanner, setHasBanner] = useState(false);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [deleteBannerRequested, setDeleteBannerRequested] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Profile pending change states (§86)
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [pendingDescription, setPendingDescription] = useState<string | null>(null);
  const [hasPendingLogo, setHasPendingLogo] = useState(false);
  const [profileChangeRequestedAt, setProfileChangeRequestedAt] = useState<string | null>(null);
  const [profileChangeRejectionReason, setProfileChangeRejectionReason] = useState<string | null>(null);

  const [paymentType, setPaymentType] = useState<"BANK_TRANSFER" | "PROMPTPAY">("BANK_TRANSFER");
  
  // Bank fields
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  
  // PromptPay
  const [promptPayNumber, setPromptPayNumber] = useState("");
  const [hasQrImage, setHasQrImage] = useState(false);
  const [qrImage, setQrImage] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      shopApi.getMine().catch(() => null),
      paymentChannelApi.list().catch(() => [])
    ]).then(async ([shopData, channelsData]) => {
      if (shopData) {
        setShopId(shopData.id);
        setShopName(shopData.name);
        const parsed = parseDescription(shopData.description || "");
        setDescription(parsed.cleanDesc);
        setInitialDescription(parsed.cleanDesc);
        setPhone(parsed.phone);
        setInitialPhone(parsed.phone);
        setLocationText(parsed.locationText);
        setInitialLocationText(parsed.locationText);
        setLatitude(parsed.latitude);
        setInitialLatitude(parsed.latitude);
        setLongitude(parsed.longitude);
        setInitialLongitude(parsed.longitude);
        setHasLogo(shopData.hasLogo);
        setHasBanner(!!shopData.hasBanner);
        setApprovalStatus(shopData.approvalStatus);
        setCreatedAt(shopData.createdAt);

        setPendingName(shopData.pendingName);
        setPendingDescription(shopData.pendingDescription);
        setHasPendingLogo(shopData.hasPendingLogo);
        setProfileChangeRequestedAt(shopData.profileChangeRequestedAt);
        setProfileChangeRejectionReason(shopData.profileChangeRejectionReason);

        if (shopData.communityId) {
          const comm = await communityApi.getById(shopData.communityId).catch(() => null);
          if (comm) setCommunityName(comm.name);
        }
      }
      
      if (channelsData && channelsData.length > 0) {
        const c = channelsData[0];
        setCurrentChannelId(c.id);
        setPaymentType(c.type);
        setHasQrImage(c.hasQrImage);
        if (c.type === "BANK_TRANSFER") {
          setBankName(c.bankName || "");
          setAccountNumber(c.bankAccountNumber || "");
          setAccountName(c.bankAccountName || "");
        } else {
          setPromptPayNumber(c.promptPayId || "");
        }
      }
      setIsLoading(false);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentType === "PROMPTPAY" && !promptPayNumber && !qrImage && !hasQrImage) {
      alert("กรุณากรอกเบอร์พร้อมเพย์ หรืออัปโหลดรูป QR Code");
      return;
    }

    setIsSubmitting(true);
    try {
      const isShopInfoChanged = (shopName !== initialShopName) || 
        (description !== initialDescription) || 
        (phone !== initialPhone) || 
        (locationText !== initialLocationText) || 
        (latitude !== initialLatitude) || 
        (longitude !== initialLongitude) || 
        (logoFile !== null);

      // 1. Update Shop
      const formattedDesc = formatDescription(description, phone, locationText, latitude, longitude);
      await shopApi.updateProfile({ name: shopName, description: formattedDesc || null });

      // 1.1 Upload logo if changed
      if (logoFile) {
        try {
          await shopApi.uploadLogo(logoFile);
        } catch (logoErr) {
          console.error("Failed to upload shop logo:", logoErr);
        }
      }

      // 1.2 Banner handle: delete or upload
      if (deleteBannerRequested) {
        try {
          await shopApi.deleteBanner();
        } catch (bannerErr) {
          console.error("Failed to delete shop banner:", bannerErr);
        }
      } else if (bannerFile) {
        try {
          await shopApi.uploadBanner(bannerFile);
        } catch (bannerErr) {
          console.error("Failed to upload shop banner:", bannerErr);
        }
      }

      // 2. Update or Create Payment Channel
      const payload: Omit<PaymentChannelDto, 'id' | 'hasQrImage' | 'createdAt' | 'updatedAt'> = {
        type: paymentType,
        bankName: paymentType === "BANK_TRANSFER" ? bankName : null,
        bankAccountNumber: paymentType === "BANK_TRANSFER" ? accountNumber : null,
        bankAccountName: paymentType === "BANK_TRANSFER" ? accountName : null,
        promptPayId: paymentType === "PROMPTPAY" ? promptPayNumber : null,
      };

      let channelIdToUploadQR = currentChannelId;

      if (currentChannelId) {
        await paymentChannelApi.update(currentChannelId, payload);
      } else {
        const created = await paymentChannelApi.create(payload);
        setCurrentChannelId(created.id);
        channelIdToUploadQR = created.id;
      }

      // 3. Upload QR Image if present
      if (qrImage && channelIdToUploadQR && paymentType === "PROMPTPAY") {
        await paymentChannelApi.uploadQr(channelIdToUploadQR, qrImage);
      }

      if (approvalStatus === "APPROVED" && isShopInfoChanged) {
        alert("บันทึกข้อมูลเรียบร้อย!\n• ข้อมูลร้านค้า: ส่งคำขอไปยังแอดมินชุมชนเพื่อรอตรวจสอบก่อนแสดงผลจริง\n• ช่องทางรับเงิน: อัปเดตและมีผลทันที");
      } else {
        alert("บันทึกการตั้งค่าร้านค้าเรียบร้อยแล้ว");
      }
      router.push("/seller");
    } catch (err) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล: " + getErrorMessage(err, ""));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><i className="fa-solid fa-spinner fa-spin text-4xl text-vru-blue"></i></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/seller" className="flex items-center gap-2 text-gray-600 hover:text-vru-blue transition font-bold">
            <i className="fa-solid fa-arrow-left"></i> กลับ
          </Link>
          <h1 className="text-xl font-bold text-gray-800">ตั้งค่าร้านค้า</h1>
          <button disabled={isSubmitting} onClick={handleSave} className="bg-vru-blue hover:bg-blue-600 text-white font-bold py-1.5 px-6 rounded-lg text-sm shadow-sm transition disabled:opacity-50">
            {isSubmitting ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </header>

      <main className="flex-grow max-w-3xl mx-auto w-full px-4 py-6">
        <Breadcrumb items={[
          { label: "Seller Center", href: "/seller" },
          { label: "ตั้งค่าร้านค้า" }
        ]} />

        {/* Shop Overview & Public Link Banner */}
        {shopId && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-gray-800 text-lg">{shopName}</span>
                {approvalStatus === "APPROVED" && (
                  <span className="bg-emerald-50 text-emerald-600 text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">
                    <i className="fa-solid fa-circle-check mr-1"></i>อนุมัติแล้ว
                  </span>
                )}
                {approvalStatus === "PENDING" && (
                  <span className="bg-amber-50 text-amber-600 text-[11px] font-bold px-2.5 py-0.5 rounded-full border border-amber-200">
                    <i className="fa-solid fa-clock mr-1"></i>รออนุมัติ
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <i className="fa-solid fa-layer-group text-[#16A085]"></i> {communityName || "วิสาหกิจชุมชน"}
                </span>
                <span className="text-gray-300">•</span>
                <span className="font-mono text-gray-400">ID: {shopId.slice(0, 8)}...</span>
                {createdAt && (
                  <>
                    <span className="text-gray-300">•</span>
                    <span>เปิดร้านเมื่อ {new Date(createdAt).toLocaleDateString("th-TH")}</span>
                  </>
                )}
              </div>
            </div>

            <Link
              href={`/shops/${shopId}`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 bg-[#16A085]/10 hover:bg-[#16A085] text-[#16A085] hover:text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-[#16A085]/30 transition-all shadow-sm flex-shrink-0"
            >
              <i className="fa-solid fa-arrow-up-right-from-square"></i> ดูหน้าร้านค้าจริง (มุมมองลูกค้า)
            </Link>
          </div>
        )}

        {/* Pending Profile Change Banner (§86) */}
        {approvalStatus === "APPROVED" && (pendingName || pendingDescription || hasPendingLogo) && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-clock text-amber-500 mt-0.5 text-base"></i>
              <div className="flex-grow">
                <h4 className="font-bold text-amber-900 text-sm">มีคำขอแก้ไขข้อมูลร้านค้าที่กำลังรอแอดมินชุมชนตรวจสอบ</h4>
                <p className="text-xs text-amber-700 mt-0.5">
                  ส่งคำขอเมื่อ {profileChangeRequestedAt ? new Date(profileChangeRequestedAt).toLocaleString("th-TH") : "เร็วๆ นี้"}
                </p>
                <div className="mt-2.5 bg-white/70 p-2.5 rounded-xl border border-amber-200 text-xs text-amber-800 space-y-1">
                  {pendingName && <div>• ชื่อร้านที่ขอเปลี่ยน: <span className="font-bold underline">{pendingName}</span></div>}
                  {hasPendingLogo && <div>• มีรูปโลโก้ร้านใหม่กำลังรอตรวจสอบ</div>}
                  {pendingDescription && <div>• มีคำอธิบายร้านค้าใหม่กำลังรอตรวจสอบ</div>}
                </div>
                <p className="text-[11px] text-amber-600 mt-2">
                  * หมายเหตุ: ระหว่างรอแอดมินอนุมัติ หน้าร้านค้าจริงจะยังแสดงชื่อและข้อมูลเดิมเพื่อให้ท่านขายสินค้าได้อย่างต่อเนื่อง
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Rejection Notification Banner */}
        {profileChangeRejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-triangle-exclamation text-red-500 mt-0.5 text-base"></i>
              <div>
                <h4 className="font-bold text-red-900 text-sm">คำขอแก้ไขข้อมูลร้านค้าล่าสุดไม่ผ่านการอนุมัติ</h4>
                <p className="text-xs text-red-700 mt-0.5 font-medium">เหตุผล: &ldquo;{profileChangeRejectionReason}&rdquo;</p>
                <p className="text-[11px] text-red-600 mt-1.5">ท่านสามารถปรับปรุงข้อมูลตามข้อเสนอแนะและกดบันทึกเพื่อส่งให้แอดมินพิจารณาใหม่อีกครั้ง</p>
              </div>
            </div>
          </div>
        )}

        {/* System Rules & Security Callout */}
        <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl p-4 mb-6 shadow-sm text-xs text-blue-900 flex items-start gap-3">
          <i className="fa-solid fa-shield-halved text-blue-600 mt-0.5 text-base"></i>
          <div className="space-y-1">
            <span className="font-bold text-sm block text-blue-900">ระเบียบและแนวทางการจัดการข้อมูลร้านค้า:</span>
            <p className="text-blue-800">
              <span className="font-bold">1. ข้อมูลร้านค้า:</span> ร้านที่ได้รับการอนุมัติแล้ว หากมีการเปลี่ยนชื่อร้าน รายละเอียด หรือโลโก้ จะต้องผ่านการตรวจอนุมัติจากแอดมินชุมชนก่อนมีผลบนหน้าร้านจริง เพื่อความปลอดภัยของผู้ซื้อ
            </p>
            <p className="text-blue-800">
              <span className="font-bold">2. ช่องทางรับเงิน:</span> แก้ไขได้ตลอดเวลาและมีผลทันที โดยระบบจะแจ้งเตือนความปลอดภัยไปยังบัญชีของท่าน และจะรีเซ็ต QR Code เก่าอัตโนมัติหากท่านเปลี่ยนหมายเลขพร้อมเพย์/บัญชี
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
            <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-store text-vru-blue"></i> ข้อมูลพื้นฐานร้านค้า
            </h2>
            <div className="space-y-5">
              {/* ภาพหน้าปก/แบนเนอร์ร้านค้า */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700">ภาพหน้าปก/แบนเนอร์ร้านค้า (Store Banner)</label>
                  <span className="text-xs text-gray-400">อัตราส่วนแนวนอน แนะนำ ~1200x400 px</span>
                </div>
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200">
                  <div className="relative w-full h-36 sm:h-48 rounded-xl bg-gray-200 border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden mb-3 shadow-inner">
                    {bannerPreview ? (
                      <img src={bannerPreview} alt="Banner Preview" className="w-full h-full object-cover" />
                    ) : !deleteBannerRequested && hasBanner && shopId ? (
                      <img src={`/api/v1/shops/${shopId}/banner`} alt="Shop Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center p-4 text-gray-400">
                        <i className="fa-solid fa-panorama text-3xl mb-1.5 block"></i>
                        <span className="text-xs">ยังไม่มีภาพหน้าปกเฉพาะร้าน (ระบบจะใช้ภาพมาตรฐานของชุมชน)</span>
                      </div>
                    )}

                    {deleteBannerRequested && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center text-white text-xs font-bold gap-2">
                        <i className="fa-solid fa-trash-can text-red-400"></i> รอการลบภาพหน้าปกเมื่อกดบันทึก
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="file"
                      ref={bannerInputRef}
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                            alert("กรุณาเลือกไฟล์ภาพ JPEG, PNG หรือ WEBP เท่านั้น");
                            return;
                          }
                          if (file.size > 5 * 1024 * 1024) {
                            alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
                            return;
                          }
                          setBannerFile(file);
                          setBannerPreview(URL.createObjectURL(file));
                          setDeleteBannerRequested(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => bannerInputRef.current?.click()}
                      className="bg-white border border-gray-300 hover:border-[#16A085] hover:text-[#16A085] text-gray-700 font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm"
                    >
                      <i className="fa-solid fa-upload mr-1.5"></i> {hasBanner || bannerPreview ? "เปลี่ยนภาพหน้าปก" : "อัปโหลดภาพหน้าปก"}
                    </button>

                    {bannerFile && (
                      <button
                        type="button"
                        onClick={() => {
                          setBannerFile(null);
                          setBannerPreview(null);
                          if (bannerInputRef.current) bannerInputRef.current.value = "";
                        }}
                        className="text-xs text-red-500 font-bold hover:underline"
                      >
                        ยกเลิกไฟล์ที่เลือก
                      </button>
                    )}

                    {!bannerFile && hasBanner && !deleteBannerRequested && (
                      <button
                        type="button"
                        onClick={() => setDeleteBannerRequested(true)}
                        className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1"
                      >
                        <i className="fa-solid fa-trash-can"></i> ลบภาพหน้าปก (ใช้ภาพเริ่มต้น)
                      </button>
                    )}

                    {deleteBannerRequested && (
                      <button
                        type="button"
                        onClick={() => setDeleteBannerRequested(false)}
                        className="text-xs text-[#16A085] font-bold hover:underline"
                      >
                        ยกเลิกการลบ (ใช้ภาพเดิม)
                      </button>
                    )}

                    <span className="text-[11px] text-gray-400">รองรับไฟล์ JPG, PNG, WEBP ขนาดไม่เกิน 5MB</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">โลโก้ร้านค้า (Shop Logo)</label>
                <div className="flex items-center gap-5 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                  <div className="w-20 h-20 rounded-2xl bg-white border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo Preview" className="w-full h-full object-cover" />
                    ) : hasLogo && shopId ? (
                      <img src={`/api/v1/shops/${shopId}/logo`} alt={shopName} className="w-full h-full object-cover" />
                    ) : (
                      <i className="fa-solid fa-store text-2xl text-gray-400"></i>
                    )}
                  </div>
                  <div>
                    <input
                      type="file"
                      ref={logoInputRef}
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (!["image/jpeg", "image/png"].includes(file.type)) {
                            alert("กรุณาเลือกไฟล์ภาพ JPEG หรือ PNG เท่านั้น");
                            return;
                          }
                          if (file.size > 5 * 1024 * 1024) {
                            alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
                            return;
                          }
                          setLogoFile(file);
                          setLogoPreview(URL.createObjectURL(file));
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="bg-white border border-gray-300 hover:border-[#16A085] hover:text-[#16A085] text-gray-700 font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm"
                    >
                      <i className="fa-solid fa-upload mr-1.5"></i> {hasLogo || logoPreview ? "เปลี่ยนรูปโลโก้" : "อัปโหลดโลโก้ร้านค้า"}
                    </button>
                    {logoFile && (
                      <button
                        type="button"
                        onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                        className="text-xs text-red-500 font-bold ml-3 hover:underline"
                      >
                        ยกเลิก
                      </button>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1.5">รองรับไฟล์ JPG, PNG ขนาดไม่เกิน 5MB (ระบบลบพิกัด GPS เพื่อความปลอดภัย PDPA)</p>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อร้านค้า *</label>
                <input 
                  type="text" 
                  required 
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm" 
                  placeholder="ตัวอย่าง: ร้านกล้วยตากพลังงานแสงอาทิตย์คุณยาย"
                />
              </div>

              {/* Contact Phone Number */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm"
                    placeholder="เช่น 081-234-5678"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">ใช้สำหรับการติดต่อฉุกเฉินและแสดงบนหน้าร้านค้าเพื่อให้ผู้ซื้อติดต่อสอบถามได้</p>
              </div>

              {/* Description / Bio */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700">รายละเอียดร้านค้า (Bio)</label>
                  <span className="text-xs text-gray-400">แสดงผลบนหน้าร้านค้า</span>
                </div>
                <textarea 
                  rows={4} 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="อธิบายสั้นๆ ว่าร้านของคุณขายสินค้าประเภทใด มีจุดเด่นหรือเรื่องราวความเป็นมาอย่างไร..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm leading-relaxed" 
                ></textarea>
              </div>

              {/* Physical Address in Community */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  ที่ตั้งหน้าร้าน / จุดสังเกตในชุมชน
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 text-sm">
                    <i className="fa-solid fa-location-dot"></i>
                  </span>
                  <input
                    type="text"
                    maxLength={150}
                    value={locationText}
                    onChange={(e) => setLocationText(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-blue focus:border-vru-blue text-sm"
                    placeholder="เช่น บ้านเลขที่ 12/3 ม.2 ซอย 4 ตรงข้ามศาลาประชาคม"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">ช่วยให้ลูกค้าและแอดมินชุมชนสามารถแวะมาอุดหนุนที่หน้าร้านจริงได้ง่าย</p>
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
                  latitude={latitude}
                  longitude={longitude}
                  onChange={(lat, lng) => {
                    setLatitude(lat);
                    setLongitude(lng);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden p-6">
            <h2 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <i className="fa-solid fa-money-check-dollar text-vru-orange"></i> ช่องทางการรับเงินของร้านค้า
            </h2>
            <div className="bg-orange-50 border border-orange-200 p-3 rounded-xl text-xs text-orange-800 mb-4 flex items-start gap-2">
              <i className="fa-solid fa-circle-info text-orange-600 mt-0.5"></i>
              <span>ข้อมูลนี้จะถูกเก็บเป็นความลับ และแสดงให้ลูกค้าเห็นเฉพาะในขั้นตอน &quot;รอชำระเงิน&quot; เมื่อมีคำสั่งซื้อจริงเท่านั้น</span>
            </div>

            <div className="flex gap-4 mb-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="paymentType" 
                  checked={paymentType === "BANK_TRANSFER"} 
                  onChange={() => setPaymentType("BANK_TRANSFER")} 
                  className="w-4 h-4 text-vru-orange focus:ring-vru-orange" 
                />
                <span className="text-sm font-bold text-gray-700">โอนผ่านบัญชีธนาคาร</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="paymentType" 
                  checked={paymentType === "PROMPTPAY"} 
                  onChange={() => setPaymentType("PROMPTPAY")} 
                  className="w-4 h-4 text-vru-orange focus:ring-vru-orange" 
                />
                <span className="text-sm font-bold text-gray-700">พร้อมเพย์ / QR Code</span>
              </label>
            </div>

            {paymentType === "BANK_TRANSFER" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">ธนาคาร *</label>
                  <select 
                    required 
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-orange focus:border-vru-orange text-sm bg-white"
                  >
                    <option value="">เลือกธนาคาร...</option>
                    <option>กสิกรไทย</option>
                    <option>ไทยพาณิชย์ (SCB)</option>
                    <option>กรุงไทย</option>
                    <option>กรุงเทพ</option>
                    <option>กรุงศรีอยุธยา</option>
                    <option>ออมสิน</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">เลขที่บัญชี *</label>
                  <input 
                    type="text" 
                    required 
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-orange focus:border-vru-orange text-sm" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">ชื่อบัญชี *</label>
                  <input 
                    type="text" 
                    required 
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-orange focus:border-vru-orange text-sm" 
                  />
                </div>
              </div>
            )}

            {paymentType === "PROMPTPAY" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">เบอร์พร้อมเพย์ (เบอร์โทร หรือ เลขบัตรประชาชน)</label>
                  <input 
                    type="text" 
                    value={promptPayNumber}
                    onChange={(e) => setPromptPayNumber(e.target.value)}
                    placeholder="เช่น 0812345678"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-vru-orange focus:border-vru-orange text-sm" 
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    * หากเปลี่ยนหมายเลขพร้อมเพย์ ระบบจะรีเซ็ตรูป QR Code เดิมออกโดยอัตโนมัติเพื่อความปลอดภัย
                  </p>
                </div>

                <div className="pt-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">รูปภาพ QR Code พร้อมเพย์</label>
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 flex flex-col sm:flex-row items-center gap-5">
                    <div className="w-28 h-28 bg-white rounded-xl border border-gray-300 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                      {qrPreview ? (
                        <img src={qrPreview} alt="QR Preview" className="w-full h-full object-contain p-1" />
                      ) : hasQrImage && currentChannelId ? (
                        <img 
                          src={`/api/v1/shops/me/payment-channels/${currentChannelId}/qr-image`} 
                          alt="Current QR Code" 
                          className="w-full h-full object-contain p-1" 
                        />
                      ) : (
                        <div className="text-center p-2 text-gray-400">
                          <i className="fa-solid fa-qrcode text-3xl mb-1 block"></i>
                          <span className="text-[10px]">ยังไม่มีรูป</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-grow text-center sm:text-left">
                      <input 
                        type="file" 
                        ref={qrInputRef}
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (!["image/jpeg", "image/png"].includes(file.type)) {
                              alert("กรุณาเลือกไฟล์ภาพ JPEG หรือ PNG เท่านั้น");
                              return;
                            }
                            if (file.size > 5 * 1024 * 1024) {
                              alert("ขนาดไฟล์ภาพต้องไม่เกิน 5 MB");
                              return;
                            }
                            setQrImage(file);
                            setQrPreview(URL.createObjectURL(file));
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => qrInputRef.current?.click()}
                        className="bg-white border border-gray-300 hover:border-vru-orange hover:text-vru-orange text-gray-700 font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm"
                      >
                        <i className="fa-solid fa-upload mr-1.5"></i> {hasQrImage || qrPreview ? "เปลี่ยนรูป QR Code" : "อัปโหลดรูป QR Code"}
                      </button>
                      {qrImage && (
                        <button
                          type="button"
                          onClick={() => { setQrImage(null); setQrPreview(null); }}
                          className="text-xs text-red-500 font-bold ml-3 hover:underline"
                        >
                          ยกเลิก
                        </button>
                      )}
                      <p className="text-[11px] text-gray-400 mt-2">
                        รองรับไฟล์ JPG, PNG ขนาดไม่เกิน 5MB (ระบบจะลบข้อมูล EXIF/พิกัด GPS อัตโนมัติ)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </form>
      </main>
    </div>
  );
}
