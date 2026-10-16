# VRU Marketplace — Backend

ตลาดออนไลน์ของชุมชน · ร้านค้าและสินค้าทุกอย่างสังกัด "ชุมชน" (community) เสมอ

Repo นี้เป็น **backend ล้วน** (NestJS + Prisma + PostgreSQL) · หน้าบ้านอยู่อีก repo
ติดต่อกันผ่าน REST + WebSocket เท่านั้น

> **สถานะ: ครบทั้ง 12 หัวข้อ 54 ticket แล้ว** (#14–#19 · #24–#71) **+ #73 · #74 · #75 ที่ตามมาทีหลัง**
> **และผ่าน `/code-review` ครบทุกใบแล้ว (2026-09-27)** — `docker compose up` ได้ API ที่ตอบ `/api/v1/health`
> · 1235 เทสต์ผ่าน (84 ไฟล์) · migration 62 ใบ
> · **ที่เหลือเป็นเรื่องที่ agent ทำแทนไม่ได้** (โดเมน #20 · ปลายทาง backup #21 · รับรอง privacy
> policy #22) · `docker compose up --build` ครบชุดพร้อม Nginx รันจริงแล้ว (#72 · §99)
> · **ขึ้นเครื่องจริง: [`ops/deploy/README.md`](./ops/deploy/README.md)**
> · ดู [`docs/PROGRESS.md`](./docs/PROGRESS.md) ว่าใบไหนเสร็จและเหลืออะไร —
> **ไฟล์นี้ไม่ใช่ source of truth ของความคืบหน้า** `PROGRESS.md` เท่านั้น

## สิ่งที่ทำให้ระบบนี้ไม่เหมือน e-commerce ทั่วไป

อ่านสามข้อนี้ก่อน ไม่งั้นจะออกแบบผิดทาง

1. **แพลตฟอร์มไม่เคยถือเงิน** — ผู้ซื้อโอนตรงเข้าบัญชีร้าน ระบบไม่รู้ว่าเงินเข้าจริงหรือไม่
   รู้แค่ว่า**ร้านกดยืนยันว่าได้รับแล้ว** · จึงไม่มี entity ชื่อ `Payment` และห้ามมีฟิลด์ชื่อ `paidAt`
2. **ร้านเป็นคนใส่ค่าส่งหลังผู้ซื้อกดสั่ง** — ตอนกดสั่งยังไม่รู้ยอดที่ต้องจ่าย
   ยอดรวมของออเดอร์จึง**ว่างได้ตอนสร้าง**
3. **นาฬิกาสามเรือน** — ร้านใส่ค่าส่ง 24 ชม. → ผู้ซื้อโอน 24 ชม. → ร้านยืนยันเงินเข้า 3 วัน
   · สต็อกถูกจองตลอดช่วงนั้น **ยาวได้ถึงประมาณ 13 วัน**

## อ่านอะไรก่อน

| ไฟล์ | ตอบคำถามว่า |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | **กฎคืออะไร** — invariant 9 ข้อ · คำศัพท์ · นิยามของ "เสร็จ" · กฎการเขียนโค้ด |
| [`docs/PROGRESS.md`](./docs/PROGRESS.md) | **ทำถึงไหนแล้ว** · source of truth ห้ามเดาจาก git log |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | **ทำไมถึงเป็นแบบนี้** · ทุกข้อที่ตัดสินไปแล้วพร้อมเหตุผล |
| [`docs/FRONTEND-NOTES.md`](./docs/FRONTEND-NOTES.md) | **ทีมหน้าบ้านต้องรู้อะไร** ก่อนมี API contract |

**ถ้าสองไฟล์ขัดกัน `DECISIONS.md` ชนะ** — มันคือบันทึกว่าเจ้าของโปรเจคตอบอะไรไว้จริง
แล้วให้ไปแก้ไฟล์ที่แพ้ ไม่ใช่เงียบแล้วทำตามข้อใดข้อหนึ่ง

## ลำดับงาน

| ลำดับ | ขั้น | สถานะ |
|---|---|---|
| 1 | ซักถามจนไม่เหลือข้อสงสัย (`/grill-with-docs`) | ✅ จบ → `docs/DECISIONS.md` (A–L รวม 5 รอบ) |
| 2 | เขียน spec (`/to-spec`) | ✅ จบ → GitHub issue [#1](../../issues/1) (ใบแม่) + #2–#13 |
| 3 | ตัด spec เป็น ticket (`/to-tickets`) | ✅ จบ → **54 ticket** · #14–#19 (หัวข้อ 1) + #24–#71 (หัวข้อ 2–12) |
| 4 | เขียนโค้ด (`/implement`) | ✅ **ครบทั้ง 12 หัวข้อ** (#14–#19 · #24–#71) **+ #73 · #74 · #75** |
| 5 | ตรวจงาน (`/code-review`) | ✅ ครบทุกใบแล้ว 2026-09-27 (12 หัวข้อ + #73–#75) |

**spec ไม่ได้อยู่ใน repo นี้** — อยู่เป็น GitHub issue ตามที่
[`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) กำหนด
· [#1](../../issues/1) เป็นใบแม่ที่ถือข้อตกลงร่วม · #2–#13 เป็นหนึ่งใบต่อหนึ่งหัวข้อ
· **ทั้ง 13 ใบถูกปิดแล้ว 2026-09-20** เพราะ ticket ย่อยครบหมด — เนื้อ spec ยังอ่านได้ตามปกติ
ในใบที่ปิดไปแล้ว (GitHub issue ที่ปิดไม่ได้หายไปไหน)

## สภาพแวดล้อมที่ต้องออกแบบเผื่อ

รันบนเซิร์ฟเวอร์มหาวิทยาลัยที่แรมจำกัด ผ่าน Docker Compose + Nginx

- **ไม่มี Redis** · **ไม่มี Elasticsearch** — ค้นหาด้วย **`pg_trgm` + GIN ไม่ใช่ `tsvector`**
  เพราะ PostgreSQL ไม่มี text-search configuration ของภาษาไทย (ดู N5 ใน `DECISIONS.md`)
- **สามอย่างนี้ผูกระบบไว้กับอินสแตนซ์เดียว** — cron ของนาฬิกา · Socket.io adapter
  ในหน่วยความจำ · ไฟล์อัปโหลดบน Docker volume · **สเกลออกเมื่อไหร่ต้องแก้ทั้งสามที่**
- ส่งอีเมลผ่าน Brevo หรือ SMTP (เลือกด้วย `EMAIL_TRANSPORT` · §107) หลัง interface `EmailSender` ตัวเดียว

## วิธีรัน

### ด้วย Docker Compose (ทางที่สั้นที่สุด)

```bash
cp .env.example .env        # แล้วเปิดแก้ — ค่าใน .env.example เป็นค่าหลอกทั้งหมด
docker compose up --build
curl http://localhost:3000/api/v1/health
```

**`docker-compose.yml` คือไฟล์ของเครื่องจริง** (§99) — ฐานข้อมูลไม่เปิดพอร์ตออกมาที่ host · API ฟังแค่
`127.0.0.1` · ต้องมี `POSTGRES_PASSWORD` ใน `.env` ไม่งั้น compose ไม่ยอมรัน · **บนเครื่องพัฒนา** ถ้าจะให้
`npm test` / `prisma migrate dev` ต่อฐานข้อมูลใน compose ได้ ให้ใส่ไฟล์ dev ด้วย:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
# หรือใส่ COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml ใน .env ของเครื่องตัวเอง
```

(`DATABASE_URL` ของ host ต้องใช้รหัสผ่านเดียวกับ `POSTGRES_PASSWORD` · Postgres อ่านรหัสผ่านตอนสร้าง volume
ครั้งแรกเท่านั้น — volume เก่าที่สร้างด้วยรหัส `postgres` ยังใช้รหัสเดิม)

ได้ API + PostgreSQL · ลำดับคือ `postgres` (รอ healthcheck) → **service `migrate` รัน
`prisma migrate deploy` แล้วจบ** → `api` สตาร์ต · ไฟล์อัปโหลดอยู่บน Docker volume ชื่อ `uploads` (K1)

> **ทำไม migration แยกเป็น service** — Prisma CLI เป็น devDependency image ของ runtime จึงไม่มีมัน
> โดยเจตนา (เล็กกว่า) · และถ้า migration ล้มเหลว การ deploy จะหยุดที่ขั้นนั้นให้เห็นชัด
> ไม่ใช่ดูเหมือน API บูตไม่ขึ้น

> ⚠️ **compose ตั้ง `NODE_ENV=production` ทับค่าใน `.env` ให้เสมอ** เพราะ `.env.example`
> เขียนว่า `development` และค่านั้นจะทำให้ **เอกสาร OpenAPI ทั้งฉบับถูกเสิร์ฟที่
> `/api/v1/docs` บนเครื่องที่ deploy** ซึ่งบรรยายทุก route ฝั่งแอดมินให้ใครก็อ่านได้
> · อยาก dev พร้อมเอกสาร ให้ใช้ `npm run start:dev` บนเครื่องตัวเองแทน

**สร้าง secret จริงก่อนใช้งานนอกเครื่องตัวเอง** — `openssl rand -hex 32` สำหรับทุกตัวที่เขียนว่า
`replace-me` · แอปจะ**ไม่บูต**ถ้าตัวแปรขาดหรือสั้นเกินไป และจะบอกว่าตัวไหน · **ในโหมด production
(ซึ่ง compose บังคับเสมอ) ค่าไหนยังมีคำว่า `replace-me` ก็ไม่บูต** (§99)

**ก่อนใช้งานจริงนอกเครื่องตัวเอง ตั้ง backup ด้วย** — ดู [`ops/backup/README.md`](./ops/backup/README.md)
(issue #21) · Postgres และ volume ไฟล์อัปโหลดอยู่บนดิสก์เดียวกัน ไม่มีใครสำรองให้ฟรี

### ด้วย Node บนเครื่อง (ตอนพัฒนา)

ต้องมี **Node 22+** และ PostgreSQL ที่เข้าถึงได้

```bash
npm ci
npx prisma generate                    # ต้องรันก่อน build/test ครั้งแรก
npm run start:dev
```

### คำสั่งที่ต้องรันเองก่อนบอกว่าเสร็จ

**โปรเจคนี้ยังไม่มี CI** ไม่มีอะไรรันให้อัตโนมัติ

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (เปิด type-aware rules ที่จับ `any` ที่ไม่ได้อธิบาย) |
| `npm test` | Vitest — **ต้องมี PostgreSQL จริง** ไม่ใช่ SQLite |
| `npm audit` | ต้องได้ 0 vulnerabilities |
| `npm run check` | typecheck + lint + test ต่อกัน |

**เทสต์ต้องมีฐานข้อมูลจริง** — ตั้ง `DATABASE_URL` ให้ชี้ DB ที่ทิ้งได้ (ค่าเริ่มต้นคือ
`vru_marketplace_test` บน localhost) · เทสต์ `TRUNCATE` ทุกตารางก่อนแต่ละเคส **อย่าชี้ไปที่ DB จริง**

### เอกสาร API

`/api/v1/docs` (และ JSON ที่ `/api/v1/docs-json`) · generate จาก DTO ด้วย `@nestjs/swagger` (M4)
· **ไม่เสิร์ฟตอน `NODE_ENV=production`** · **ไม่มี `docs/api.md` ที่เขียนด้วยมือ และห้ามสร้าง**

### ข้อที่พลาดแล้วเจ็บ

- ความลับอยู่ใน `.env` (gitignored) · `.env.example` **ไม่มีค่าจริง** · **ห้าม commit ค่าจริง**
  — secret ที่เข้า git แล้วลบไม่ออกจริง ต้องหมุนค่าใหม่ทั้งชุด
- migration เขียนแล้ว**ห้ามแก้ไฟล์เดิม** ให้เพิ่มไฟล์ใหม่แทน
- **NestJS 12 เป็น ESM ล้วน** — `import` แบบ relative **ต้องลงท้าย `.js`** (เช่น `./health.service.js`)
  แม้ไฟล์จริงจะเป็น `.ts` · เป็นแบบเดียวกับที่ `nest new` ของ CLI v12 generate ออกมา

## ใบอนุญาต

**สงวนลิขสิทธิ์ · ลิขสิทธิ์เป็นของมหาวิทยาลัยราชภัฏวไลยอลงกรณ์ ในพระบรมราชูปถัมภ์ แต่เพียงผู้เดียว**
ตามข้อ 9.2 และ 10.1 ของสัญญาจ้าง — ดู [`LICENSE`](./LICENSE) และเหตุผลที่ §64 ของ
[`docs/DECISIONS.md`](./docs/DECISIONS.md)

ผู้รับจ้างและบุคคลภายนอก**นำไปเผยแพร่ ทำซ้ำ ดัดแปลง หรือจำหน่ายต่อไม่ได้**
เว้นแต่ได้รับอนุญาตเป็นลายลักษณ์อักษรจากมหาวิทยาลัยฯ ก่อน

ข้อมูลจังหวัด–อำเภอ–ตำบล ใน `prisma/reference-data/thai-geography/` เป็นของ
`kongvut/thai-province-data` ภายใต้ใบอนุญาต MIT · **ห้ามลบ `LICENSE-upstream` ออกจากโฟลเดอร์นั้น**
