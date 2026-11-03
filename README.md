# Figma to Notion

Figma plugin ที่ส่ง layer ที่เลือกไปเป็นแถวใน Notion database พร้อมป้ายประเภท (Text, Image, Frame, Group, Shape)

## 1. เตรียม Notion

1. สร้าง integration ที่ https://www.notion.so/profile/integrations (Internal) แล้วคัดลอก Internal Integration Secret
2. สร้าง database ใหม่ใน Notion โดยมี property ดังนี้ (ชื่อต้องตรงทุกตัวอักษร)
   - `Name` เป็น Title (มีอยู่แล้วโดยค่าเริ่มต้น)
   - `Type` เป็น Select
   - `Status` เป็น Select (ตัวเลือกเช่น To do, Done)
   - `Figma` เป็น URL
3. เพิ่ม view แบบ Board แล้ว group ตาม `Type`
4. กด `...` ที่มุมขวาบนของ database > Connections > เชิญ integration ของคุณเข้ามา
5. คัดลอก URL ของ database ไว้ใช้ตั้งค่า

## 2. ติดตั้งใน Figma desktop

1. เปิด Figma desktop
2. ไปที่ Main menu > Plugins > Development > Import plugin from manifest...
3. เลือกไฟล์ `manifest.json` ในโฟลเดอร์นี้

## 3. ใช้งาน

1. เลือก layer ใน Figma
2. รัน Plugins > Development > Figma to Notion
3. ใส่ token และ database URL แล้วกดบันทึกการตั้งค่า (เก็บไว้ในเครื่องของ Figma)
4. ติ๊กเลือกรายการ ปรับประเภทถ้าจำเป็น แล้วกด ส่งไป Notion

## หมายเหตุ

- Image และ Frame จะ export เป็น PNG แล้วอัปโหลดเข้า Notion ทำให้ช้ากว่า Text
- Notion จำกัดประมาณ 3 request ต่อวินาที plugin หน่วงเวลาระหว่างรายการไว้แล้ว
- Token เก็บในเครื่องเท่านั้น ไม่ได้ฝังอยู่ในโค้ด
- ยังไม่ได้ทดสอบกับ Figma จริง ถ้าเจอ error ให้ดูข้อความในช่อง log ของ plugin
