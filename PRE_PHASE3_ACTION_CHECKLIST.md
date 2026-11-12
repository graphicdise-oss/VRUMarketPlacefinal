# 📋 เอกสารแจ้งเตือนความจำ: รายการเก็บงานระบบปัจจุบันให้สมบูรณ์ก่อนเริ่ม Phase 3 (Pre-Phase 3 Readiness Checklist)

**โครงการ:** VRU Marketplace
**วันที่จัดทำ:** 8 พฤศจิกายน 2569 (2026-11-08)
**เป้าหมาย:** สรุปรายการ **"ปิดจุดเสี่ยงความปลอดภัย + ต่อสายฟีเจอร์ค้าง + ตั้งค่า Production Infra"** เพื่อให้ระบบ Phase 2 แข็งแรง ปลอดภัย และพร้อมใช้งานจริง 100% ก่อนเริ่มพัฒนา Phase 3
**เอกสารที่เกี่ยวข้อง:** [`PENDING_NAS_BACKUP_TASK.md`](./PENDING_NAS_BACKUP_TASK.md) · [`DEPLOYMENT_HANDOVER.md`](./DEPLOYMENT_HANDOVER.md) · [`SERVER_NETWORK_ARCHITECTURE_AND_DOMAIN_REPORT.md`](./SERVER_NETWORK_ARCHITECTURE_AND_DOMAIN_REPORT.md) · [`backend/Backend-VRU-Marketplace-main/docs/HANDOFF.md`](./backend/Backend-VRU-Marketplace-main/docs/HANDOFF.md)

> [!IMPORTANT]
> เอกสารนี้เป็น **แผนเก็บความเรียบร้อยภายในทีมก่อนเริ่มพัฒนา Phase 3** (ไม่ใช่นำเสนอเป็นสไลด์ขายงาน) เรียงลำดับตามความเร่งด่วน **P0 → P3** เพื่อกลับมาทำต่อได้ทันทีโดยไม่ต้องไล่หาจุดเดิมซ้ำ

---

## 🔴 P0: ความปลอดภัยและข้อมูล Production (ดำเนินการเสร็จสิ้น 5/5 รายการ — 9 พ.ย. 2569)

- [x] **1. ปิดช่องโหว่ Local Upload API และแก้ปัญหาไฟล์หายเมื่อ Rebuild Container** *(เสร็จสิ้น)*
  - **ปัญหา:** Next.js API routes `src/app/api/upload/route.ts` และ `src/app/api/upload/articles/route.ts` ยังไม่มี Auth / Role Guard, ไม่ตรวจ MIME / magic bytes (อัปโหลด `.svg` หรือ `.html` ได้ → เสี่ยง Stored XSS) และบันทึกลง `public/uploads/*` ซึ่ง `vm102/docker-compose.yml` ไม่ได้ mount Docker volume ไว้ (รูปแบนเนอร์และบทความจะหายทุกครั้งที่ rebuild)
  - **จุดที่เรียกใช้งานอยู่:** `src/app/admin/articles/ArticleAdminClient.tsx` (line 124) และ `src/app/super-admin/components/BannersTab.tsx` (line 81) *(ตรวจสอบ `BannerAdminClient.tsx` ร่วมด้วย)*
  - **การแก้ไข:** ย้าย endpoint อัปโหลดแบนเนอร์ (`POST /api/v1/admin/banners/upload` + `GET /api/v1/public/banners/images/:fileId`) และบทความ (`POST /api/v1/articles/upload` + `GET /api/v1/articles/images/:fileId`) ไปฝั่ง Backend (`vm103`) ผ่าน `@RequiresSuperAdmin()` + `@AcceptsUpload` + `FileStorageService` (Sharp re-encode + เก็บใน volume `/var/lib/vru-marketplace/uploads` + กรอง `UNATTACHED_UPLOADED_FILE_WHERE` ไม่ให้เข้าถึงไฟล์ส่วนตัวได้) และลบ 2 route เก่าใน `src/app/api/upload/` ออกแล้ว

