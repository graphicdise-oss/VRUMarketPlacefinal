# Migrations

## ห้ามแก้ไฟล์ migration ที่ commit แล้ว — เพิ่มไฟล์ใหม่แทน

**คุณกำลังจะแก้ไฟล์ในโฟลเดอร์นี้ใช่ไหม — อย่า**

Prisma เก็บ checksum ของทุก migration ไว้ในตาราง `_prisma_migrations` ของ**ทุกฐานข้อมูล
ที่เคยรันมัน** แก้ไฟล์เดิมแล้ว checksum ไม่ตรง ผลคือ:

- `prisma migrate deploy` บนเครื่องที่รันไปแล้วจะ**ฟ้องว่า schema drifted และหยุด**
- คนอื่นในทีมที่รันไปแล้วได้ schema คนละแบบกับคุณ โดยไม่มีอะไรเตือน
- container ที่รัน `prisma migrate deploy` ตอนสตาร์ต (ดู `docker-compose.yml`) จะบูตไม่ขึ้น

**ใช้กับ migration ที่คุณเพิ่งเขียนเมื่อห้านาทีที่แล้วด้วย ถ้ามันออกจากเครื่องคุณไปแล้ว**
(push แล้ว หรือมีคนอื่น pull แล้ว) · ถ้ายังไม่ออกจากเครื่องและยังไม่ commit
`prisma migrate dev` จะช่วยรีเซ็ตให้ได้ แต่เมื่อไหร่ที่ไม่แน่ใจ **ให้ถือว่าแก้ไม่ได้**

### อยากเปลี่ยน schema ให้ทำแบบนี้

```bash
# 1. แก้ prisma/schema.prisma
# 2. สร้าง migration ใบใหม่
npx prisma migrate dev --name describe_what_changed
```

ได้โฟลเดอร์ใหม่ที่มี timestamp ใหม่ · ไฟล์เดิมไม่ถูกแตะ

### ถ้าต้องลบหรือเปลี่ยนชนิดคอลัมน์ที่มีข้อมูลอยู่แล้ว

เขียน migration ที่**ย้ายข้อมูลด้วย** ไม่ใช่แค่ `ALTER TABLE` แล้วหวังว่าจะรอด
· สี่ข้อใน `CLAUDE.md` ("ของที่เปลี่ยนทีหลังแล้วเจ็บ") — id เป็น UUIDv7 · เวลาเป็น `TIMESTAMPTZ` UTC ·
เงินเป็น `amount_minor` + `currency` · PDPA ใช้ anonymize ไม่ใช่ `DELETE` —
**เปลี่ยนข้อไหนต้องคุยกับเจ้าของโปรเจคก่อนเสมอ** ไม่ใช่เขียน migration แล้วค่อยบอก

## กติกาคอลัมน์ที่ทุกตารางต้องตาม

ดูคอมเมนต์หัวไฟล์ `prisma/schema.prisma` และ `audit_log` ซึ่งเป็นตารางแรกและเป็นต้นแบบ
· `id` เป็น `UUID` ที่แอปสร้างด้วย `newId()` (ไม่มี `@default` เพราะ `uuidv7()` เป็นของ PostgreSQL 18
แต่เรารัน 16) · เวลาเป็น `@db.Timestamptz(6)` · ชื่อคอลัมน์ `snake_case` แปลงด้วย `@map`
