# 🌐 คู่มือตั้งค่า Nginx Proxy Manager (NPM) บน VM 101

**IP เครื่อง:** `172.16.90.101`  
**Web UI ของ NPM:** เข้าที่ `http://172.16.90.101:81`

---

## ขั้นตอนการสร้าง Proxy Host ในหน้า Web UI ของ NPM

### ขั้นตอนที่ 1: กรอกข้อมูลในแท็บ Details

1. ล็อกอินเข้า Web UI ของ NPM
2. ไปที่เมนู **Hosts** ➔ **Proxy Hosts** ➔ กดปุ่ม **Add Proxy Host**
3. กรอกข้อมูลในแถบ **Details**:
   - **Domain Names:** `172.16.90.101` (พิมพ์แล้วกด Enter)
   - **Scheme:** `http`
   - **Forward Hostname / IP:** `172.16.90.102`
   - **Forward Port:** `3000`
   - ✅ ติ๊กถูก **Cache Assets**
   - ✅ ติ๊กถูก **Block Common Exploits**
   - ✅ ติ๊กถูก **Websockets Support**

---

### ขั้นตอนที่ 2: ตั้งค่าในแท็บ Custom Locations

สลับไปที่แถบ **Custom Locations** แล้วกดปุ่ม **Add location** 2 จุด ดังนี้:

#### จุดที่ 1: เส้นทาง WebSocket สำหรับแชทสด

- **Define location:** `/api/v1/socket.io/`
- **Scheme:** `http`
- **Forward Hostname / IP:** `172.16.90.103`
- **Forward Port:** `3001`
- กดรูปเฟือง (Gear) ใส่คำสั่ง:

  ```nginx
  proxy_read_timeout 120s;
  proxy_send_timeout 120s;
  ```

#### จุดที่ 2: เส้นทาง REST API ทั้งหมด

- **Define location:** `/api/v1/`
- **Scheme:** `http`
- **Forward Hostname / IP:** `172.16.90.103`
- **Forward Port:** `3001`
- กดรูปเฟือง (Gear) ใส่คำสั่ง:

  ```nginx
  client_max_body_size 110m;
  ```

---

### ขั้นตอนที่ 3: บันทึกและทดสอบใช้งาน

1. กดปุ่ม **Save** เพื่อบันทึกการตั้งค่า
2. ทดสอบเปิดเบราว์เซอร์ไปที่ `http://172.16.90.101` ระบบจะเปิดหน้าแรกของ VRU Marketplace ขึ้นมาทันที
