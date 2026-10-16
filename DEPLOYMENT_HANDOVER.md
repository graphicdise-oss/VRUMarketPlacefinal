# 🚀 สรุปข้อมูลส่งมอบและคู่มือการขึ้น Server (VRU Marketplace Deployment & Handover Guide)

เอกสารฉบับนี้สรุปสถานะความพร้อม บัญชีสำหรับตรวจรับงาน (ครบทุกบทบาทและทุก Scenario) ผลการตรวจเช็คระบบ (Doctor & Verifier) และขั้นตอนการนำขึ้น Server มหาวิทยาลัยราชภัฏวไลยอลงกรณ์

---

## 1. สถานะความพร้อมและความปลอดภัยของระบบ (System Doctor & Production Readiness)

- ✅ **System Doctor (9/9 Endpoints Passed)**: ตรวจสอบความพร้อมของ API (Health, Products, Categories, Communities, Coupons) และ Frontend Routes หลัก ทำงานปกติ 100%
- ✅ **Database Migration & Schema Sync**: รัน Migration Catch-up ครบถ้วน (`20261014060000_catch_up_schema_drift` และ `20261014060100_restore_trgm_search_indexes`) ซิงค์ Schema ทั้งตาราง Banner, Article, Coupon, Chat Abuse Report, Dispute ครบ 100% โดยไม่มี Schema Drift
- ✅ **Database Safety & Test Isolation**: เพิ่ม Hard Guard ในระบบ Test Runner (`test/helpers/database.ts` และ `test/helpers/global-setup.ts`) ล็อกให้ Vitest รันกับ `vru_marketplace_test` เท่านั้น และบล็อกคำสั่ง `truncateAllTables()` ทันทีหากชื่อ Database ไม่ลงท้ายด้วย `_test` เพื่อรับประกันว่าข้อมูลจริงและข้อมูลจำลองบน Production / Dev จะไม่มีวันถูกลบโดยไม่ตั้งใจ
- ✅ **Data Integrity & Consistency (0 FAIL)**: ข้อมูลจำลองผ่านการคำนวณ `total = items - discount + shipping` ถูกต้องตามหลักบัญชีทุกออเดอร์ ไม่มี Stock ติดลบ และยอด Claim คูปองสอดคล้องกับฐานข้อมูลจริง
- ✅ **Frontend (Next.js 16)**: TypeCheck ผ่าน 100% (Zero TypeScript errors)
- ✅ **Backend (NestJS 12 + Prisma 7)**: TypeCheck ผ่าน 100% (Zero TypeScript errors)
- ✅ **ความสะอาดของโปรเจกต์**: ถอด Hardcoded Demo Chat และ Fallback Mock Data ออกหมดแล้ว ระบบเชื่อมต่อกับฐานข้อมูล PostgreSQL จริงทั้งหมด

---

## 2. ข้อมูลบัญชีสำหรับตรวจรับงานครบทุก Role (Handover Credentials Matrix)

เข้าใช้งานผ่านหน้าเข้าสู่ระบบจริง: `/login`

| บทบาท (Role) | อีเมลเข้าสู่ระบบ | รหัสผ่าน (Password) | สิทธิ์และหน้าจอหลัก |
| :--- | :--- | :--- | :--- |
| 🛡️ **Super Admin** | `superadmin@vru.ac.th` หรือ `super@vru.ac.th` | `SuperAdmin@VRU2026!` | จัดการระบบทั้งหมด, ชุมชน, แบนเนอร์, บทความ, ข้อพิพาท, รายงานแชท |
| 🏛️ **Admin ชุมชน** | `community.admin@vru.ac.th` | `Admin@VRU2026` | ดูแล 4 วิสาหกิจชุมชน, อนุมัติร้านค้า, ตรวจสอบสินค้า, ระงับข้อพิพาท |
| 🏪 **Seller (ร้านเปิดแล้ว)** | `seller.demo@vru.ac.th` (และ seller2 - seller6) | `Seller@VRU2026` | แดชบอร์ดร้านค้า, ออเดอร์ทุกสถานะ, คูปอง, แชท, รีวิว, สต็อกสินค้า |
| ⏳ **Seller (รอเปิดร้าน)** | `seller.pending@vru.ac.th` | `Seller@VRU2026` | ตรวจสอบมุมมองผู้สมัคร: แจ้งเตือนรอการตรวจสอบอนุมัติจากแอดมิน |
| 🛒 **Buyer (ผู้ซื้อ)** | `buyer.demo@vru.ac.th` | `Buyer@VRU2026` | ตะกร้าสินค้า, คูปองพร้อมใช้, รายการโปรด, ออเดอร์สำเร็จรอเขียนรีวิว |

