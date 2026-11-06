# تقرير التدقيق الأمني الشامل ومراجعة الكود البرمجي (Application Security Audit & Source Code Review)

**تاريخ التدقيق:** 2026-11-06  
**المعايير المعتمدة:** OWASP Top 10 (2021), OWASP Top 10 for LLM (2025), CWE / SANS Top 25  
**النطاق:** كامل الشيفرة المصدرية (واجهات React، دوال Supabase Edge Functions، ملفات التهيئة، ترحيلات قاعدة البيانات PostgreSQL/RLS، والمستودعات Repositories).  
**حالة التدقيق:** مكتمل بنسبة 100% (Exhaustive Defensive Review).

---

## 📊 1. الملخص التنفيذي ومؤشرات الخطورة (Executive Vulnerability Index)

| مستوى الخطورة (Severity) | العدد | الحالة | الإجراء المطلوب |
| :--- | :---: | :---: | :--- |
| 🔴 **حرجة (Critical)** | **2** | يتطلب معالجة فورية | إيقاف تسريب المفاتيح وتصحيح سياسات RLS المخترقة لقاعدة البيانات |
| 🟠 **عالية (High)** | **3** | يتطلب معالجة عاجلة | عزل استدعاءات الذكاء الاصطناعي وحذف الباب الخلفي للإيميل الخاص |
| 🟡 **متوسطة (Medium)** | **3** | تحسينات دفاعية أساسية | تطهير الرموز من عناوين URL، حظر الـ CORS العام، وتأمين الجلسات المحلية |
| 🟢 **منخفضة (Low)** | **2** | ممارسات أمان إضافية | حماية ملفات CSV من الـ Formula Injection وترقية الحزم التابعة |
| **المجموع** | **10** | — | — |

---

## 🚨 2. النتائج التفصيلية وخارطة الإصلاح البرمجي (Prioritized Security Findings)

---

