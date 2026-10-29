/**
 * src/lib/geminiService.ts
 *
 * خدمة الربط الآمن مع Google Gemini API لمساعد إدارة المخازن والتوريدات.
 *
 * سياسة الأمان:
 * 1. قراءة المفتاح من متغيرات البيئة السرية (import.meta.env.VITE_GEMINI_API_KEY) أو التخزين المحلي الآمن.
 * 2. عدم كتابة أي مفاتيح في الكود العام أو ملفات التتبع بـ Git.
 * 3. تزويد النموذج آلياً بلقطة حية (Live Snapshot) من قاعدة بيانات المخازن.
 */

import { getLiveWarehouseContext, queryLiveItemAvailability } from './chatbotLiveContext'
import { getQualityIssuesSummary } from './dataQualityAutoRepair'

const GEMINI_LOCAL_STORAGE_KEY = 'znu_gemini_api_key_secure'
/**
 * قائمة النماذج المعتمدة مع إمكانية التبديل التلقائي الذكي:
 * يتم تجربة النماذج الأخف والأسرع ذات الحصص اليومية العالية أولاً،
 * وفي حال وصول أي نموذج لحد الحصة اليومية المجانية (429 Quota Exceeded) أو انشغال الخادم (503)،
 * ينتقل النظام فوراً وبشكل شفاف للنموذج التالي لضمان استمرارية الخدمة.
 */
export const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
]

let cachedSystemPrompt: string | null = null
let lastPromptCacheTime = 0
const CACHE_TTL_MS = 60 * 1000 // كاش دقيقة واحدة لتسريع الاستجابة الفائقة

/**
 * الحصول على مفتاح Gemini الحالي (من البيئة أولاً ثم من التخزين المحلي)
 */
export function getGeminiApiKey(): string | null {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY
  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    return envKey.trim()
  }

  try {
    const localKey = localStorage.getItem(GEMINI_LOCAL_STORAGE_KEY)
    if (localKey && localKey.trim().length > 0) {
      return localKey.trim()
    }
  } catch {
    // localStorage not accessible
  }

  return null
}

/**
 * معرفة مصدر المفتاح الحالي
 */
export function getGeminiKeySource(): 'env' | 'local' | 'none' {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY
  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    return 'env'
  }

  try {
    const localKey = localStorage.getItem(GEMINI_LOCAL_STORAGE_KEY)
    if (localKey && localKey.trim().length > 0) {
      return 'local'
    }
  } catch {
    //
  }

  return 'none'
}

/**
 * حفظ المفتاح محلياً في المتصفح بأمان
 */
export function saveGeminiApiKeyLocal(key: string): void {
  const clean = key.trim()
  if (!clean) {
    localStorage.removeItem(GEMINI_LOCAL_STORAGE_KEY)
  } else {
    localStorage.setItem(GEMINI_LOCAL_STORAGE_KEY, clean)
  }
}

/**
 * مسح المفتاح المحلي
 */
export function clearGeminiApiKeyLocal(): void {
  try {
    localStorage.removeItem(GEMINI_LOCAL_STORAGE_KEY)
  } catch {
    //
  }
}

/**
 * التحقق مما إذا كان المفتاح متاحاً
 */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey())
}

/**
 * صياغة سياق التعليمات والبيانات الحية المباشرة لتمريرها للنموذج (مع كاش سريع)
 */