### รายละเอียดข้อมูลสำหรับตรวจรับงานในแต่ละบทบาท

#### 🛡️ 1. Super Admin (`superadmin@vru.ac.th` / `super@vru.ac.th`)

- เข้าถึงหน้าคอนโซล: `/super-admin`
- ตรวจสอบชุมชน 4 แห่ง, จัดการแบนเนอร์หน้าแรก (3 แบนเนอร์), จัดการบทความความรู้ (5 บทความ)
- **อนุมัติ/ปฏิเสธคำขอเปิดชุมชนใหม่**: มีรายการ `PENDING` รอพิจารณา 1 รายการ ("ชุมชนคนรักกาแฟโบราณและของหวานคลองหนึ่ง") ให้ทดสอบปุ่มอนุมัติหรือปฏิเสธ
- **จัดการรายงานการแชท (Chat Moderation)**: มีรายงาน `PENDING` รอตรวจสอบ 1 รายการ ("มีพฤติกรรมใช้ถ้อยคำไม่สุภาพ")
- ตรวจสอบ Audit Log และรายชื่อผู้ดูแลชุมชน

#### 🏛️ 2. Admin ชุมชน (`community.admin@vru.ac.th`)

- เข้าถึงหน้าคอนโซล: `/admin`
- ดูแล 4 วิสาหกิจชุมชนในเครือข่าย มรว.
- **อนุมัติร้านค้าใหม่**: มีใบสมัครร้านค้าใหม่สถานะ `PENDING` รออนุมัติ ("ร้านเครื่องปั้นดินเผาและเบญจรงค์ มรว.") ให้ทดสอบกดอนุมัติเปิดร้าน
- **ตรวจสอบสินค้า**: มีสินค้าสถานะ `PENDING` (6 รายการ), `APPROVED` (18 รายการ), `REJECTED` (6 รายการ)
- **ระงับข้อพิพาท (Dispute Resolution)**: มีข้อพิพาทจริง 1 รายการ (สินค้าชำรุดจากการขนส่ง มีข้อความโต้ตอบระหว่างผู้ซื้อ-ผู้ขาย) สามารถพิจารณาตัดสิน `BUYER_WINS` หรือ `SHOP_WINS` ได้ทันที

#### 🏪 3. Seller - ร้านค้าที่เปิดแล้ว (`seller.demo@vru.ac.th` และ `seller2` ถึง `seller6`)

- เข้าถึงหน้าร้านค้า: `/seller`
- ร้านค้าหลัก: "ร้านสวนส้มและเกษตรอินทรีย์ มรว." (สถานะ `APPROVED` มีช่องทางชำระเงินพร้อม)
- **ครอบคลุมทุกแท็บสถานะคำสั่งซื้อ**: รอใส่ค่าส่ง (2), รอยืนยันสลิปโอน (1), รอจัดส่ง (1), รอผู้ซื้อกดรับของ (1), สำเร็จ (2), ขอคืนเงิน/พิพาท (1), คืนเงินแล้ว (1), ยกเลิก (1)
- มีคูปองส่วนลดที่ใช้งานได้จริง (`ORANGE50`, `VRU15`, `FRESH20` ฯลฯ)
- มีคะแนนรีวิว, ข้อความแชทกับผู้ซื้อ, การแจ้งเตือน และผู้ติดตามร้านค้า

#### ⏳ 4. Seller - ผู้รอเปิดร้าน (`seller.pending@vru.ac.th`)

