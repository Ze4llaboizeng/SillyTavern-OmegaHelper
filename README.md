# Omega Helper

ผู้ช่วยจัดการ Omega preset สำหรับ SillyTavern ใช้ง่ายบนมือถือและไม่กินสเปค
A lightweight, mobile-friendly Omega preset manager for SillyTavern.

**Version 1.2.1**
**Dev by Zealllll & Xo.Nara**

> อุทิศแด่ Omega preset — สาธุ 🙏
> Dedicated to the Omega preset. 🙏

## ความสามารถ / Features

- แสดง Prompt ตามหมวดและเส้นคั่นจริงใน preset
  Shows prompts using the preset’s real sections and dividers.
- แยกหน้าจัดการ Prompt และ Regex ชัดเจน
  Separate Prompt and Regex management.
- เปิด–ปิดง่าย พร้อมสถานะที่อ่านเข้าใจทันที
  Simple toggles with clear status.
- รองรับมือถือและใช้เอฟเฟกต์เท่าที่จำเป็น
  Mobile-friendly with minimal visual effects.
- เปิด Sigil ที่จำเป็นก่อนสร้างข้อความด้วย Omega/5EX
  Enables required Sigil prompts before Omega/5EX generation.
- ตรวจเวอร์ชัน preset และแจ้งเตือนเมื่อมีแพตช์ใหม่
  Checks preset versions and shows patch notifications.
- ตรวจและช่วยแก้ Reasoning/Thinking ของโมเดล
  Checks and helps fix model reasoning settings.
- บันทึกโปรไฟล์ Prompt + Regex ได้
  Saves Prompt + Regex profiles.

## ติดตั้ง / Install

1. วางโฟลเดอร์นี้ไว้ที่
   Put this folder in:

   `SillyTavern/public/scripts/extensions/third-party/`

2. รีสตาร์ต SillyTavern แล้วเปิดใช้ **Omega Helper**
   Restart SillyTavern and enable **Omega Helper**.

3. รีเฟรชแบบไม่ใช้แคชด้วย `Ctrl + F5`
   Hard refresh with `Ctrl + F5`.

## วิธีใช้ / Usage

- กดปุ่มสายฟ้า **⚡** เพื่อเปิดหน้าจัดการ
  Tap **⚡** to open the manager.
- แท็บ **Prompt** ใช้จัดการ Prompt
  Use the **Prompt** tab to manage prompts.
- แท็บ **Regex** ใช้จัดการ Regex
  Use the **Regex** tab to manage regex scripts.
- เมื่อมีแพตช์ใหม่ ให้กดลิงก์ Discord ในหน้าต่างแจ้งเตือน
  When a patch is available, open the Discord link in the update notice.

แหล่งแพตช์ / Patch source: [Omega Discord post](https://discord.com/channels/1325303011702079560/1455967291790331978/1512886868872659146)

## คำสั่ง / Commands

- `/omega` — เปิด Omega Helper / Open Omega Helper
- `/oh-check` — ตรวจการตั้งค่า / Check settings
- `/oh-fix` — แก้การตั้งค่าที่ตรวจพบ / Fix detected settings

## ตรวจสอบ / Verify

```bash
node selfcheck.mjs
```

## เครดิต / Credits

**Dev by Zeal & Nara**
**อุทิศแด่ Omega preset — สาธุ 🙏**