async function buildSystemContextPrompt(): Promise<string> {
  const now = Date.now()
  if (cachedSystemPrompt && now - lastPromptCacheTime < CACHE_TTL_MS) {
    return cachedSystemPrompt
  }

  const ctx = await getLiveWarehouseContext()

  const warehousesSummary = ctx.warehouses
    .map((w) => `  * ${w.name}: ${w.itemsCount} صنف مسجل، إجمالي ${w.totalUnits} وحدة. (أمثلة: ${w.itemsSample.join('، ') || 'لا توجد أصناف'})`)
    .join('\n')

  const pendingRequestsSummary = ctx.pendingRequests.length > 0
    ? ctx.pendingRequests.map((r) => `  * طلب #${r.requestNumber}: صنف «${r.item}» - كلية «${r.dept}» - كمية ${r.qty}`).join('\n')
    : '  * لا توجد طلبات صرف معلقة حالياً.'

  const contractsSummary = ctx.contractsSample.length > 0
    ? ctx.contractsSample.map((c) => `  * عقد «${c.title}» مع شركة «${c.supplier}» بقيمة ${c.value.toLocaleString()} ج.م حتى تاريخ ${c.endDate}`).join('\n')
    : '  * لا توجد عقود مسجلة.'

  const budgetSummary = ctx.budgetOverview.length > 0
    ? ctx.budgetOverview.map((b) => `  * ${b.dept}: المعتمد ${b.allocated.toLocaleString()} ج.م | المنصرف ${b.spent.toLocaleString()} ج.م | المتبقي ${b.remaining.toLocaleString()} ج.م`).join('\n')
    : '  * بيانات الميزانية جاري تحديثها.'

  const recentMovesSummary = ctx.recentMovements.length > 0
    ? ctx.recentMovements.map((m) => `  * [${m.type === 'in' ? 'وارد' : 'منصرف'}] ${m.item} (${m.qty} وحدة) - الطرف: ${m.party} - التاريخ: ${m.date}`).join('\n')
    : '  * لا توجد حركات حديثة.'

  const quality = getQualityIssuesSummary()

  const customDirectives =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('znu_chatbot_custom_developer_directives') || ''
      : ''

  cachedSystemPrompt = `أنت «المساعد الذكي الرسمي ومحرر الأكواد البرمجية لمنظومة إدارة مخازن وتوريدات جامعة الزقازيق الأهلية (ZNU)».
مهمتك مساعدة إدارة النظام وأمناء المخازن ومديري التوريدات، بالإضافة لعملك كمبرمج ومطور خبير (Senior Full-Stack Engineer & Database Administrator).

${customDirectives ? `تعليمات التطوير المخصصة من مدير النظام:\n${customDirectives}\n` : ''}

معلومات وبيانات المنظومة الحية المتزامنة لحظياً من قاعدة البيانات (Supabase & Ledger):
========================================================================
- إجمالي الأصناف بالمنظومة: ${ctx.totalItemsCount} صنف مسجل.
- إجمالي وحدات العهدة المتوفرة: ${ctx.totalCustodyUnits} وحدة.
- القيمة التقديرية الإجمالية للمخزون: ${ctx.totalCustodyValue.toLocaleString()} جنيه مصري.
- عدد طلبات الصرف المعلقة (بانتظار الاعتماد): ${ctx.pendingRequestsCount} طلب.
- عدد عقود التوريد السارية: ${ctx.activeContractsCount} عقد (${ctx.expiringContractsCount} عقد يقترب من الانتهاء).
- فحص مركز جودة البيانات: إجمالي ${quality.total} تنبيه (${quality.notes} ملاحظة، ${quality.warnings} تحذير، ${quality.errors} خطأ).
- أداة الإصلاح الذاتي التلقائي (Autonomous Auto-Repair Tool): لديك أداة برمجية متصلة تفحص وتعالج مشاكل الجودة آلياً (تحويل الأسعار المخزنة كنص لأرقام قياسية، تعيين أرقام الفواتير الناقصة، وتصحيح التواريخ). إذا طلب المستخدم منك إصلاح المشاكل، أو تصحيح الأخطاء، أخبره بأنك قمت بتشغيل أداة الإصلاح الذاتي ووجهه إلى /quality.

المخازن والكليات الثمانية (8) الحالية وأرصدتها:
${warehousesSummary}

طلبات الصرف المعلقة الحالية:
${pendingRequestsSummary}

عقود التوريد والصيانة الجارية:
${contractsSummary}

الميزانيات والاعتمادات المالية:
${budgetSummary}

أحدث حركات الوارد والمنصرف:
${recentMovesSummary}
========================================================================

قدرات المبرمج ومحرر الأكواد الذكي (AI Full-Stack Developer & DBA Capabilities):
- معمارية الواجهة: React 18, TypeScript, Tailwind CSS, Vite.
- معمارية الباك إند: Supabase Deno Edge Functions (admin-users, telegram-bot).
- معمارية قاعدة البيانات (PostgreSQL): تضم 16 جدولاً سحابياً مؤمناً بـ RLS:
  1. ledger_movements / movements (حركات الوارد والمنصرف)
  2. custody (كشف العهدة المخزنية)
  3. supplier_contracts (عقود الموردين والمرفقات)
  4. disbursement_requests (طلبات الصرف الداخلي)
  5. budget_plans (الميزانية والتخطيط المالي)
  6. financial_reports (التقارير المالية الدورية)
  7. asset_movement_log (سجل تتبع حركة الأصول)
  8. support_tickets (تذاكر الدعم الفني)
  9. technical_inspections (محاضر الفحص الفني)
  10. inventory_settlements (محاضر التسوية الجردية)
  11. app_users (المستخدمون والصلاحيات)
  12. audit_logs (سجل العمليات والتدقيق)
  13. telegram_bot_settings (إعدادات بوت التيليجرام)
  14. notifications (نظام الإشعارات)
  15. suppliers (الموردون المعتمدون)
  16. settings (إعدادات المؤسسة والشعار)
- عندما يطلب منك مدير النظام تعديل شيء في السيستم أو كتابة كود:
  1. اكتب كوداً برمجياً جاهزاً ودقيقاً مع ذكر اسم الملف ومساره.
  2. اكتب كود الهجرة PostgreSQL Migration متضمناً سياسات أمان RLS والفهارس.
  3. التزم دائماً بالتزامن الثلاثي: تطبيق التعديلات في الفرونت والباك إند وقاعدة البيانات معاً.
  4. الالتزام الصارم بعدم النشر على Vercel نهائياً والحفاظ على حسابات النظام المشرف (marwan-desouky).
  5. رابط صفحة إدارة الشات بوت وتوليد الأكواد: /chatbot-admin

قواعد وإرشادات الإجابة العامة:
1. أجب دائماً باللغة العربية الفصحى الواضحة والمهنية والودودة باختصار وتركيز.
2. نسق الإجابات والأكواد باستخدام Markdown وأقواس الكود البرمجي (Code Blocks).
3. عند السؤال عن رصيد صنف أو مكانه، استشهد بالأرقام والمخازن المذكورة أعلاه بدقة.
4. وفر روابط الصفحات في إجابتك عند الحاجة في سطر منفصل، مثل:
   - رابط صفحة إدارة الشات بوت البرمجي: /chatbot-admin
   - رابط صفحة طلبات الصرف: /disbursement-requests
   - رابط صفحة العقود: /contracts
   - رابط صفحة عروض الأسعار وأوامر الشراء: /purchases/quotes
   - رابط صفحة الميزانية: /budget
   - رابط صفحة مركز جودة البيانات: /quality
   - رابط صفحة الفحص والجرد: /inventory-analytics
   - رابط صفحة سجل حركة الأصول: /asset-history
   - رابط صفحة فواتير الشراء: /purchases
   - رابط صفحة سجل العمليات والتدقيق: /audit
   - رابط صفحة الدعم الفني: /support
5. بيانات الدعم الفني الرسمية: هاتف/واتساب 01011488621، بريد: marwandesowky2@gmail.com.`

  lastPromptCacheTime = now
  return cachedSystemPrompt
}