- เข้าสู่ระบบเพื่อทดสอบมุมมองของผู้สมัครร้านค้าใหม่
- แสดงหน้าจอแจ้งเตือนสถานะ: "ใบสมัครเปิดร้านค้ากำลังรอการตรวจสอบโดยแอดมินชุมชน"

#### 🛒 5. Buyer - ผู้ซื้อ (`buyer.demo@vru.ac.th`)

- เข้าถึงหน้า: `/orders`, `/cart`, `/profile`
- บันทึกที่อยู่จัดส่งจริงในระบบเรียบร้อยแล้ว
- **มีสินค้าในตะกร้า 2 รายการ** พร้อมทดสอบ Checkout ชำระเงินได้ทันที
- **มีสินค้าในรายการโปรด (Wishlist)** 3 รายการ
- **เก็บคูปองส่วนลดพร้อมใช้** (`ORANGE50`, `VRU15`, `CRAFT10`)
- **มีออเดอร์สถานะ COMPLETED ที่ยังไม่ได้รีวิว** พร้อมให้ทดสอบกดปุ่ม "เขียนรีวิว" และให้คะแนนร้านค้า
- มีห้องแชทพูดคุยกับร้านค้า และการแจ้งเตือนคำสั่งซื้อ

---

## 3. คำสั่งสำคัญประจำระบบ (Key Operational Commands)

### ฝั่ง Backend (`backend/Backend-VRU-Marketplace-main` หรือ `vm103`)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. Deploy Database Migrations ทั้งหมด (รวม Catch-up Migration ล่าสุด)
npm run prisma:deploy

# 3. Seed ข้อมูลทดสอบแบบครบวงจรในคำสั่งเดียว (Reference Data + 4 Roles + Coupons + QA Scenarios)
npm run db:seed-all

# 4. ตรวจสอบความสมบูรณ์ของข้อมูลในฐานข้อมูล (Verifier Tool - Read Only)
npm run db:verify

# 5. คำสั่งล้างข้อมูลทดสอบในวัน Go-Live จริง (ล้างเกลี้ยง เหลือเฉพาะ Super Admin จริง)
npm run db:clean-mock

# 6. Build และ Start Production
npm run build
npm run start:prod
```

### ฝั่ง Frontend (Root หรือ `vm102`)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. ตรวจสอบ TypeCheck
npm run typecheck

# 3. Build และ Start Production
npm run build
npm run start
```

---

## 4. แผนการเปลี่ยนผ่านในวัน Go-Live จริง (Day 1 Go-Live Wipe Protocol)

เมื่อตรวจรับงานเสร็จสิ้นและพร้อมเปิดให้บริการจริง ให้รันคำสั่งเพียง 1 บรรทัดบน Server:

```bash
cd backend/Backend-VRU-Marketplace-main   # หรือ cd vm103
npm run db:clean-mock
```

**ผลลัพธ์ทันที:**

- ล้างข้อมูลจำลอง ออเดอร์ สินค้า ร้านค้า และบัญชีทดสอบทิ้งทั้งหมด 100%
- คงเหลือหมวดหมู่สินค้า 11 หมวด ขนส่ง 6 เจ้า 77 จังหวัด และบัญชี Super Admin ตัวจริง
- **ไม่ต้องแก้ไขโค้ดและไม่ต้อง Rebuild ใดๆ ทั้งสิ้น**

---

## 5. คู่มือการขึ้นระบบด้วย Docker บน 4 VM (Multi-VM Docker Deployment)

โครงสร้างระบบจำแนกตาม IP ในวงแลนจริงของมหาวิทยาลัย:

- **VM 101** (`172.16.90.101`): Gateway / Nginx Proxy Manager (NPM)
- **VM 102** (`172.16.90.102`): Frontend (Next.js 16 App Router)
- **VM 103** (`172.16.90.103`): Backend API (NestJS 12 + Prisma 7)
- **VM 104** (`172.16.90.104`): Database (PostgreSQL 16)

---

