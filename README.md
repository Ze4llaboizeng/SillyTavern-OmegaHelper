# Omega Helper

ผู้ช่วยจัดการ Omega preset สำหรับ SillyTavern ใช้ง่ายบนมือถือและไม่กินสเปค
A lightweight, mobile-friendly Omega preset manager for SillyTavern.

**Version 1.6.3**
**Dev by Zealllll & Xo.Nara**

> อุทิศแด่ Omega preset — สาธุ 🙏
> Dedicated to the Omega preset. 🙏

## โครงสร้างโค้ด

- `index.js` — entrypoint, event hooks และ lifecycle
- `src/config.js` — constants และ model rules
- `src/prompts.js` — settings, Prompt Manager และ Sigil ที่จำเป็น
- `src/features.js` — Regex, feature toggles และ profiles
- `src/reasoning.js` — alerts, patch notice, formatting doctor และ think checker
- `src/guide.js` — beginner guide
- `src/panel-view.js` — prompt/regex manager panel
- `src/ui.js` — extension settings และปุ่มลัด
- `src/panel.js` — ประกอบ UI modules ทั้งสามส่วน

## ความสามารถ / Features

- แสดง Prompt ตามหมวดและเส้นคั่นจริงใน preset
  Shows prompts using the preset’s real sections and dividers.
- ช่องค้นหาจะล้างเมื่อเปิด panel ใหม่ เพื่อไม่ให้หมวดดูเหมือนมีรายการไม่ครบ
  Search resets whenever the panel opens so stale filters cannot hide preset rows.
- แก้ไข Custom Prompt ได้จากหน้าจัดการ
  Edit custom prompts directly in the manager.
- แยกหน้าจัดการ Prompt และ Regex ชัดเจน
  Separate Prompt and Regex management.
- เปิด–ปิดง่าย พร้อมสถานะที่อ่านเข้าใจทันที
  Simple toggles with clear status.
- รองรับมือถือและใช้เอฟเฟกต์เท่าที่จำเป็น
  Mobile-friendly with minimal visual effects.
- เปิด Sigil ที่จำเป็นก่อนสร้างข้อความด้วย Omega/5EX
  Enables required Sigil prompts before Omega/5EX generation.
- ก่อนเปิด Next Scenario Suggestion จะตรวจว่า `st-clickable-inputs` ติดตั้งและเปิดใช้งานอยู่
  Blocks the clickable-choice prompt until its required extension is installed and enabled.
- ตรวจเวอร์ชัน preset และแจ้งเตือนเมื่อมีแพตช์ใหม่
  Checks preset versions and shows patch notifications.
- popup แจ้งอัปเดตมีปุ่มเปิดคู่มือมือใหม่ของ Omega Helper โดยตรง
  Update notices include a direct button for the Omega beginner guide.
- ตรวจและช่วยแก้ Reasoning/Thinking ของโมเดล
  Checks and helps fix model reasoning settings.
- ตรวจ planning ที่ parse แล้วว่าสเตจ `strongest pull` ของ engine ที่เปิดอยู่มาครบ
  Checks parsed planning for the enabled engine's highest-priority `strongest pull` stage.
- ตรวจเนื้อหา `.mes_reasoning` ใต้หัวข้อ “Thought for some time” ของคำตอบบอททุกครั้ง โดยข้าม greeting ข้อความ `#0`
  Checks the native `.mes_reasoning` block of every generated bot reply, while skipping greeting message `#0`.
- เมื่อเปิดหรือสลับแชท จะตรวจ thinking block ของบอททุกข้อความตั้งแต่ `#1` และแสดงผลว่าตรวจแล้ว
  On chat load/switch, checks every bot thinking block after greeting `#0` and shows a completion result.
- มีคู่มือเริ่มใช้ Omega JB อธิบาย Engine ภาษา มุมมอง ความยาว และ Extension แบบทีละจุด
  Includes a step-by-step Omega JB beginner guide for engines, language, perspective, length, and extensions.
- บันทึกโปรไฟล์ Prompt + Regex ได้
  Saves Prompt + Regex profiles.
- แสดงรายการเปลี่ยนแปลงก่อนใช้โปรไฟล์ เตือนเมื่อ preset ไม่ตรง และย้อนกลับได้หนึ่งครั้ง
  Previews profile changes, warns on preset mismatch, and supports one-step undo.
- ส่งออกและนำเข้าโปรไฟล์เป็นไฟล์ JSON สำหรับสำรองหรือย้ายเครื่อง
  Export and import profiles as JSON for backup or migration.

## ติดตั้ง / Install

1. วางโฟลเดอร์นี้ไว้ที่
   Put this folder in:

   `SillyTavern/public/scripts/extensions/third-party/`

2. รีสตาร์ต SillyTavern แล้วเปิดใช้ **Omega Helper**
   Restart SillyTavern and enable **Omega Helper**.

   ต้องใช้ SillyTavern **1.13.5** ขึ้นไป
   Requires SillyTavern **1.13.5** or newer.

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

แหล่งแพตช์ / Patch source: [Gemini Omega 2.6 (15-8-26)](https://discord.com/channels/1325303011702079560/1455967291790331978/1537440603019808869)

## คำสั่ง / Commands

- `/omega` — เปิด Omega Helper / Open Omega Helper
- `/oh-check` — ตรวจการตั้งค่า / Check settings
- `/oh-fix` — แก้การตั้งค่าที่ตรวจพบ / Fix detected settings

## ตรวจสอบ / Verify

```bash
node selfcheck.mjs
```

## เครดิต / Credits

<img width="500" height="500" alt="7ac08547-4221-45a6-afa7-8716fa12505a" src="https://github.com/user-attachments/assets/a16a53fe-b9cd-4a19-b76e-1ebab3176340" />