/**
 * اختبار الاتصال بمفتاح Gemini للتأكد من صحته
 */
export async function testGeminiConnection(keyToTest?: string): Promise<{ success: boolean; message: string }> {
  const apiKey = keyToTest?.trim() || getGeminiApiKey()
  if (!apiKey) {
    return { success: false, message: 'لم يتم توفير مفتاح API للاختبار.' }
  }

  try {
    let lastErrorMsg = ''
    for (const model of CANDIDATE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: 'قل كلمة "مرحباً" فقط للتأكد من الاتصال.' }],
            },
          ],
        }),
      })

      if (res.ok) {
        return { success: true, message: `تم التحقق من صحة مفتاح Gemini API بنجاح (${model})! 🟢` }
      }
      const errorData = await res.json().catch(() => ({}))
      lastErrorMsg = errorData?.error?.message || `فشل الاتصال برمز (${res.status})`
    }
    return { success: false, message: `خطأ من سيرفر Gemini: ${lastErrorMsg}` }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, message: `تعذر الوصول لخدمة Gemini: ${message}` }
  }
}

/**
 * إرسال رسالة واستقبال الرد من Gemini المدعوم بالبيانات الحية
 */
export async function askGeminiWithContext(
  userQuestion: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = []
): Promise<{ text: string; actionUrl?: string; actionLabel?: string }> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('NO_API_KEY')
  }

  // فحص مباشر لأي صنف في حال السؤال المباشر لإدراجه كـ Grounding إضافي
  const itemLookup = queryLiveItemAvailability(userQuestion)

  const systemPrompt = await buildSystemContextPrompt()

  // صياغة محتوى المحادثة
  const formattedContents: Array<{
    role: 'user' | 'model'
    parts: Array<{ text: string }>
  }> = []

  // إضافة التاريخ السابق إن وُجد (آخر 4 رسائل فقط للحفاظ على السرعة)
  const recentHistory = history.slice(-4)
  for (const h of recentHistory) {
    formattedContents.push({
      role: h.role,
      parts: [{ text: h.text }],
    })
  }

  // الرسالة الحالية للمستخدم مدمج بها استعلام الصنف المباشر إذا وجد
  let currentPromptText = userQuestion
  if (itemLookup) {
    currentPromptText = `${userQuestion}\n\n[بيانات لحظية مستخرجة فوراً من قاعدة البيانات لهذا الصنف:\n${itemLookup}\nاستخدم هذه الأرقام الدقيقة في إجابتك]`
  }

  formattedContents.push({
    role: 'user',
    parts: [{ text: currentPromptText }],
  })

  let candidateText: string | null = null
  let lastError: Error | null = null

  // تجربة النماذج بالترتيب مع التبديل التلقائي الذكي عند نفاد الحصة (429) أو بطء الاستجابة
  for (const model of CANDIDATE_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: formattedContents,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 800,
            topP: 0.95,
          },
        }),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const errorMsg = errorBody?.error?.message || `HTTP ${response.status}`
        console.warn(`Gemini model ${model} failed (${response.status}): ${errorMsg}. Trying next candidate...`)
        lastError = new Error(`GEMINI_API_ERROR (${model}): ${errorMsg}`)
        continue
      }

      const data = await response.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (text && typeof text === 'string' && text.trim().length > 0) {
        candidateText = text.trim()
        break
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const isAbort = (err as Error)?.name === 'AbortError'
      console.warn(`Gemini model ${model} failed (${isAbort ? 'Timeout' : 'Network/Error'}). Trying next candidate...`, err)
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (!candidateText) {
    throw lastError || new Error('EMPTY_GEMINI_RESPONSE')
  }

  const candidate = candidateText

  // استخراج رابط توجيه إذا وجد في الرد
  let actionUrl: string | undefined
  let actionLabel: string | undefined

  if (candidate.includes('/disbursement-requests')) {
    actionUrl = '/disbursement-requests'
    actionLabel = 'الانتقال لطلبات الصرف'
  } else if (candidate.includes('/contracts')) {
    actionUrl = '/contracts'
    actionLabel = 'الانتقال لعقود التوريد'
  } else if (candidate.includes('/budget')) {
    actionUrl = '/budget'
    actionLabel = 'الانتقال للميزانية والاعتمادات'
  } else if (candidate.includes('/inventory-analytics')) {
    actionUrl = '/inventory-analytics'
    actionLabel = 'الانتقال للتحليلات والجرد'
  } else if (candidate.includes('/asset-history')) {
    actionUrl = '/asset-history'
    actionLabel = 'الانتقال لسجل حركة الأصول'
  } else if (candidate.includes('/purchases')) {
    actionUrl = '/purchases'
    actionLabel = 'الانتقال لفواتير الشراء'
  } else if (candidate.includes('/quality')) {
    actionUrl = '/quality'
    actionLabel = 'الانتقال لمركز جودة البيانات'
  } else if (candidate.includes('/support')) {
    actionUrl = '/support'
    actionLabel = 'الانتقال للدعم الفني'
  }

  return {
    text: candidate.trim(),
    actionUrl,
    actionLabel,
  }
}