### โฟลเดอร์แพ็คเกจพร้อม Deploy ที่เตรียมไว้ให้

- 📂 โฟลเดอร์ `vm102/` : สำหรับนำไปวางและสั่งรันบนเครื่อง **172.16.90.102**
- 📂 โฟลเดอร์ `vm103/` : สำหรับนำไปวางและสั่งรันบนเครื่อง **172.16.90.103** (พร้อม Migrations ล่าสุด)
- 📦 ไฟล์ `update-src.tar.gz` : ซอร์สโค้ดฝั่ง Frontend ล่าสุดสำหรับอัปเดตเครื่อง VM 102 อย่างรวดเร็ว
- 📄 คู่มือ `vm101/NPM_SETUP_GUIDE.md` : วิธีตั้งค่า Proxy Host บนหน้า Web UI ของ Nginx Proxy Manager

---

### ขั้นตอนที่ 1: ตรวจสอบฐานข้อมูลบน VM 104 (`172.16.90.104`)

- PostgreSQL 16 ทำงานบนพอร์ต `5432` (หรือ `5433` ตามที่คอนฟิกไว้)
- ตรวจสอบชื่อฐานข้อมูล (`vru_marketplace`) และรหัสผ่าน `POSTGRES_PASSWORD`

---

### ขั้นตอนที่ 2: ติดตั้ง Backend บน VM 103 (`172.16.90.103`)

1. ก๊อปปี้โฟลเดอร์ `vm103/` ไปที่เครื่อง `172.16.90.103`
2. เข้าไปยังโฟลเดอร์:

   ```bash
   cd vm103
   ```

3. ตรวจสอบ `DATABASE_URL` ในไฟล์ `.env` ให้เชื่อมต่อกับ VM 104 ได้ถูกต้อง
4. รัน Build, Migrate และเริ่ม Service ด้วยคำสั่ง:

   ```bash
   docker compose up -d --build
   ```

5. รัน Database Migrations:

   ```bash
   docker compose run --rm migrate npx prisma migrate deploy
   ```

6. Seed ข้อมูลตั้งต้นและข้อมูลจำลองครบทุกบทบาทสำหรับตรวจรับงาน:

   ```bash
   docker compose run --rm migrate npm run db:seed-all
   ```

7. ตรวจสอบสถานะการทำงาน:

   ```bash
   docker compose ps
   curl http://localhost:3001/api/v1/health
   # คำตอบ: {"status":"ok"}
   ```

---

### ขั้นตอนที่ 3: ติดตั้ง Frontend บน VM 102 (`172.16.90.102`)

1. ก๊อปปี้โฟลเดอร์ `vm102/` ไปที่เครื่อง `172.16.90.102` (หรือแตกไฟล์ `update-src.tar.gz` ลงในโฟลเดอร์งาน)
2. เข้าไปยังโฟลเดอร์:

   ```bash
   cd vm102
   ```

3. รัน Build และเริ่ม Service:

   ```bash
   docker compose up -d --build
   ```

4. ตรวจสอบสถานะ:

   ```bash
   docker compose ps
   curl http://localhost:3000
   ```

---

### ขั้นตอนที่ 4: ตั้งค่า Gateway บน VM 101 (Nginx Proxy Manager: `172.16.90.101`)

1. เปิด Web UI ของ NPM ที่ `http://172.16.90.101:81`
2. ไปที่ **Proxy Hosts** ➔ **Add Proxy Host**:
   - **Domain Names:** `172.16.90.101`
   - **Forward Host / IP:** `172.16.90.102` | **Port:** `3000`
   - ✅ ติ๊กถูก: **Websockets Support**, **Cache Assets**, **Block Common Exploits**
3. ไปที่แถบ **Custom Locations**:
   - Location 1: `/api/v1/socket.io/` ➔ ส่งไป `172.16.90.103:3001`
   - Location 2: `/api/v1/` ➔ ส่งไป `172.16.90.103:3001` (ใส่ `client_max_body_size 110m;`)
4. กด **Save**
5. เข้าใช้งานผ่านเบราว์เซอร์: `http://172.16.90.101`
