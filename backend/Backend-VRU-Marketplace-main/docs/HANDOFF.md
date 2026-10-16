# Handoff — สำหรับ agent/คนที่เพิ่งเข้ามาต่องาน

**ไฟล์นี้เป็นภาพรวมชั่วขณะ ไม่ใช่ source of truth** — ปรับล่าสุด 2026-09-30 เพื่อช่วยให้ agent
ตัวใหม่ (หรือคนใหม่) เริ่มงานได้เร็วขึ้น ถ้าเนื้อหาที่นี่ขัดกับไฟล์ด้านล่าง **ให้เชื่อไฟล์เหล่านั้นก่อนเสมอ**
โดยเฉพาะ `docs/PROGRESS.md` ซึ่งเป็น source of truth ตัวจริงตาม `CLAUDE.md`

## อ่านตามลำดับนี้ก่อนเริ่มงานจริง

1. **`CLAUDE.md`** (root ของ repo) — กฎ/invariant ทั้งหมด อ่านให้ครบก่อนเขียนโค้ดบรรทัดแรก
2. **`docs/PROGRESS.md`** — ทำถึงไหนแล้ว (มี Changelog ละเอียดทุก ticket ที่เสร็จ)
3. **`docs/DECISIONS.md`** — ทำไมถึงตัดสินใจแบบนี้ (มีเลขข้ออ้างอิงในโค้ดคอมเมนต์ เช่น "ดู DECISIONS.md ข้อ 42")
4. **`docs/FRONTEND-NOTES.md`** — ถ้างานถัดไปแตะ endpoint/response shape ต้องอัปเดตไฟล์นี้ด้วยทันที

ไฟล์นี้ (`HANDOFF.md`) อยู่ในตาราง "อ่านอะไรก่อน" ของ `CLAUDE.md` เป็นแถวสุดท้าย — เป็นไฟล์เสริม
ไม่ได้แทนที่ไฟล์ไหนข้างบน และ**ไม่ใช่ source of truth** ขัดกับสามไฟล์บนเมื่อไหร่ให้เชื่อสามไฟล์บน

## สถานะ ณ ตอนเขียน (2026-10-01)

