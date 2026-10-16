# 🛒 VRU Marketplace (ระยะที่ 2)

## โครงการพัฒนาแพลตฟอร์มตลาดออนไลน์ (Digital Marketplace) เพื่อยกระดับเศรษฐกิจและเพิ่มรายได้ชุมชนท้องถิ่น

มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ จังหวัดปทุมธานี

---

[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016-black?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/Backend-NestJS%2012-ea2845?logo=nestjs)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-336791?logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/ORM-Prisma%207-2d3748?logo=prisma)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Deployment-Docker%20Compose-2496ed?logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-VRU%20Proprietary-blue.svg)](https://vru.ac.th)

---

## 📖 สารบัญ (Table of Contents)

1. [ภาพรวมโครงการและวัตถุประสงค์ (Overview & Objectives)](#1-ภาพรวมโครงการและวัตถุประสงค์)
2. [ขอบเขตการดำเนินงานตาม TOR (TOR Scope of Work)](#2-ขอบเขตการดำเนินงานตาม-tor-ระยะที่-2)
3. [สถาปัตยกรรมระบบ 4 เครื่องเสมือน (System Architecture)](#3-สถาปัตยกรรมระบบ-4-vms-network-topology)
4. [โครงสร้างซอร์สโค้ด (Repository Structure)](#4-โครงสร้างซอร์สโค้ด)
5. [เทคโนโลยีที่ใช้พัฒนา (Technology Stack)](#5-เทคโนโลยีที่ใช้พัฒนา)
6. [คู่มือการติดตั้งและรันระบบ (Setup & Installation)](#6-คู่มือการติดตั้งและรันระบบ)
7. [ข้อมูลบัญชีสำหรับทดสอบตรวจรับงาน (Handover Credentials Matrix)](#7-ข้อมูลบัญชีสำหรับตรวจรับงาน)
8. [ความปลอดภัยและการปฏิบัติตาม PDPA (Security & Compliance)](#8-มาตรฐานความปลอดภัยและ-pdpa)
9. [การรับประกันและระดับการให้บริการ (Warranty & SLA)](#9-การรับประกันและการบำรุงรักษาระบบ)

---

## 1. ภาพรวมโครงการและวัตถุประสงค์

โครงการพัฒนาแพลตฟอร์มตลาดออนไลน์ (VRU Marketplace ระยะที่ 2) มีเป้าหมายในการต่อยอดระบบพาณิชย์อิเล็กทรอนิกส์ (E-Commerce) เพื่อขับเคลื่อนพันธกิจของมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ ในการส่งเสริมและสนับสนุนผู้ประกอบการวิสาหกิจชุมชน ยกระดับขีดความสามารถการแข่งขันตามเป้าหมายการพัฒนาที่ยั่งยืน (SDGs: SDG 1, SDG 8, SDG 9, SDG 11) ขยายช่องทางการจำหน่ายผลิตภัณฑ์อัตลักษณ์ชุมชน และสร้างฐานข้อมูลเชิงพื้นที่เพื่อติดตามผลกระทบทางเศรษฐกิจอย่างยั่งยืน

---

## 2. ขอบเขตการดำเนินงานตาม TOR (ระยะที่ 2)

ระบบได้รับการพัฒนาครอบคลุมตามข้อกำหนดในเอกสาร TOR ข้อ 6 อย่างครบถ้วน:

* **6.1 การพัฒนาระบบส่วนหน้าและการจัดการร้านค้า (Front-end & Merchant Portal):**
  * **6.1.1 - 6.1.2 Storefront & Responsive UI/UX:** หน้าเว็บตลาดออนไลน์ ดีไซน์ทันสมัย รองรับคอมพิวเตอร์ แท็บเล็ต และสมาร์ทโฟน
  * **6.1.3 Search & Shopping Cart:** ค้นหา คัดกรองสินค้าตามหมวดหมู่และตามชุมชน ตะกร้าสินค้า และขั้นตอนการสั่งซื้อที่สะดวก
  * **6.1.4 - 6.1.5 Merchant Management:** ระบบลงทะเบียนและจัดการโปรไฟล์ร้านค้า รองรับการเข้าร่วมมากกว่า 20 ชุมชน
  * **6.1.6 Product Catalog:** จัดการรายการสินค้า อัตลักษณ์ชุมชน รูปภาพ และราคาจำหน่าย
  * **6.1.7 Inventory Management:** คำนวณและตัดสต็อกสินค้าอัตโนมัติเมื่อมีการสั่งซื้อและยืนยันการชำระเงิน
* **6.2 การพัฒนาระบบบริหารจัดการหลังบ้านและการพาณิชย์ (Backend & Core e-Commerce Engine):**
  * **6.2.1 - 6.2.3 Digital Payment:** รองรับการชำระเงินออนไลน์ (พร้อมเพย์/โอนเงิน) แนบหลักฐานสลิป ตรวจสอบยอด และแจ้งเตือนสถานะ
  * **6.2.4 - 6.2.6 Order & Logistics:** จัดการสถานะคำสั่งซื้อครบวงจร (รอชำระ, ชำระแล้ว, จัดส่ง, สำเร็จ, ยกเลิก/ข้อพิพาท) พร้อมระบบบันทึกเลขพัสดุและลิงก์ติดตาม
  * **6.2.7 - 6.2.9 Marketing & Promotions:** ระบบโค้ดส่วนลด (Coupon/Promo Code) ทั้งแบบเปอร์เซ็นต์และจำนวนเงิน พร้อมป้ายแบนเนอร์และบทความประชาสัมพันธ์
* **6.3 การจัดการโครงสร้างพื้นฐาน ฐานข้อมูล และความปลอดภัย (Infrastructure & Security):**
  * **6.3.1 Database Integration:** จัดเก็บและสำรองฐานข้อมูลบนเซิร์ฟเวอร์ตามมาตรฐานศูนย์คอมพิวเตอร์ พร้อมไฟล์สำรอง (`vru_backup.sql`)
  * **6.3.2 Security & PDPA:** ใช้งานผ่าน HTTPS/TLS, ระบบกำหนดสิทธิ์ตามบทบาท (RBAC: Super Admin, Community Admin, Seller, Buyer), ระบบยินยอมและคุ้มครองข้อมูลส่วนบุคคลตาม พ.ร.บ. PDPA

---

## 3. สถาปัตยกรรมระบบ (4 VMs Network Topology)

ระบบทำงานบนโครงสร้างเครือข่ายเสมือน 4 เครื่อง (4 Virtual Machines) เพื่อแยกหน้าที่และเพิ่มความมั่นคงปลอดภัยตามมาตรฐานสากล:

```text
                            [ คณะกรรมการ / ผู้ใช้งานภายนอก ]
                                           │
                                           ▼ (Port 80/443)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  VM 101: 172.16.90.101 (Reverse Proxy & Edge Gateway)                                  │
│  • Nginx Proxy Manager                                                                 │
│  • SSL/TLS Termination, WebSocket Support, Rate Limiting & Proxy Routing               │
└──────────────────┬─────────────────────────────────────────────────┬───────────────────┘
                   │ /                                               │ /api/v1/
                   ▼ (Port 3000)                                     ▼ (Port 3001)
┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  VM 102: 172.16.90.102 (Frontend Application)│  │  VM 103: 172.16.90.103 (Backend API) │
│  • Next.js 16 (React 19 / Turbopack)         │  │  • NestJS 12 + Prisma 7 ORM          │
│  • Responsive Tailwind UI & Components       │  │  • Core e-Commerce Engine            │
│  • Dockerized Production Container           │  │  • WebSocket Live Chat Gateway       │
└──────────────────────────────────────────────┘  └──────────────────┬───────────────────┘
                                                                     │ Database URL
                                                                     ▼ (Port 5433)
                                                  ┌──────────────────────────────────────┐
                                                  │  VM 104: 172.16.90.104 (Database)    │
                                                  │  • PostgreSQL 16                     │
                                                  │  • 20 วิสาหกิจชุมชน, สต็อก, สินค้า   │
                                                  │  • pg_trgm Search Indexes            │
                                                  └──────────────────────────────────────┘
```

---

## 4. โครงสร้างซอร์สโค้ด

```text
Vru-marketplace-main/
├── src/                               # ซอร์สโค้ดระบบหน้าบ้าน (Next.js 16 Frontend)
│   ├── app/                           # Next.js App Router (เส้นทางหน้าเว็บทั้งหมด 34 เส้นทาง)
│   │   ├── (auth)/                    # ล็อกอิน สมัครสมาชิก และลืมรหัสผ่าน
│   │   ├── admin/                     # คอนโซลแอดมินชุมชน (บทความ, แบนเนอร์, ชุมชน)
│   │   ├── seller/                    # พอร์ทัลผู้ขาย (สินค้า, ออเดอร์, คูปอง, แชท, ตั้งค่าร้าน)
│   │   ├── super-admin/               # คอนโซลผู้ดูแลระบบสูงสุด (Super Admin Dashboard)
│   │   ├── products/                  # รายการสินค้าและการค้นหา
│   │   ├── shops/                     # หน้าร้านค้าชุมชน
│   │   ├── orders/                    # จัดการคำสั่งซื้อและข้อพิพาทฝั่งผู้ซื้อ
│   │   └── chat/                      # ระบบแชทสดเรียลไทม์
│   ├── components/                    # คอมโพเนนต์ UI (Header, Footer, Cart, ProductCard)
│   └── lib/                           # คลาสและโมดูลเชื่อมต่อ API, AuthContext, Image Mappers
├── backend/Backend-VRU-Marketplace-main/ # ซอร์สโค้ดระบบหลังบ้าน (NestJS 12 Backend API)
│   ├── src/                           # โมดูลธุรกิจ (Auth, Order, Product, Shop, Community, etc.)
│   ├── prisma/                        # Prisma Schema, Migrations และชุดข้อมูลทดสอบ (Seeds)
│   └── docs/                          # เอกสารข้อตกลงและการออกแบบระบบ (CLAUDE, DECISIONS, PROGRESS)
├── public/                            # รูปภาพอัตลักษณ์สินค้าชุมชนและโลโก้ (Local Photorealistic Assets)
├── vm101/                             # สคริปต์และการตั้งค่า Nginx Gateway (VM 101)
├── vm102/                             # การตั้งค่า Dockerfile & Docker Compose สำหรับ Frontend (VM 102)
├── vm103/                             # การตั้งค่า Dockerfile & Docker Compose สำหรับ Backend (VM 103)
├── scripts/                           # สคริปต์ตรวจเช็คความพร้อมระบบ (doctor.mjs, data-flow verification)
├── vru_backup.sql                     # ไฟล์สำรองฐานข้อมูล PostgreSQL ฉบับสมบูรณ์ (Database Backup)
├── DEPLOYMENT_HANDOVER.md             # เอกสารคู่มือการขึ้นระบบและข้อมูลตรวจรับงานฉบับละเอียด
└── docker-compose.yml                 # การรันระบบผ่าน Docker บนเครื่องนักพัฒนา (Local Dev)
```

---

## 5. เทคโนโลยีที่ใช้พัฒนา

* **Frontend:** Next.js 16 (App Router), React 19, TypeScript, TailwindCSS, FontAwesome 6
* **Backend:** NestJS 12, TypeScript, Socket.io (WebSocket Live Chat), Nodemailer (SMTP), Brevo API
* **Database & ORM:** PostgreSQL 16, Prisma 7, pg_trgm (Full-text search)
* **DevOps & Containers:** Docker, Docker Compose, Nginx Proxy Manager, Alpine Linux
* **Quality Assurance:** Vitest, ESLint (Flat Config), Prettier, Strict TypeScript Checking

---

## 6. คู่มือการติดตั้งและรันระบบ

### 6.1 การรันระบบบนเครื่องนักพัฒนา (Local Development)

#### 1. ข้อกำหนดเบื้องต้น (Prerequisites)

* Node.js v20.x หรือ v22.x LTS
* PostgreSQL 16 (เปิดพอร์ต 5433 หรือ 5432)
* Docker & Docker Compose (ตัวเลือก)

#### 2. ขั้นตอนการรัน Backend

```bash
cd backend/Backend-VRU-Marketplace-main
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed-all     # โหลดข้อมูลชุมชน ร้านค้า และสินค้าทดสอบ
npm run start:dev       # เริ่มทำงานที่ http://localhost:3001
```

#### 3. ขั้นตอนการรัน Frontend

```bash
# กลับมาที่ root โฟลเดอร์
cp .env.example .env.local
npm install
npm run dev             # เริ่มทำงานที่ http://localhost:3000
```

---

### 6.2 การขึ้นระบบบนเครื่องแม่ข่ายจริง (Production VM Deployment)

1. **VM 104 (Database):** รัน PostgreSQL 16 บนพอร์ต 5433 และนำเข้าฐานข้อมูลด้วยคำสั่ง:

   ```bash
   psql -U postgres -p 5433 -d vru_marketplace < vru_backup.sql
   ```

2. **VM 103 (Backend):** คัดลอกโฟลเดอร์ `vm103` ไปยังเซิร์ฟเวอร์แล้วสั่งรันด้วย Docker Compose:

   ```bash
   cd ~/vm103 && docker compose up -d --build
   ```

3. **VM 102 (Frontend):** คัดลอกโฟลเดอร์ `vm102` ไปยังเซิร์ฟเวอร์แล้วสั่งรันด้วย Docker Compose:

   ```bash
   cd ~/vm102 && docker compose up -d --build
   ```

4. **VM 101 (Nginx Gateway):** ตั้งค่า Proxy Host ชี้โดเมน/IP ไปยัง VM 102 (พอร์ต 3000) และเส้นทาง `/api/v1/` ไปยัง VM 103 (พอร์ต 3001) ตามคู่มือใน `vm101/NPM_SETUP_GUIDE.md`

---

## 7. ข้อมูลบัญชีสำหรับตรวจรับงาน

เข้าใช้งานผ่านหน้าเข้าสู่ระบบ: **`/login`**

| บทบาท (Role) | อีเมลเข้าสู่ระบบ | รหัสผ่าน (Password) | สิทธิ์และหน้าที่หลักในระบบ |
| :--- | :--- | :--- | :--- |
| 🛡️ **Super Admin** | `superadmin@vru.ac.th` | `SuperAdmin@VRU2026!` | ดูแลระบบทั้งหมด, อนุมัติชุมชนใหม่, แบนเนอร์, บทความ, ข้อพิพาท, Audit Log |
| 🏛️ **Admin ชุมชน** | `community.admin@vru.ac.th` | `Admin@VRU2026` | ดูแลวิสาหกิจชุมชน, อนุมัติร้านค้าใหม่, ตรวจสอบสินค้า, ตัดสินข้อพิพาท |
| 🏪 **Seller (ร้านค้าเปิดแล้ว)** | `seller.demo@vru.ac.th` | `Seller@VRU2026` | แดชบอร์ดร้านค้า, ออเดอร์ทุกสถานะ, สต็อก, คูปองส่วนลด, แชทกับลูกค้า |
| ⏳ **Seller (ผู้ขอเปิดร้าน)** | `seller.pending@vru.ac.th` | `Seller@VRU2026` | ทดสอบมุมมองร้านค้ารอการตรวจสอบอนุมัติจากแอดมินชุมชน |
| 🛒 **Buyer (ผู้ซื้อ)** | `buyer.demo@vru.ac.th` | `Buyer@VRU2026` | ค้นหาสินค้า, ตะกร้าสินค้า, สั่งซื้อ, ชำระเงิน, แนบสลิป, รีวิวสินค้า |

---

## 8. มาตรฐานความปลอดภัยและ PDPA

1. **การควบคุมการเข้าถึงตามบทบาท (RBAC):** กำหนดสิทธิ์แยกชั้นระหว่างผู้ซื้อ ผู้ขาย แอดมินชุมชน และผู้ดูแลระบบสูงสุดอย่างรัดกุม
2. **การเข้ารหัสความปลอดภัย:** รหัสผ่านทุกบัญชีถูกเข้ารหัสด้วยฟังก์ชันแฮชทางเดียวความปลอดภัยสูง ข้อมูลเซสชันทำงานผ่าน `httpOnly` Cookies ป้องกันการโจมตีแบบ XSS
3. **การคุ้มครองข้อมูลส่วนบุคคล (PDPA Compliance):**
   * มีกล่องข้อความขอความยินยอมรับนโยบายความเป็นส่วนตัว (Privacy Policy) และข้อกำหนดการใช้งาน (Terms of Service) ในขั้นตอนลงทะเบียน
   * มีฟังก์ชันขอใช้สิทธิลบข้อมูลส่วนบุคคล (Right to Erasure) และเก็บบันทึกประวัติ (Audit Log) ครบถ้วน

---

## 9. การรับประกันและการบำรุงรักษาระบบ

* **ระยะเวลารับประกัน (Warranty Period):** 1 ปี นับถัดจากวันที่คณะกรรมการตรวจรับพัสดุได้ลงนามตรวจรับมอบงานเรียบร้อยแล้ว โดยไม่มีค่าใช้จ่ายเพิ่มเติม (ตาม TOR ข้อ 8.1)
* **ช่องทางประสานงานทางเทคนิค (Technical Support):** โทรศัพท์, อีเมล และแอปพลิเคชัน Line (ตาม TOR ข้อ 8.2)
* **ระดับการให้บริการ (SLA ตาม TOR ข้อ 8.3):**
  * กรณีเร่งด่วน (Critical Error): เริ่มแก้ไขภายใน 4 ชั่วโมง และแล้วเสร็จภายใน 24 ชั่วโมง
  * กรณีปัญหาทั่วไป (Non-Critical Error): เริ่มแก้ไขภายใน 24 ชั่วโมง และแล้วเสร็จภายใน 3 วันทำการ
* **การปรับปรุงความปลอดภัย:** อัปเดตแพตช์ความปลอดภัย (Security Patches) ตลอดระยะเวลารับประกัน

---

> จัดทำโดย: ทีมพัฒนาแพลตฟอร์มตลาดออนไลน์ มหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ (VRU Marketplace Phase 2)