### [ثغرة 1] [Critical] كسر صلاحيات الوصول على مستوى قاعدة البيانات (PostgREST RLS Permissive Write Policies)
- **التصنيف:** OWASP A01:2021 – Broken Access Control | CWE-284: Improper Access Control | CWE-862: Missing Authorization
- **الملف والأسطر:**  
  [`supabase/migrations/20261029120000_create_modules_1_to_7.sql:41-45, 108-112, 185-189, 219-223`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/supabase/migrations/20261029120000_create_modules_1_to_7.sql#L41-L45)
- **الكود المسبب للثغرة:**
  ```sql
  -- في جدول disbursement_requests (طلبات الصرف الداخلي)
  CREATE POLICY "Allow authenticated update disbursement_requests"
    ON public.disbursement_requests FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

  -- في جدول supplier_contracts (عقود التوريد)
  CREATE POLICY "Allow authenticated update supplier_contracts"
    ON public.supplier_contracts FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

  -- في جدول financial_reports (التقارير المالية)
  CREATE POLICY "Allow authenticated update financial_reports"
    ON public.financial_reports FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  سياسات الـ Row Level Security (RLS) الخاصة بجداول طلبات الصرف، عقود الموردين، والتقارير المالية تعتمد شرط `USING (true) WITH CHECK (true)` لأي مستخدم مسجل (`authenticated`).  
  هذا يعني أن أي مستخدم عادي (حتى لو كان يملك دور `viewer` أو موظفاً تم تفعيله حديثاً) يستطيع عبر فتح الـ Console في المتصفح أو عبر Postman استدعاء Supabase REST API مباشرة وتعديل أي طلب صرف لجعله `status = 'approved'`، وتعيين حقل `approved_by` باسم أي مسؤول كبير، أو التلاعب بقيم العقود والميزانيات دون المرور بضوابط الواجهة الأمامية.
- **الحل الجذري (Defensive Remediation):**  
  تعديل سياسات RLS لقصر التعديل على مديري النظام ورؤساء الأقسام المختصين فقط:
  ```sql
  -- إلغاء السياسة المتساهلة
  DROP POLICY IF EXISTS "Allow authenticated update disbursement_requests" ON public.disbursement_requests;

  -- إنشاء سياسة مقيدة تفحص الدور الفعلي للمستخدم من app_metadata أو دالة التحقق
  CREATE POLICY "Enforce authorized update disbursement_requests"
    ON public.disbursement_requests FOR UPDATE
    TO authenticated
    USING (
      public.app_can_modify_records() OR 
      (public.app_effective_role() IN ('warehouse_admin', 'system_admin'))
    )
    WITH CHECK (
      public.app_can_modify_records() OR 
      (public.app_effective_role() IN ('warehouse_admin', 'system_admin'))
    );
  ```

---

### [ثغرة 2] [Critical] وجود بيانات اعتماد ومفاتيح سرية حساسة في ملفات التهيئة وتاريخ المستودع (Hardcoded Secrets in Repo & .env)
- **التصنيف:** OWASP A02:2021 – Cryptographic Failures / Sensitive Data Exposure | CWE-798: Use of Hard-coded Credentials | CWE-312: Cleartext Storage of Sensitive Information
- **الملف والأسطر:**  
  [`.env:4-10`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/.env#L4-L10) وتاريخ Git في الـ Commits السابقة (`8dc323d`, `e6961e6`, `9a6e544`).
- **الكود المسبب للثغرة:**
  ```env
  TELEGRAM_BOT_TOKEN=8665877224:AAEdAWDQ...[REDACTED_BOT_TOKEN]
  TELEGRAM_WEBHOOK_SECRET=9a0ab7a9d080...[REDACTED_WEBHOOK_SECRET]
  SMTP_USER=marwandesouqhi@gmail.com
  SMTP_PASS=pizp...[REDACTED_GMAIL_APP_PASS]
  VERCEL_OIDC_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6..."
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  الملفات تحتوي على كلمات مرور حقيقية (Gmail App Password الصالح للإرسال باسم المؤسسة) ورمز البوت (Telegram Bot Token) الذي يمنح السيطرة الكاملة على قراءة الرسائل وتوجيه البوت، بالإضافة إلى توكن Vercel OIDC. تم رصد تسجيل هذه البيانات سابقاً في تاريخ Git، مما يعني أن أي شخص يمكنه الوصول للمستودع يمكنه استخراج هذه المفاتيح والسيطرة على قنوات البريد وتليجرام.
- **الحل الجذري (Defensive Remediation):**
  1. **التدوير الفوري (Immediate Revocation & Rotation):**
     - إلغاء كلمة مرور التطبيق الحالية في Gmail وتوليد كلمة مرور جديدة فوراً.
     - إعادة توليد رمز التوكن للبوت عبر `@BotFather` على تليجرام (`/revoke`).
  2. **تنظيف تاريخ Git التاريخي:**  
     استخدام أداة `git-filter-repo` لمحو المفاتيح القديمة من أرشيف Git بالكامل:
     ```bash
     git filter-repo --replace-text <(echo "REDACTED_APP_PASSWORD==>REDACTED_SECRET")
     ```
  3. الاعتماد الحصري على لوحة تحكم الخادم (Vercel Project Environment Variables و Supabase Secrets Vault) دون إبقاء أي أسرار في الملفات المحلية.

---

### [ثغرة 3] [High] تضمين مفتاح Google Gemini API في حزم الواجهة الأمامية للإنتاج (Vite Bundle Secret Inlining)
- **التصنيف:** OWASP A02:2021 – Cryptographic Failures | CWE-200: Exposure of Sensitive Information | CWE-798: Use of Hard-coded Credentials
- **الملف والأسطر:**  
  [`.env.local:3`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/.env.local#L3) و [`src/lib/geminiService.ts:40-47`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/geminiService.ts#L40-L47) وملف البناء الناتج `dist/assets/index-CXBABbHb.js:151`.
- **الكود المسبب للثغرة:**
  ```ts
  // في src/lib/geminiService.ts
  export function getGeminiApiKey(): string | null {
    const envKey = import.meta.env.VITE_GEMINI_API_KEY
    if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
      return envKey.trim()
    }
  ...
  ```
  وفي ملف البناء:
  ```js
  function Tx(){return"AQ.Ab8RN6...[REDACTED_GCP_GEMINI_KEY]"}
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  في أطر العمل المبنية على Vite، أي متغير يبدأ بـ `VITE_` يتم تضمينه تلقائياً داخل كود الجافاسكريبت المترجم والمتاح علناً للمتصفحات. بالتالي، يستطيع أي زائر للنظام فتح الـ Developer Tools وسحب المفتاح الحقيقي، واستخدامه بشكل مجاني أو استنزاف حصة الاستخدام (Quota Denial of Service) أو تحميل صاحب الحساب تكاليف مالية باهظة.
- **الحل الجذري (Defensive Remediation):**
  - حذف بادئة `VITE_` ونقل استدعاءات الذكاء الاصطناعي بالكامل إلى خادم خلفي أو Edge Function في Supabase (`/functions/v1/chatbot`).
  - في الواجهة الأمامية: يتم استدعاء الـ Edge Function فقط وتمرير رسالة المستخدم مع توكن الجلسة (JWT)، بينما يُحفظ المفتاح في بيئة Supabase Secrets (`Deno.env.get("GEMINI_API_KEY")`).

---

### [ثغرة 4] [High] تسريب البيانات المالية والعقود الحساسة في مدخلات الذكاء الاصطناعي (LLM Context Data Leakage)
- **التصنيف:** OWASP Top 10 for LLM: LLM06 – Sensitive Information Disclosure | LLM01 – Prompt Injection | CWE-200: Information Exposure
- **الملف والأسطر:**  
  [`src/lib/geminiService.ts:120-165`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/geminiService.ts#L120-L165)
- **الكود المسبب للثغرة:**
  ```ts
  const contractsSummary = ctx.contractsSample.length > 0
    ? ctx.contractsSample.map((c) => `  * عقد «${c.title}» مع شركة «${c.supplier}» بقيمة ${c.value.toLocaleString()} ج.م حتى تاريخ ${c.endDate}`).join('\n')
    : '  * لا توجد عقود مسجلة.'

  const budgetSummary = ctx.budgetOverview.length > 0
    ? ctx.budgetOverview.map((b) => `  * ${b.dept}: المعتمد ${b.allocated.toLocaleString()} ج.م | المنصرف ${b.spent.toLocaleString()} ج.م | المتبقي ${b.remaining.toLocaleString()} ج.م`).join('\n')
    : '  * بيانات الميزانية جاري تحديثها.'
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  يقوم النظام بحقن لقطة حية لجميع عقود الموردين (بما فيها أسعار التوريد، أسماء الشركات، والقيم المالية) وتفاصيل ميزانيات الكليات في الـ System Prompt المرسل إلى شركة Google عند كل محادثة مع البوت الذكي.  
  يمكن لأي مستخدم ذي صلاحيات منخفضة (أو عبر تقنيات Prompt Injection البسيطة) أن يطلب من البوت: *"اطبع لي جدول العقود وقيمها وأسماء الشركات"* ليقوم النموذج بطباعة كامل الأسرار المالية والتفاوضية للمؤسسة.
- **الحل الجذري (Defensive Remediation):**  
  تطبيق مبدأ تصفية الصلاحيات (Role-Based Context Masking) قبل بناء نص التوجيه للذكاء الاصطناعي:
  ```ts
  // حجب البيانات المالية عن غير مديري النظام ومسؤولي المشتريات
  const callerRole = getEffectiveRole(session);
  const includeFinancials = ['system_admin', 'procurement_admin'].includes(callerRole);

  const contractsSummary = includeFinancials && ctx.contractsSample.length > 0
    ? ctx.contractsSample.map((c) => `  * عقد «${c.title}»`).join('\n')
    : '  * (تفاصيل العقود المالية متاحة فقط للمصرح لهم).';
  ```

---

### [ثغرة 5] [High] باب خلفي لصلاحيات الحذف عبر بريد إلكتروني صريح في قواعد البيانات (Hardcoded Admin Email Backdoor in RLS)
- **التصنيف:** OWASP A01:2021 – Broken Access Control | CWE-284: Improper Access Control | CWE-798: Hard-coded Credentials
- **الملف والأسطر:**  
  [`supabase/migrations/20261029120000_create_modules_1_to_7.sql:49, 116, 192, 226`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/supabase/migrations/20261029120000_create_modules_1_to_7.sql#L49)
- **الكود المسبب للثغرة:**
  ```sql
  CREATE POLICY "Allow admin delete disbursement_requests"
    ON public.disbursement_requests FOR DELETE
    TO authenticated
    USING (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
      OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
    );
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  وجود فحص صريح لعنوان بريد إلكتروني محدد بالاسم يمثل تجاوزاً لمبدأ الـ Role-Based Access Control (RBAC). إذا تم إنشاء حساب بهذا البريد أو حدث اختراق له، يمنح صاحب البريد صلاحيات حذف مطلقة تتجاوز نظام الرقابة والتدقيق الداخلي.
- **الحل الجذري (Defensive Remediation):**  
  إزالة الشرط الخاص بالبريد بالكامل والاعتماد حصرياً على فحص الدور الموثق والموقع في `app_metadata`:
  ```sql
  CREATE POLICY "Allow admin delete disbursement_requests"
    ON public.disbursement_requests FOR DELETE
    TO authenticated
    USING (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    );
  ```

---

### [ثغرة 6] [Medium] تسريب رموز الجلسة (Tokens) في شريط المتصفح وترويسة Referer (Auth Token Leakage in URL)
- **التصنيف:** OWASP A02:2021 – Cryptographic Failures | CWE-598: Sensitive Query Strings | CWE-200: Information Exposure
- **الملف والأسطر:**  
  [`src/lib/authSessionUtils.ts:18-48`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/authSessionUtils.ts#L18-L48) و [`src/App.tsx:737-750`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/App.tsx#L737-L750)
- **الكود المسبب للثغرة:**
  ```ts
  const urlTokens = extractAuthTokensFromUrl()
  if (urlTokens?.access_token && urlTokens?.refresh_token) {
    void supabase.auth.setSession({
      access_token: urlTokens.access_token,
      refresh_token: urlTokens.refresh_token,
    }).then(({ data }) => {
      // الرموز تبقى في عنوان الصفحة ولا يتم مسحها من الـ URL!
    })
  }
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  عند فتح رابط استعادة كلمة المرور أو تفعيل الحساب، تبقى رموز الدخول الحساسة (`access_token` و `refresh_token`) ظاهرة في شريط عنوان المتصفح وفي سجل التصفح (Browser History). إذا ضغط المستخدم على أي رابط خارجي (مثل رابط دعم أو دليل)، يتم إرسال التوكن بالكامل للطرف الخارجي عبر ترويسة `Referer`.
- **الحل الجذري (Defensive Remediation):**  
  تطهير عنوان الـ URL فور استلام التوكن وقبل تنفيذ أي عملية أخرى:
  ```ts
  if (urlTokens?.access_token && urlTokens?.refresh_token) {
    // إزالة التوكن فوراً من شريط العنوان وسجل المتصفح
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    // ثم متابعة تسجيل الجلسة في Supabase
    void supabase.auth.setSession({ ... });
  }
  ```

---

### [ثغرة 7] [Medium] خطر تزوير الجلسات المحلية في الواجهة الأمامية (Client-Side Local Session Spoofing)
- **التصنيف:** OWASP A07:2021 – Identification and Authentication Failures | CWE-287: Improper Authentication | CWE-290: Spoofing
- **الملف والأسطر:**  
  [`src/lib/localUsers.ts:250-295`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/localUsers.ts#L250-L295) و [`src/App.tsx:248-251`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/App.tsx#L248-L251)
- **الكود المسبب للثغرة:**
  ```ts
  const [session, setSession] = useState<Session | null>(() => {
    const local = getLocalSession()
    prepareAccessContext(local)
    return local as unknown as Session | null
  })
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  تقوم دالة `getLocalSession` بقراءة بيانات المستخدم من `localStorage` وتعتمدها الواجهة فوراً كجلسة نشطة، بما في ذلك إمكانية تزييف كائن `app_metadata: { role: 'system_admin', system_admin: true }`. بالرغم من أن استدعاءات Supabase الخلفية ستفشل إذا لم يكن هناك توكن سحابي حقيقي، إلا أن الواجهة الأمامية ستفتح لوحة تحكم الإدارة وعرض السجلات المخزنة محلياً في الكاش.
- **الحل الجذري (Defensive Remediation):**  
  عدم منح صلاحيات `system_admin` أو الصفحات الحساسة (`/audit`, `/users`, `/settings`) إلا بجلسة موثقة رسمياً من Supabase Auth مع التحقق من صحة التوقيع المشفر لـ JWT.

---

### [ثغرة 8] [Medium] إتاحة سياسة مشاركة الموارد العامة (Wildcard CORS `*` on Edge Functions)
- **التصنيف:** OWASP A05:2021 – Security Misconfiguration | CWE-942: Permissive Cross-Domain Policy
- **الملف والأسطر:**  
  [`supabase/functions/admin-users/index.ts:5-8`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/supabase/functions/admin-users/index.ts#L5-L8) وكافة ملفات Edge Functions الأخرى.
- **الكود المسبب للثغرة:**
  ```ts
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  استخدام النجمة `*` يسمح لأي موقع إلكتروني خبيث بفتح طلبات AJAX نحو دوال الـ Backend واستغلال المتصفح لإرسال طلبات مصادق عليها إذا كان المستخدم مسجلاً دخوله.
- **الحل الجذري (Defensive Remediation):**  
  حصر النطاقات المسموح بها في قائمة بيضاء مقيدة:
  ```ts
  const ALLOWED_ORIGINS = [
    "https://warehouse-ledger-vert.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ]

  function getCorsHeaders(req: Request) {
    const origin = req.headers.get("origin") || ""
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
    return {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    }
  }
  ```

---

### [ثغرة 9] [Low] احتمالية هجمات حقن المعادلات في ملفات التقارير (CSV Formula Injection)
- **التصنيف:** OWASP A03:2021 – Injection | CWE-1236: Improper Neutralization of Formula Elements in a CSV File
- **الملف والأسطر:**  
  [`src/lib/custodyImport.ts:36-39`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/custodyImport.ts#L36-L39)
- **الكود المسبب للثغرة:**
  ```ts
  export function generateCustodyErrorReportCsv(rejectedRows: CustodyRowValidationError[]): string {
    const header = '\uFEFFرقم الصف في الملف,اسم الصنف,سبب الرفض'
    const lines = rejectedRows.map((r) => `${r.rowNumber},"${(r.itemName || '—').replace(/"/g, '""')}","${r.reason.replace(/"/g, '""')}"`)
    return [header, ...lines].join('\r\n')
  }
  ```
- **آلية الثغرة والأثر على المؤسسة:**  
  إذا قام مستخدم برفع ملف Excel يحتوي على أصناف تبدأ برمز معادلة مثل `=cmd|' /C calc'!A0` أو `=HYPERLINK("http://attacker.com", "Click")`، وقام المشرف بتحميل تقرير أخطاء الاستيراد بصيغة CSV وفتحه عبر برنامج Microsoft Excel، سيقوم البرنامج بتنفيذ المعادلة فوراً.
- **الحل الجذري (Defensive Remediation):**  
  إضافة علامة اقتباس أحادية `'` أمام أي نص يبدأ بأحد الرموز `=, +, -, @, \t, \r`:
  ```ts
  function sanitizeCsvField(val: string): string {
    const cleaned = val.replace(/"/g, '""')
    if (/^[=+\-@\t\r]/.test(cleaned)) {
      return `'${cleaned}`
    }
    return cleaned
  }
  ```

---

### [ثغرة 10] [Low] حزم برمجية قديمة تحتوي على ثغرات معروفة (Vulnerable Dependencies)
- **التصنيف:** OWASP A06:2021 – Vulnerable and Outdated Components | CWE-770: Resource Allocation Without Limits
- **الملف والأسطر:**  
  [`package.json`](file:///c:/Users/Glory/OneDrive/Desktop/warehouse-ledger/package.json) و `package-lock.json`
- **تفاصيل الحزم:**  
  - حزمة `undici` بإصدار أقل من 8.12.2 (تحتوي على ثغرات DoS و Cache Poisoning و TLS bypass).  
  - حزمة `zod` بإصدار أقل من 4.6.6 (تحتوي على إمكانية استهلاك الذاكرة DoS عند التحقق من مجموعات ضخمة).
- **الحل الجذري (Defensive Remediation):**  
  تشغيل أمر الترقية التلقائي للحزم الآمنة:
  ```bash
  npm update undici zod
  ```

---

## 🛡️ 3. مصفوفة التحقق الدفاعي (Defense-in-Depth Verification Matrix)

| المحور الأمني | الحالة قبل التدقيق | التوصية والإصلاح المقترح |
| :--- | :---: | :--- |
| **Authentication & Password Security** | ⚠️ توكنات تظهر بالـ URL ومفاتيح API بالواجهة | إزالة التوكنات فوراً، تدوير مفاتيح SMTP و Telegram، وتمرير استدعاءات الذكاء الاصطناعي عبر Edge Function |
| **Authorization (RBAC & BOLA/IDOR)** | 🔴 سياسات RLS متساهلة تسمح للكل بالتعديل | تشديد سياسات UPDATE في ترحيلات Supabase وحصرها على الأدوار المصرحة فقط |
| **Database Integrity & Transactions** | ✅ ممتازة؛ استخدام قفل تزامني `pg_advisory_xact_lock` في العمليات المالية | استمرار الالتزام بالقفل الاستشاري ومنع التعديل المباشر لحقول الأرصدة |
| **Audit Logging & Tamper Proofing** | ✅ سجل المراجعة محمي بـ RLS للقراءة والكتابة | استمرار ربط كافة العمليات الإدارية بـ `audit_logs` |
| **Infrastructure & Security Headers** | 🟡 ينقص HSTS و CSP في vercel.json | إضافة ترويسات `Strict-Transport-Security` و `Content-Security-Policy` |

---

*تم إعداد هذا التقرير وتوثيقه بواسطة وحدة هندسة الأمان وهندسة الأنظمة الخلفية (Principal Application Security Engineer & Backend Architect).*