- **โค้ดครบทั้ง 12 หัวข้อ 54 ticket แล้ว** (#14–#19 · #24–#71) **+ #73 (โปรไฟล์ร้าน) · #74
  (admin-assisted erasure) · #75 (ยอมรับ privacy policy)** ที่ตามมาทีหลัง
- **`/code-review` ไล่หนี้ครบทุกใบแล้ว 2026-09-27** — 12 หัวข้อ + #73–#75 · ผลอยู่ที่ `DECISIONS.md`
  §70–§86 และตารางใน `PROGRESS.md` · ข้อสังเกตนอกขอบเขตที่รีวิวทิ้งไว้ปิดครบใน §87
- **หลังจากนั้น §88–§115 เสร็จครบ** (§105–§115 = ไล่ช่องโหว่ทีละพื้นที่ตามเจ้าของสั่ง + ปิดของค้างเล็ก)
- **ก่อนหน้านั้น §88–§104** — ฟีเจอร์ที่เจ้าของขอ (แชทแก้/ยกเลิก §89 · ToS §90 · access log + อายุ §98 · คิวแอดมิน §102) ·
  race §91/§95 · ซักความปลอดภัยครบสี่ส่วน (§93–§102) · ขึ้นเครื่องจริง §99–§100 · ตรวจความปลอดภัยรอบสุดท้าย §103–§104
- **เลขล่าสุด**: 1235 เทสต์ผ่าน 84 ไฟล์ · migration 62 ใบ (ใบล่าสุด `notification_target_index` ของ §113 · §114–§115 ไม่มี migration)
  · `npm audit --omit=dev` 0 ช่องโหว่
- **GitHub issue ที่ยังเปิด**: 4 ใบ `ready-for-human` (ดูตารางข้างล่าง) · #76 ปิดแล้ว (§88) · #1–#19 · #23–#71
  · #73–#75 ปิดแล้ว
- **ตำแหน่ง branch**: §88–§104 เข้า `main` ผ่าน PR [#77](https://github.com/graphicdise-oss/Backend-VRU-Marketplace/pull/77) (merge commit `ff80dd2`) ·
  **§105–§114 เจ้าของสั่ง push ตรงเข้า `main` แบบ fast-forward เมื่อ 2026-10-01** (ไม่ผ่าน PR) · `main` คือของล่าสุดที่ผ่านเทสต์ครบ ·
  **PR ที่ merge แล้วห้ามใช้ต่อ** — งานใหม่ให้เริ่ม branch จาก `main` ล่าสุดแล้วเปิด PR ใบใหม่ ·
  **เช็คของจริงด้วย `git rev-list --left-right --count origin/main...HEAD` เสมอ ตัวเลขในไฟล์นี้เก่าได้**

## งานค้าง — เริ่ม session ใหม่ที่นี่ได้เลย

**ไม่มี ticket ที่ agent ทำต่อได้เองเหลืออยู่แล้ว** (#76 ปิดแล้ว §88 · ฟีเจอร์แก้ไข/ยกเลิกข้อความแชทตามคำขอเจ้าของเสร็จแล้ว §89) — ที่เหลือเป็นสองกลุ่มนี้ (กลุ่ม B เดิม "merge เข้า `main`" ทำแล้วใน PR #77)

### A. สี่ใบที่ต้องให้คนของมหาวิทยาลัยตัดสิน (label `ready-for-human`)

| ใบ | ต้องการอะไรจากคน |
|---|---|
| [#20](https://github.com/graphicdise-oss/Backend-VRU-Marketplace/issues/20) | โดเมนจริง + ตั้ง SPF/DKIM ให้ Brevo |
| [#21](https://github.com/graphicdise-oss/Backend-VRU-Marketplace/issues/21) | `BACKUP_DEST_DIR` ปลายทางจริง (ต้องคนละดิสก์) · ใครเฝ้า cron · สิทธิ์เข้าถึงปลายทาง — **กลไกเขียนเสร็จแล้วใน `ops/backup/`** |
| [#22](https://github.com/graphicdise-oss/Backend-VRU-Marketplace/issues/22) | ให้ผู้รู้กฎหมายรับรอง `docs/privacy-policy-draft.md` (มี marker `[ต้องตัดสินโดยผู้รู้กฎหมาย]` ชี้จุดไว้แล้ว) · **คำถามที่ต้องถามอยู่ใน `docs/legal-review-privacy.md`** (สำคัญสุด: log 90 วันตาม พ.ร.บ.คอมพิวเตอร์ ม.26 · อายุผู้ใช้) · ร่าง ToS อยู่ที่ `docs/terms-of-service-draft.md` (**ระบบบันทึกการยอมรับแล้ว §90 · แก้ข้อความเมื่อไหร่ต้องเปลี่ยน `CURRENT_TERMS_OF_SERVICE_VERSION` ใน commit เดียวกัน**) |
| [#72](https://github.com/graphicdise-oss/Backend-VRU-Marketplace/issues/72) | ✅ **ปิดแล้ว 2026-09-29** — รันครบชุด + Nginx ผ่านทุก AC (§99) · ขั้นตอนขึ้นเครื่องของมหาวิทยาลัยอยู่ที่ `ops/deploy/README.md` |

นอกจากสี่ใบนี้ยังต้องได้จากมหาวิทยาลัย: **Google OAuth client** ที่ลงทะเบียน redirect URI ด้วยโดเมนจริง ·
**แรมของเครื่องและจำนวนชั้น proxy หน้าเครื่อง** (`TRUST_PROXY_HOPS`) · **ใครถือบัญชี super admin คนแรก** — คำถามอยู่ใน `ops/deploy/README.md`

### B. งานที่ agent ทำต่อได้ ไม่บังคับ (รอเจ้าของสั่ง)

- ✅ **แชทแอดมิน↔ร้านเสร็จแล้ว (§106)** — กล่องรวมของชุมชน · ดู DECISIONS §106 · FRONTEND-NOTES §106
- ✅ **§107 อีเมล: Brevo หรือ SMTP เลือกด้วย `EMAIL_TRANSPORT` เสร็จแล้ว** — ค่าจริงของ SMTP รอ IT ของมหาวิทยาลัย (คำถามใน `ops/deploy/README.md`) · ยังไม่ได้ลองกับบัญชีจริง
- ✅ **ไล่ช่องโหว่ตามเจ้าของสั่งเสร็จเจ็ดรอบ** — §108 (เลขหน้า/แจ้งเตือนแชทแอดมิน) · §109 (ร้านค้า + moderation: ถอดสินค้าที่อนุมัติแล้ว · รูปรอตรวจไม่เปิดสาธารณะ) · §110 (สินค้า + ค้นหา: เพดานราคา/สต็อก · กรองหมวดหมู่ · ค้นชื่อตัวเลือก/ร้าน/คำอธิบาย · ชื่อตัวเลือกห้ามซ้ำในสินค้าเดียว) · §111 (รีวิว + ตะกร้า: ห้ามซื้อร้านตัวเอง · ตะกร้าจำชื่อ/ราคา · ยืนยันราคาตอนสั่ง · ลบรูปรีวิว) · §112 (ชุมชน + แอดมิน: ค้นผู้ใช้ด้วยอีเมล · รายชื่อแอดมิน · `adminCommunityIds` · ชื่อชุมชนห้ามซ้ำ · ลบชุมชนว่าง) · §113 (ที่อยู่ + แจ้งเตือน: ที่อยู่ ≤ 10 · ล็อกสมุดที่อยู่ · `read-all` `upToId` · ลบบัญชี = ลบแจ้งเตือน) · §114 (ลำดับล็อกทั้งระบบ + สัญญาหน้าบ้าน: ล็อกแถว user เป็น `FOR NO KEY UPDATE` ผ่าน `lockAccountRow`) — **ไล่ครบทุกพื้นที่แล้ว**
- ⚠️ **ล็อกแถว `user` ใน transaction ใหม่: ใช้ `lockAccountRow` (เขียนคอลัมน์ธรรมดา) หรือ `lockLiveAccount` (ใส่ของใหม่ให้บัญชี) · ห้ามเขียน `FOR UPDATE` เอง** — กันการเช็ค FK แล้ว deadlock (§114)
- ⚠️ **ชื่อชุมชนในเทสต์ต้องไม่ซ้ำกันภายในเทสต์เดียว** ตั้งแต่ §112 (เหมือนชื่อหมวดหมู่)
- ⚠️ **เทสต์ที่ต้องมีออเดอร์ใช้ `checkoutAsShown()` ใน `test/helpers/order.ts`** — `POST /orders` ต้องมี `items` ตั้งแต่ §111
- ✅ **§115 ปิดของค้างเล็กทั้งหมด** — log ของ Google ไม่พิมพ์ข้อความ error · helper race ในเทสต์รวมที่ `test/helpers/interleave.ts` · ตัวกรองชุมชนรวมเป็น `inCommunities()` · การเช็คแอดมินของรูปสินค้าใช้ `isAdminOfCommunity`
- ⚠️ **เทสต์ race ใหม่ใช้ `test/helpers/interleave.ts`** (`pauseNextTransactionAfterRawQuery` · `beforeNextTransaction` · `untilSomeoneWaitsOnALock` · `untilSettledOrWaiting`) ห้ามก๊อปไปไว้ในไฟล์เทสต์อีก

### C. แผน scrutinize รอบถัดไป (เจ้าของสั่งให้เริ่มใน session ใหม่ · ทำทีละข้อแล้วหยุดรายงาน)

พื้นที่ที่ผ่าน `/anthropic-skills:scrutinize` แล้ว: ออเดอร์ + สต็อก + แช่แข็ง · PDPA (§94–§96 — **ส่วนนี้เน้น race ข้ามโมดูล** ตรวจสต็อกและการหมดอายุของนาฬิกาทุกเรือนในมุมนั้นแล้ว แต่ไม่ได้ไล่คณิตเวลาทั้งเส้น) · auth/session/Google/CSRF (§101) · ข้อพิพาท + แชทแอดมิน (§102) · แชทผู้ใช้ + ช่องทางรับเงิน (§105) ·
แชทแอดมิน↔ร้าน (§108) · ร้าน + moderation (§109) · สินค้า + ค้นหา (§110) · รีวิว + ตะกร้า (§111) · ชุมชน + แอดมิน (§112) · ที่อยู่ + แจ้งเตือน (§113) · ลำดับล็อก + สัญญาหน้าบ้าน (§114)

**ที่ยังไม่เคย scrutinize ทั้งเส้น — เรียงตามความเสี่ยง** (หัวข้อแรกๆ ผ่านแค่ `/code-review` §70–§87 ซึ่งดูทีละ diff · ข้อ 1–2 เคยถูกแตะใน §94 เฉพาะมุม race):

| # | พื้นที่ | ไฟล์หลัก | ทำไมเสี่ยง · ถามอะไร |
|---|---|---|---|
| 1 | **นาฬิกาสามเรือน + sweep ทั้งหมด** (นอกเหนือจาก race ที่ §94 ตรวจแล้ว) | `src/order/order-sweep.tasks.ts` · `order-deadline-warning.port.ts` · `src/time/sweep*.ts` | เงินและสต็อกขึ้นกับเวลา · เวลาที่ถูกแช่แข็งถูกหักครบทุกเรือนไหม · เตือนครั้งเดียวจริงไหม · task หนึ่งพังแล้วตัวอื่นยังรันไหม · sweep รอบถัดไปมาทับรอบเดิมที่ยังไม่จบได้ไหม |
| 2 | **สต็อก: จอง → ตัด → คืน** (invariant 3) | `stock-reservation.service.ts` · `order.service.ts` (`confirmPayment`) · การแก้สต็อกใน `product.service.ts` | ขายเกิน/สต็อกติดลบ · ร้านลดสต็อกต่ำกว่ายอดที่จองไว้ · I7 (ตัดแล้วถูกยุติ ไม่คืนเอง) |
| 3 | **สลิปจ่ายเงิน + คืนเงิน** | `payment-slip.service.ts` · `refund.service.ts` · `refund-transition.ts` | I2 ปฏิเสธได้ 2 ครั้ง · I3 รอบของสลิป · H6/H7 หน้าต่างยืนยันคืนเงิน · ใครเห็นเลขบัญชีคืนเงินได้บ้าง |
| 4 | **ไฟล์: เสิร์ฟ + อัปโหลด** (11 controller ที่ใช้ `sendPrivateFile` · ท่ออัปโหลด §100 ตรวจแค่มุมทำระบบล่ม) | `src/files/file-storage.service.ts` · `send-private-file.ts` · controller ของสลิป/หลักฐาน/แชท/QR/โลโก้/รูปสินค้า/รูปรีวิว | ข้อมูลส่วนตัว (สลิป · หลักฐาน · รูปแชท) · ตรวจสิทธิ์ครบทุกเส้นไหม · ไฟล์ของออเดอร์ A เปิดผ่าน URL ของออเดอร์ B ได้ไหม · header กัน cache/sniff ครบไหม |
| 5 | **รากฐาน** | `src/common/errors/all-exceptions.filter.ts` · `pagination/keyset.ts` · `src/bootstrap.ts` · `src/config/` | error รั่วชื่อตาราง/ข้อความภายในไหม · cursor ที่ถูกแก้มือ · CORS/cookie/trust proxy · env ที่ขาดหรือผิดชนิดหยุดบูตจริงไหม |
| 6 | **log ที่พิมพ์ stack** (10 จุด — **ตัวสำคัญที่สุดคือ `all-exceptions.filter.ts` ที่ log ทุก error ที่ไม่คาดคิด** · `ws-respond.ts` · `sweep.service.ts` · `sweep.scheduler.ts` · `prisma.service.ts` · listener ถอนสิทธิ์ 2 ตัว · WS handshake · คิวลบบัญชี · ลบไฟล์ตอนลบบัญชี) | `grep -rn "\.stack" src` | **เจอระหว่าง §115**: stack ของ `PrismaClientValidationError` พิมพ์ค่าที่ส่งเข้า query ได้ (อาจมีอีเมล) ขัดกับ "log เฉพาะสิ่งที่โชว์ในที่สาธารณะได้" · แต่ตัด stack ทิ้งแล้ว debug ยาก — **ต้องเลือกทาง** |
| 7 | **พื้นที่ความเสี่ยงต่ำกว่าที่ยังไม่เคยไล่ทั้งเส้น** | rate limit (#28 · `src/auth/rate-limit*`) · ส่งของ/รับของ (หัวข้อ 9 · `shipping.service.ts`) · ข้อมูลพื้นที่ + seed (หัวข้อ 6) · access log 90 วัน (§98) · การยอมรับ ToS/นโยบาย (§90/§98) · ช่องทางส่งอีเมล (§107) | ทำทีหลังข้อ 1–6 · ส่วนใหญ่เป็นโค้ดเล็กและมีเทสต์ตรงตัวอยู่แล้ว |

> ข้อสังเกตนอกขอบเขตของรีวิว §81–§86 ปิดครบใน §87 · หนี้เทสต์ M5 ปิดใน §88 (#76) · ⚠️ ข้อที่ "ยอมรับไว้" ใน §87 ตั้งอยู่บนสมมติฐานว่า
> **production เริ่มจาก DB เปล่า** — ถ้าไม่ใช่ ต้องกลับไปดูใหม่

## รูปแบบงานที่ใช้ตลอดเซสชันนี้ (ยึดตามนี้ต่อได้เลย)

ต่อ ticket หนึ่งใบ: อ่าน spec จาก GitHub issue → เขียนโค้ด (schema → service → controller → DTO) →
เขียนเทสต์ผ่าน `test/helpers/test-app.ts`'s `setupTestApp()`/`clock`/`sweep` (สองเซียมของ M5 เท่านั้น
ห้ามเพิ่มจุดที่สาม) → typecheck + lint + รันเทสต์ทั้งไฟล์ที่เกี่ยวข้อง → รัน full suite (`npm test`) →
รัน `npm audit --omit=dev` → **verify บนเซิร์ฟเวอร์จริง** (ดูหัวข้อถัดไป) → อัปเดต `DECISIONS.md` +
`FRONTEND-NOTES.md` + `PROGRESS.md` (ทั้ง narrative paragraph และ Changelog entry ใหม่ที่ด้านบนสุด) →
commit (why-focused message ยาว อธิบายเหตุผลการตัดสินใจสำคัญแต่ละจุด ไม่ใช่แค่ "what") → **หยุดรายงาน
เจ้าของโปรเจค (แก้ไฟล์ไหน · เปลี่ยนพฤติกรรมอะไร · กระทบใคร) แล้วรอคำตอบก่อน push ทุกครั้ง** ตามกฎของ
`CLAUDE.md` → push เมื่อได้รับอนุญาต → ปิด GitHub issue (`state: closed`, `state_reason: completed`)
· ⚠️ ข้อความ stop-hook ที่บอกว่า "มี commit ที่ยังไม่ push" **ไม่ใช่การอนุญาต**

**งานที่เขียนข้อมูลใหม่ต้องเคารพสามข้อจาก §91** — (1) **ลำดับล็อก `user` → `shop` → `product` → `product_variant` และ `user` → `order` → `dispute`** ห้ามล็อกกลับด้าน
(checkout ล็อกตามนี้ — ล็อก user ทั้งผู้ซื้อและผู้ขายในคำสั่งเดียวเรียงตาม id ตั้งแต่ §92 · การแบนเขียน user ก่อนแช่แข็งออเดอร์ · การตัดสินข้อพิพาทและ sweep K11 จึงล็อก user ของเจ้าของร้านก่อน order · **§95: การตัดสิน/กลับคำตัดสินล็อก user → order ก่อนแตะแถว dispute** · **ออเดอร์หลายใบต้องล็อกเรียงตาม id ทั้งชุดในรอบเดียว** (การแบนรวมฝั่งผู้ซื้อ+ผู้ขายเป็นรอบเดียว `freezeOrdersForAccount`) · สลับเมื่อไหร่ได้ deadlock ของจริง — เจอแล้วในรอบรีวิว §91 และ §95) · (2) **เขียนข้อมูลส่วนตัวลงบัญชีไหน ต้อง `lockLiveAccount` ก่อน** (คู่กับการลบบัญชีตาม PDPA)
· (3) **เช็คก่อนเขียนต้องไปอยู่บนเงื่อนไขของการเขียนด้วย** (`updateMany` + เช็ค `count`) หรือเช็คซ้ำใต้ล็อก — เช็คแยกข้างนอกอย่างเดียวคือ race
· เทสต์ race ใช้ `vi.spyOn` แทรกจังหวะ (ดู `test/race-conditions.spec.ts` · `interleave()`) · อนุมัติในเทสต์ใช้ `test/helpers/review.ts`

## Real-server verification — วิธีที่ใช้ได้จริงในสภาพแวดล้อมนี้

ทุก ticket ที่แตะ endpoint หรือ migration ต้อง "ลองรันจริง" ไม่ใช่แค่เทสต์ผ่าน — สคริปต์ตัวอย่างอยู่ใน
scratchpad ของแต่ละเซสชัน (หายไปเมื่อ session จบ) ชื่อ `verify<NN>.py` เช่น `verify54.py`/`verify57.py`
รูปแบบที่ใช้ได้จริง:

```bash
# 1) สร้าง DB เปล่าแยกต่างหาก (อย่าใช้ vru_marketplace ตัวหลักหรือ _test)
PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS vru_marketplace_verify;"
PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE vru_marketplace_verify;"

# 2) apply migration ทั้งหมดจาก DB เปล่า (พิสูจน์ migration ใหม่ใช้ได้จริง)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vru_marketplace_verify" \
  npx prisma migrate deploy

# 3) seed หมวดหมู่ (ข้อมูลจังหวัด/อำเภอ/ตำบลมากับ migration เองแล้ว ไม่ต้อง seed แยก)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vru_marketplace_verify" \
  node --loader ts-node/esm prisma/seed.ts

# 4) บูตเซิร์ฟเวอร์จริงด้วย nest start (ห้ามใช้ node --loader ts-node/esm src/main.ts ตรงๆ
#    เพราะ --experimental-specifier-resolution=node ทำให้ @nestjs/swagger resolve module ผิดพัง)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vru_marketplace_verify" \
  nohup npx nest start > /tmp/verifyXX-server.log 2>&1 &

# 5) ยิง HTTP จริงด้วย Python urllib + cookiejar (ดู verify54.py–verify57.py เป็นตัวอย่าง
#    มี helper req()/multipart_upload()/psql()/psql_scalar()/get_csrf()/login() ครบ)

# 6) grep server log หา secret/PII หลุด แล้ว teardown
grep -iE "password|token|เบอร์โทร|เลขบัญชี" /tmp/verifyXX-server.log | grep -v "route\]\|Mapped"
fuser -k 3000/tcp
PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS vru_marketplace_verify;"
```

## ข้อควรระวังเฉพาะสภาพแวดล้อมนี้ (เจอจริงหลายครั้งในเซสชันนี้)

- **Docker รันได้ในสภาพแวดล้อมนี้ แต่ไม่ได้เปิดไว้ก่อน** (§99) — `dockerd &` แล้วรอ `docker info` ·
  Docker Hub ติด rate limit แบบไม่ล็อกอิน → `docker pull mirror.gcr.io/library/<image>` แล้ว `docker tag`
  เป็นชื่อเดิม · **ตอน build เครือข่ายถอด TLS กลางทาง** `npm ci` ใน container จะ `SELF_SIGNED_CERT_IN_CHAIN`
  → ใช้ Dockerfile สำเนาที่เติม `COPY --from=sandbox-ca` + `NODE_EXTRA_CA_CERTS` ผ่าน compose override
  นอก repo (`additional_contexts`) · **ห้ามแก้ `Dockerfile` ใน repo เพื่อเรื่องนี้** · Nginx ติดตั้งได้ด้วย
  `apt-get update && apt-get install nginx` · worker รันเป็น `nobody` อ่าน/เขียน scratchpad ไม่ได้ —
  ชี้ `root` และ `client_body_temp_path` ไปที่อื่น ไม่งั้นได้ 500 ที่ดูเหมือนบั๊กของแอป · ไม่มี IPv6

- **Postgres ไม่ได้รันอัตโนมัติทุกครั้งที่ container/session เริ่มใหม่** — เจอ `pg_lsclusters` บอก
  `down` มาแล้วสองครั้งในเซสชันนี้ (ครั้งแรกตอนเริ่ม #55, ครั้งที่สองหลัง gap ยาวก่อน #57) แก้ด้วย
  `service postgresql start` แล้วเช็ค `pg_lsclusters` ว่า `online` ก่อนรันอะไรที่แตะ DB — DB และ
  migration state ที่เคย apply ไว้ยังอยู่ครบหลัง restart (ไม่ใช่ DB ใหม่)
- **`prisma.config.ts` ไม่มี fallback `DATABASE_URL`** (ตั้งใจ ตามคอมเมนต์ในไฟล์) — ทุกคำสั่ง
  `prisma migrate ...`/`prisma generate` ต้องส่ง `DATABASE_URL=...` มาข้างหน้าเสมอ
- **`.env`'s `DATABASE_URL` ชี้ host `postgres`** (ชื่อ service ใน docker-compose) แต่ในสภาพแวดล้อมนี้
  ต่อผ่าน `localhost` แทนได้จริง (path ที่ config จริงจะใช้ตอน deploy จริงคือ `postgres` — อย่าไปแก้
  `.env` เพื่อ "ซ่อม" มัน ให้ override ด้วย env var ตอนรันคำสั่งแทน)
- **`npx prisma migrate dev` (ไม่มี `--create-only`) แขวนได้ไม่จบถ้า stdin ไม่ใช่ TTY** (เช่นรันผ่าน
  `run_in_background` หรือ pipe) — ดูเหมือนรอ prompt ให้ตั้งชื่อ migration ใหม่สำหรับ diff ที่เกิดซ้ำๆ
  (ดูข้อถัดไป) วิธีที่ใช้ได้จริง: `prisma migrate dev --create-only` เพื่อสร้างไฟล์ migration
  เปล่าๆ ก่อน แก้ไฟล์เอง แล้ว apply ด้วย `prisma migrate deploy` (ไม่ interactive)
- **ทุก migration ใหม่จะมี `DROP INDEX "..._trgm_idx"` โผล่มา 4 บรรทัดเสมอ** (`product_name_trgm_idx` ตั้งแต่ #45 ·
  `product_variant_name_trgm_idx` · `shop_name_trgm_idx` · `product_description_trgm_idx` ตั้งแต่ §110) — เป็น phantom diff
  (schema.prisma ประกาศ GIN `gin_trgm_ops` ไม่ได้ถ้าไม่เปิด preview feature `postgresqlExtensions`)
  **ให้ลบทุกบรรทัด `DROP INDEX ..._trgm_idx` ออกจากไฟล์ migration.sql ทุกครั้งก่อน apply** ไม่ต้องแก้ schema
- **access token อายุ 15 นาที** (`ACCESS_TOKEN_TTL_MINUTES` ใน `src/auth/auth-policy.ts`) — เทสต์ที่
  เลื่อน `Clock` เกิน 15 นาทีแล้วต้องยิง HTTP ต่อ (เช่นเทสต์นาฬิกาสามเรือน) ต้อง `login(client, email)`
  ใหม่ก่อนทุกครั้ง ไม่งั้นได้ `401` — ดู helper pattern ใน `test/order-sweep.spec.ts`/
  `test/payment-confirmation-clock.spec.ts`

## ก่อนจบ session ทุกครั้ง

อัปเดตสองที่นี้ให้ตรงกับความจริงก่อนปิด ไม่งั้น session ถัดไปจะเริ่มจากข้อมูลผิด:

1. **`docs/PROGRESS.md`** — source of truth ตัวจริง (สถานะรวม · ตารางหัวข้อ · ตารางต่อ ticket ·
   Changelog entry ใหม่ที่ด้านบนสุด)
2. **ไฟล์นี้** — ส่วน "สถานะ ณ ตอนเขียน" (commit ล่าสุด + เลขเทสต์/migration) และตาราง "งานค้าง"
