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

const GEMINI_LOCAL_STORAGE_KEY = 'znu_gemini_api_key_secure'
const DEFAULT_MODEL = 'gemini-3-flash-preview'

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

  cachedSystemPrompt = `أنت «المساعد الذكي الرسمي لمنظومة إدارة مخازن وتوريدات جامعة الزقازيق الأهلية (ZNU)».
مهمتك مساعدة أمناء المخازن، مديري التوريدات، عمداء الكليات، ومسؤولي العهد في الجامعة.

معلومات وبيانات المنظومة الحية المتزامنة لحظياً من قاعدة البيانات (Supabase & Ledger):
========================================================================
- إجمالي الأصناف بالمنظومة: ${ctx.totalItemsCount} صنف مسجل.
- إجمالي وحدات العهدة المتوفرة: ${ctx.totalCustodyUnits} وحدة.
- القيمة التقديرية الإجمالية للمخزون: ${ctx.totalCustodyValue.toLocaleString()} جنيه مصري.
- عدد طلبات الصرف المعلقة (بانتظار الاعتماد): ${ctx.pendingRequestsCount} طلب.
- عدد عقود التوريد السارية: ${ctx.activeContractsCount} عقد (${ctx.expiringContractsCount} عقد يقترب من الانتهاء).

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

قواعد وإرشادات الإجابة:
1. أجب دائماً باللغة العربية الفصحى الواضحة والمهنية والودودة باختصار وتركيز.
2. نسق الإجابات باستخدام Markdown (عناوين، نقاط، خط عريض للبيانات الهامة والأرقام).
3. عند السؤال عن رصيد صنف أو مكانه، استشهد بالأرقام والمخازن المذكورة أعلاه بدقة.
4. إذا سأل المستخدم عن إجراءات أو لوائح (صرف داخلي، تسوية جردية، فحص واستلام، مناقصات)، اشرح له الخطوات المعتمدة بالجامعة بالترتيب.
5. وفر روابط الصفحات في إجابتك عند الحاجة في سطر منفصل، مثل:
   - رابط صفحة طلبات الصرف: /disbursement-requests
   - رابط صفحة العقود: /contracts
   - رابط صفحة الميزانية: /budget
   - رابط صفحة الفحص والجرد: /inventory-analytics
   - رابط صفحة سجل حركة الأصول: /asset-history
   - رابط صفحة فواتير الشراء: /purchases
   - رابط صفحة الدعم الفني: /support
6. بيانات الدعم الفني الرسمية: هاتف/واتساب 01011488621، بريد: marwandesowky2@gmail.com.`

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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
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

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      const errMsg = errorData?.error?.message || `فشل الاتصال برمز (${res.status})`
      return { success: false, message: `خطأ من سيرفر Gemini: ${errMsg}` }
    }

    return { success: true, message: 'تم التحقق من صحة مفتاح Gemini API بنجاح! 🟢' }
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`

  // إعداد مهلة زمنية كافية (12 ثانية) لاستيعاب معالجة وتوليد الرد بالكامل دون قطع الاتصال مبكراً
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)

  let response: Response
  try {
    response = await fetch(url, {
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
  } catch (fetchErr) {
    clearTimeout(timeoutId)
    throw fetchErr
  }
  clearTimeout(timeoutId)

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}`
    throw new Error(`GEMINI_API_ERROR: ${errorMsg}`)
  }

  const data = await response.json()
  const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!candidate || typeof candidate !== 'string') {
    throw new Error('EMPTY_GEMINI_RESPONSE')
  }

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

