# SECRETS ROTATION REQUIRED

**تاريخ اكتشاف التسريب:** 2026-10-21
**المرحلة:** تقرير تدقيق أمني (Security Audit)

---

## ملخص

تم اكتشاف وجود **أسرار حقيقية (real secrets)** في ملفات بيئة محلية لا يُفترض مشاركتها.
ملفات `.env*` و `.vercel` **مُدرجة في `.gitignore` وغير متتبّعة** في تاريخ Git - إذ أثبت التحقق:

```
git log --all --full-history -- .env                          => لا commits
git log --all --full-history -- .vercel/.env.production.local => لا commits
git ls-files .env    => error: did not match any file known to git
git ls-files .vercel => error: did not match any file known to git
```

لذا **لا حاجة لتنظيف Git history**. الخطر الحالي هو الأسرار المكتوبة داخل **كود المصدر مباشرةً** (تم إصلاحها في الأولوية 2).

---

## الأسرار التي تحتاج تدوير (Rotation)

> لا تُدوَّر هذه القيم داخل الكود - يجب تدويرها يدوياً من لوحة تحكم الخدمة المعنية.

### 1. Gmail App Password — SMTP_PASS

- **الملف:** `.env` السطر 11
- **المتغير:** `SMTP_PASS`
- **الحساب:** `marwandesouqhi@gmail.com`
- **الموقع الثاني:** `supabase/functions/admin-users/index.ts` (تمت إزالة الـ fallback في هذا الإصلاح)

**خطوات التدوير:**
1. اذهب إلى https://myaccount.google.com/apppasswords
2. احذف App Password الحالي
3. أنشئ App Password جديد
4. حدّث المتغير في Supabase Edge Functions Secrets:
   `supabase secrets set SMTP_PASS=<NEW_VALUE>`
5. حدّث `.env` المحلي بالقيمة الجديدة

---

### 2. Telegram Bot Token — TELEGRAM_BOT_TOKEN

- **الملف:** `.env` السطر 5
- **المتغير:** `TELEGRAM_BOT_TOKEN`
- **النمط:** `\d+:AAE...`

**خطوات التدوير:**
1. افتح محادثة @BotFather على Telegram
2. أرسل `/mybots` -> اختر البوت -> `API Token` -> `Revoke current token`
3. حدّث المتغير: `supabase secrets set TELEGRAM_BOT_TOKEN=<NEW_TOKEN>`
4. حدّث `.env` المحلي

---

### 3. Vercel OIDC Token — VERCEL_OIDC_TOKEN

- **الملفات:** `.env` السطر 3، `.vercel/.env.production.local` السطر 20
- **ملاحظة:** توكن JWT منتهي الصلاحية بالفعل (exp في الـ payload يسبق التاريخ الحالي) - منخفض الأولوية
- **التدوير:** يتجدد تلقائياً عند تشغيل `vercel link` من جديد

---

### 4. Supabase Publishable Key — VITE_SUPABASE_PUBLISHABLE_KEY

- **ملاحظة:** هذا مفتاح `anon/publishable` مصمّم للواجهة الأمامية ومقبول أن يكون عاماً **بشرط تفعيل RLS الصحيح**
- **الإجراء المطلوب:** تفعيل RLS (الأولوية 3) هو الضمان الحقيقي

---

### 5. UUID ثابت مكتوب في الكود

- **الملف:** `supabase/functions/admin-users/index.ts` السطر 366 (القديم)
- **الحالة:** **تمت إزالته** في الأولوية 5 من هذا الإصلاح الأمني

---

## الإجراءات المطلوبة منك (تدخل يدوي)

- [ ] تدوير `SMTP_PASS` (Gmail App Password) — **أولوية عالية جداً**
- [ ] تدوير `TELEGRAM_BOT_TOKEN` — **أولوية عالية**
- [ ] تحديث Supabase Secrets بعد التدوير
- [ ] تحديث `.env` المحلي بالقيم الجديدة
- [ ] (اختياري) إعادة تشغيل `vercel link` لتجديد OIDC Token

---

## ما تم إصلاحه برمجياً

 - الأولوية 2: إزالة قيمة SMTP الثابتة من نسخة سابقة من دالة admin-users.
- الأولوية 5: إزالة fallback انتحال هوية المدير (UUID + email مكتوب في الكود)
- إضافة GitHub Action لمنع commit أي أسرار مستقبلاً
