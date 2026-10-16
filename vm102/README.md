# 🚀 ขั้นตอนการ Deploy VM 102 (Frontend)

**IP ของเครื่องนี้:** `172.16.90.102`  
**ชี้คำขอไปที่ Gateway:** `172.16.90.101`

---

## คำสั่งสำหรับรันระบบ

1. เข้ามายังโฟลเดอร์นี้:

   ```bash
   cd vm102
   ```

2. สั่ง Build และรัน Container ด้วย Docker Compose:

   ```bash
   docker compose up -d --build
   ```

3. ตรวจสอบสถานะการทำงาน:

   ```bash
   docker compose ps
   ```

4. ตรวจสอบการตอบสนอง:

   ```bash
   curl http://localhost:3000
   ```

---

## หมายเหตุ

- คอนเทนเนอร์จะรันบนพอร์ต `3000` (`172.16.90.102:3000`)
- ตัว Nginx Proxy Manager บน VM 101 จะส่งต่อผู้ใช้มายังพอร์ตนี้