- [x] **2. ป้องกัน XSS ในหน้าอ่านบทความ (`src/app/articles/[id]/ArticleDetailClient.tsx`)** *(เสร็จสิ้น)*
  - **ปัญหา:** บรรทัด 93–96 เรนเดอร์ `article.content` ด้วย `dangerouslySetInnerHTML={{ __html: article.content }}` โดยตรงไม่มีการ sanitize
  - **การแก้ไข:** สร้างตัวกรอง Allowlist HTML Sanitizer ทั้งฝั่ง Frontend (`src/lib/sanitize-html.ts` เรียกใช้ใน `ArticleDetailClient.tsx`) และฝั่ง Backend (`src/article/sanitize-article-html.ts` เรียกใช้ทั้งตอน `create`, `update`, และ `ArticleDto.from`)

- [x] **3. เพิ่ม Auth & Role Guard ให้หน้า Admin ของ Frontend** *(เสร็จสิ้น)*
  - **ปัญหา:** `src/app/admin/articles/page.tsx` และ `src/app/admin/banners/page.tsx` render client component ตรงๆ โดยยังไม่มี Role Guard เหมือนหน้า `/super-admin`
  - **การแก้ไข:** เพิ่ม `useAuth()` & `SUPER_ADMIN` role guard ใน `ArticleAdminClient.tsx` และ `BannerAdminClient.tsx` ให้ redirect ไป `/login?callbackUrl=...` ทันทีหากไม่ใช่ `SUPER_ADMIN`

- [x] **4. ตรวจสิทธิ์คู่สนทนาใน WebSocket Typing Events (`chat.gateway.ts`)** *(เสร็จสิ้น)*
  - **ปัญหา:** `backend/Backend-VRU-Marketplace-main/src/chat/chat.gateway.ts` บรรทัด 244–272 (`onTyping` และ `onStopTyping`) ตรวจแค่ `requireLiveUser` แต่ไม่ได้ตรวจว่า `user.id` เป็นสมาชิกใน `roomId` จริง (ต่างจาก `onMarkRoomRead` บรรทัด 283 ที่ตรวจ `this.chat.getRoomForParty(user.id, roomId)`) ทำให้ส่ง `roomId` อื่นเพื่อ broadcast event ข้ามห้องได้
  - **การแก้ไข:** เพิ่ม `validateWsBody(JoinRoomDto, body)` และ `this.chat.getRoomForParty(user.id, dto.roomId)` ใน `onTyping`, `onStopTyping`, และ `onMarkRoomRead` เรียบร้อยแล้ว

- [x] **5. ปรับ Production `.env` ให้ตรงกับ HTTPS จริง (`vm103/.env` และ `vm103/docker-compose.yml`)** *(เสร็จสิ้น)*
  - **ปัญหา:** ตอนนี้ `https://vrumarketplace.com` ออนไลน์ผ่าน SSL แล้ว แต่ `vm103/.env` ยังตั้ง `COOKIE_SECURE=false` และค่า `TRUST_PROXY_HOPS` ยังเป็น `1` (ระบบจริงวิ่งผ่าน IT Gateway `202.29.39.38` → `vm101` NPM → `vm103` ซึ่งอาจมี proxy ซ้อน 2 ชั้น)
  - **การแก้ไข:**
    - ปรับ `COOKIE_SECURE=true` และ `TRUST_PROXY_HOPS=2` ใน `vm103/.env` เรียบร้อยแล้ว (โดยคง `FRONTEND_BASE_URL=https://vrumarketplace.com` และไม่แตะต้อง `ACCOUNT_MARKER_PEPPER`)
    - **⚠️ คำเตือนสำคัญ:** ห้ามทำ `ACCOUNT_MARKER_PEPPER` หายหรือเปลี่ยนค่าเอง (ใช้สำหรับ HMAC ตรวจบัญชีที่เคยถูกแบนตาม PDPA K16) — ให้สำรองเก็บไว้ใน Password Manager / Secure Vault ของทีมแยกต่างหาก

---

