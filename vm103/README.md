# 🚀 ขั้นตอนการ Deploy VM 103 (Backend API)

**IP ของเครื่องนี้:** `172.16.90.103`  
**เชื่อมต่อไปยัง Database:** `172.16.90.104:5432`  
**รับคำขอจาก Gateway:** `172.16.90.101`

---

## 1. คำสั่งสำหรับรันระบบ

1. เข้ามายังโฟลเดอร์นี้:

   ```bash
   cd vm103
   ```

2. ตรวจสอบรหัสผ่านฐานข้อมูลในไฟล์ `.env`:
   - เปิดดูไฟล์ `.env` ตรงบรรทัด `DATABASE_URL` ว่ารหัสผ่านตรงกับ PostgreSQL ที่รันอยู่บน VM 104 หรือไม่

3. สั่ง Build, Migrate และเริ่มรัน Container:

   ```bash
   docker compose up -d --build
   ```

   > Service `migrate` จะสร้างตารางใน Database ให้โดยอัตโนมัติ และ Service `api` จะเปิดพอร์ต `3001`

4. ตรวจสอบสถานะ:

   ```bash
   docker compose ps
   ```

5. ทดสอบการตอบสนองของ API:

   ```bash
   curl http://localhost:3001/api/v1/health
   # จะต้องได้คำตอบ: {"status":"ok"}
   ```

---

## 2. การ Seed ข้อมูลตั้งต้นของระบบ

รันคำสั่ง Seed ข้อมูลเริ่มต้น (หมวดหมู่สินค้า 11 หมวด + ขนส่ง 6 เจ้า):

```bash
docker compose run --rm migrate npx prisma db seed
```

### ข้อมูลจำลองสำหรับตรวจรับงาน (ทางเลือก)

หากต้องการสร้างบัญชีทดสอบ 4 บทบาท + ร้านค้า + สินค้าตัวอย่าง ให้รัน:

```bash
docker compose run --rm migrate node --loader ts-node/esm prisma/seed-staging.ts
```

---

## 3. ในวันเปิดให้บริการจริง (Go-Live)

เมื่อตรวจรับงานเสร็จสิ้นและต้องการล้างข้อมูลจำลองเพื่อเปิดใช้งานจริง ให้รัน:

```bash
docker compose run --rm migrate node --loader ts-node/esm prisma/clean-mock.ts
```