## 🟠 P1: งาน Production Infra, Email และกฎหมายที่ค้างส่งมอบ

- [x] **6. ตั้งค่าระบบส่งอีเมลจริง (`EMAIL_TRANSPORT`: SMTP พร้อมใช้งานจริง 100%)** *(เสร็จสิ้น)*
  - **สถานะ:**
    - กำหนดค่า `EMAIL_TRANSPORT=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `MAIL_FROM_NAME="VRU Marketplace"` ใน `vm103/.env` เรียบร้อย
    - ผ่านการทดสอบยิงส่งอีเมลจริง (SMTP STARTTLS Authentication & Handshake) สำเร็จ 100% เข้ากล่องข้อความเรียบร้อยแล้ว
    - รองรับระบบยืนยันอีเมลสมาชิกใหม่ (`/verify-email`), รีเซ็ตรหัสผ่าน (`/forgot-password`), และแจ้งเตือนออเดอร์ครบทุกโฟลว์

- [x] **7. ติดตั้ง NAS Backup ตาม TOR (ข้อ 6.3.1 & ข้อ 7) และปรับสคริปต์ให้รองรับ Multi-VM** *(ส่วนโค้ดสคริปต์เสร็จสิ้น)*
  - **สถานะปัจจุบัน:**
    - ปรับสคริปต์ `backend/Backend-VRU-Marketplace-main/ops/backup/backup.sh`, `restore.sh` และ `backup.env.example` ให้รองรับ Multi-VM (Remote Postgres on `vm104` + Uploads on `vm103`) เรียบร้อยแล้ว
    - ขั้นตอนต่อไป: ขอ IP, Protocol (NFS/SMB), Share Path จาก IT มหาวิทยาลัยเพื่อ mount ลง `/mnt/vru-nas-backup`, ตั้ง cron 03:00 น. และทดสอบกู้คืนด้วย `restore.sh`
- [x] **8. สร้างหน้า `/privacy` และ `/terms` จริง + รับรองเอกสารกฎหมาย** *(ส่วนโค้ดหน้าเว็บเสร็จสิ้น)*
  - **การดำเนินการ:**
    - สร้างหน้า `src/app/privacy/page.tsx` (`PrivacyClient.tsx`) และ `src/app/terms/page.tsx` (`TermsClient.tsx`) ดึงเวอร์ชันจาก `legalApi.getPrivacyPolicy()` และ `legalApi.getTermsOfService()`
    - อัปเดตลิงก์ใน `src/app/register/RegisterPageClient.tsx` และ `src/components/layout/Footer.tsx` ชี้ไปที่ `/terms` และ `/privacy` เรียบร้อยแล้ว
    - ขั้นตอนต่อไป: ส่ง `legal-review-privacy.md` ให้ฝ่ายกฎหมาย มรว. ตรวจรับรองอย่างเป็นทางการ
- [ ] **9. (ถ้าต้องการเปิดใช้งานรอบนี้) เปิด Google OAuth**
  - ลงทะเบียน Redirect URI จริง (`https://vrumarketplace.com/...`) ใน Google Console, เติม `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` บน `vm103/.env` และเพิ่มปุ่ม Google Login หน้า `/login` (ส่ง version ของ Privacy Policy / ToS ให้ครบตาม `GoogleAuthController`)

---

## 🟡 P2: งานต่อสาย Frontend–Backend & Integrity Bugfixes ที่ค้างอยู่จริง (ดำเนินการเสร็จสิ้น 5/5 รายการ — 9 พ.ย. 2569)

- [x] **10. ต่อ Flow Auth ฝั่ง Email ให้ครบใน Frontend** *(เสร็จสิ้น)*
  - สร้างหน้า `/verify-email` (`VerifyEmailClient.tsx`) ต่อกับ `POST /api/v1/auth/verify-email` และปุ่มส่งลิงก์ใหม่ `POST /api/v1/auth/resend-verification`
  - เพิ่มลิงก์ "ลืมรหัสผ่าน?" ใน `src/app/login/LoginPageClient.tsx` ไปที่ `/forgot-password`
  - สร้างหน้า `/forgot-password` (`ForgotPasswordClient.tsx`) ต่อกับ `POST /api/v1/auth/password/forgot`
  - สร้างหน้า `/reset-password` (`ResetPasswordClient.tsx`) ต่อกับ `POST /api/v1/auth/password/reset`
  - เพิ่มฟังก์ชัน API ใน `src/lib/api-modules/auth.ts` เรียบร้อยแล้ว

- [x] **11. ต่อ Refund Flow (`REFUND_ORDERED` → `REFUNDED`) บนหน้าออเดอร์ทั้งฝั่ง Buyer และ Seller** *(เสร็จสิ้น)*
  - เพิ่ม method ใน `src/lib/api-modules/order.ts`: `submitRefundAccount`, `getRefundSlips`, `confirmRefundReceived`, `uploadRefundSlip`
  - **ฝั่งผู้ซื้อ (`OrderDetailClient.tsx`):** เพิ่มฟอร์มกรอกช่องทางรับเงินคืน (PromptPay / Bank Transfer), แสดงข้อมูลบัญชีที่แจ้งไว้, แสดงสลิปคืนเงินที่ร้านค้าแนบมา, และปุ่มยืนยันได้รับเงินคืน
  - **ฝั่งร้านค้า (`SellerOrderDetailClient.tsx`):** แสดงข้อมูลบัญชีรับเงินคืนของผู้ซื้อพร้อมปุ่มคัดลอก (PromptPay / Bank Transfer), ฟอร์มอัปโหลดสลิปคืนเงิน, และแสดงสลิปคืนเงินที่แนบไปแล้ว

- [x] **12. แก้ `OrderDetailClient.tsx` และ `SellerOrderDetailClient.tsx` เรื่องการโหลดสลิปและ Fallback URL** *(เสร็จสิ้น)*
  - ปรับเงื่อนไขการโหลด PaymentSlip และ ShippingSlip ให้โหลดในทุกสถานะถัดจาก `AWAITING_PAYMENT` (รวมถึง `REFUND_ORDERED`, `REFUNDED`, `FROZEN`, `DISPUTED`)
  - เปลี่ยน fallback URL `"http://localhost:3000/api/v1"` มาใช้ `API_BASE_URL` จาก `src/lib/api-modules/core.ts` เป็นมาตรฐานเดียวกัน

- [x] **13. คืนสิทธิ์คูปอง (`UserCouponClaim` / `usedCount`) เมื่อระบบยกเลิกออเดอร์อัตโนมัติหรือแอดมินสั่งยุติ** *(เสร็จสิ้น)*
  - สกัด helper `restoreOrderCouponClaim` ใน `backend/Backend-VRU-Marketplace-main/src/order/common/restore-order-coupon-claim.ts`
  - เรียกใช้ครบทุกเส้นทางที่ยกเลิกออเดอร์:
    1. `order.service.ts` (ผู้ซื้อยกเลิกค่าส่ง / ร้านค้ายกเลิกออเดอร์)
    2. `order-sweep.tasks.ts` (`cancelEach` เมื่อหมดเวลาเรือนที่ 1 / เรือนที่ 2)
    3. `frozen-order.service.ts` (แอดมินตัดสินยุติออเดอร์แช่แข็งที่ยังไม่จ่าย)
    4. `order-freeze.service.ts` (สินค้าถูกตัดสิน PROHIBITED ยกเลิกออเดอร์ที่ยังไม่จ่าย)

- [x] **14. แก้ Logic & ข้อความ UI ที่ไม่ตรงกับ Backend Spec** *(เสร็จสิ้น)*
  - `src/app/seller/settings/SellerSettingsClient.tsx`: แก้ `description: formattedDesc || ""` (ไม่ส่ง null) และเรียก `shopApi.updateProfile` เฉพาะเมื่อ `isShopInfoChanged === true`
  - `src/app/checkout/CheckoutPageClient.tsx`: ลบเฉพาะ `itemsToCheckout` แทนการเรียก `clearCart()` เพื่อไม่ให้ล้างสินค้าที่ยังไม่ได้สั่ง
  - `src/app/admin/community/CommunityAdminClient.tsx`: เปลี่ยนการตรวจพิจารณาข้อพิพาทมาใช้ `DisputeDetailModal` ตัวเดียวกับ Super Admin (รองรับ Break-glass audit log, LazyFile ดูหลักฐาน, ตรวจประวัติแชท), แก้คำผิด `"ร้านค้ายานี้"` -> `"ร้านค้านี้"`
  - `src/app/orders/[id]/dispute/page.tsx`: แก้เงื่อนไขเป็น 7 วันหลังกดรับของ หรือ 15 วันหลังร้านส่ง, แนบหลักฐานได้สูงสุด 10 รูป, และคำตัดสินของแอดมินชุมชนถือเป็นที่สิ้นสุด
  - `src/lib/api-modules/super-admin.ts`: ผสานข้อมูลจาก `GET /api/v1/admin/dashboard` และ `/admin/dashboard/platform` ใน `superAdminApi.getDashboard` ให้แสดงตัวเลขยอดขาย คำสั่งซื้อ คิวงาน และแนวโน้มจริง
  - `backend/Backend-VRU-Marketplace-main/src/admin/admin-platform.service.ts`: ปรับการส่ง broadcast notification เป็น batch ละ 50 รายการ ป้องกัน memory & connection spike

---

## 🔵 P3: Deploy Sync & ทดสอบครบทุกบทบาท (Verification Sign-off)

- [x] **15. Commit & Sync โค้ด Cleanup รอบล่าสุดขึ้น Production (`vm102` / `vm103`)** *(เสร็จสิ้น)*
  - Sync โค้ดฝั่ง Frontend `src/` ↔ `vm102/src/` ตรงกัน `0 diff`
  - Sync โค้ดฝั่ง Backend `backend/.../src/` ↔ `vm103/src/` ตรงกัน `0 diff`
  - อัปเดต `backup.sh` และเอกสารประกอบเรียบร้อย

- [ ] **16. ทดสอบ End-to-End ครบทั้ง 4 บทบาทบน Staging / Production**
  - **Automated Regression Checks:**
    - Root & `vm102`: `npx tsc --noEmit` และ `npm run lint` (`0 errors, 0 warnings`)
    - Backend & `vm103`: `npm run typecheck`, `npm run lint`, และ `npm test` (รัน regression suite 84+ spec files บน `vru_marketplace_test`)
  - **Manual / E2E Walkthrough ครบ Loop:**
    1. **Buyer:** สมัคร → ยืนยันอีเมลจริง → อ่าน `/privacy` & `/terms` → สั่งซื้อใช้คูปอง → ลองยกเลิก/ปฏิเสธค่าส่ง → อัปสลิป → เปิดข้อพิพาท → รับเงินคืน `REFUND_ORDERED` → `REFUNDED`
    2. **Seller:** ตั้งค่าร้าน/บัญชี → ใส่ค่าส่ง → ยืนยันเงิน/ปฏิเสธสลิป → อัปสลิปส่งของ + Tracking → อัปสลิปคืนเงิน → ทดสอบแชททั้งลูกค้าและแอดมินชุมชน
    3. **Community Admin:** อนุมัติร้าน/สินค้า → ตัดสิน Frozen Order & Dispute ผ่าน `DisputeDetailModal` (เช็ก Break-glass audit log)
    4. **Super Admin:** เช็กตัวเลข Dashboard จริง → จัดการแบนเนอร์/บทความผ่าน Upload Backend ใหม่ + Rebuild Docker container ยืนยันว่ารูปไม่หาย
    5. **Security & Infra Spot-check:** ตรวจ DevTools ว่า cookie เป็น `Secure; HttpOnly`, ลองยิง `/api/upload` เก่า (ต้อง 404/401), และตรวจไฟล์ backup ใน NAS + ทดสอบ restore จริง
