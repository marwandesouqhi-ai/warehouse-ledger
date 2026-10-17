import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
}

// ─── Arabic Messages & Texts (Mandatory Exact Specifications) ────────────────
const WELCOME_MESSAGE = `أهلًا بك في نظام تسجيل الموظفين الخاص بحركة المخزن.

يمكنك تقديم طلب إنشاء حساب جديد من خلال البوت.

بعد تسجيل بياناتك والتحقق من بريدك الإلكتروني، سيتم إرسال طلبك للمراجعة والموافقة من الإدارة.

لن يتم منحك صلاحيات النظام حتى تتم الموافقة على حسابك.`

const ROLE_LABELS: Record<string, string> = {
  warehouse_employee: "موظف مخازن",
  warehouse_admin: "مشرف مخازن",
  procurement_employee: "موظف مشتريات",
  procurement_admin: "مشرف مشتريات",
}

const DEPT_LABELS: Record<string, string> = {
  warehouse: "المخازن",
  procurement: "المشتريات",
  "المخازن": "المخازن",
  "المشتريات": "المشتريات",
}

// ─── Cryptographic & OTP Helpers ──────────────────────────────────────────────
/**
 * Uniform 6-digit OTP generation using rejection sampling (no modulo bias).
 * Generates an integer uniformly in [100000, 999999].
 */
function generateUniform6DigitOtp(): string {
  const min = 100000
  const max = 999999
  const range = max - min + 1 // 900,000
  const maxUint32 = 0xFFFFFFFF
  const limit = maxUint32 - (maxUint32 % range)
  const buffer = new Uint32Array(1)
  let val = 0
  do {
    crypto.getRandomValues(buffer)
    val = buffer[0]
  } while (val >= limit)
  return String(min + (val % range))
}

/**
 * Hash token using SHA-256 with optional server-side pepper.
 */
async function hashTokenWithPepper(token: string, pepper?: string): Promise<string> {
  const encoder = new TextEncoder()
  const input = (pepper ? pepper + ":" : "") + token.trim()
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  if (aBytes.length !== bBytes.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

/**
 * Strict RFC 5322 compatible email validation regex.
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false
  return EMAIL_REGEX.test(email.trim())
}

// ─── External Email Sending Integration (Resend API) ──────────────────────────
interface EmailSendResult {
  success: boolean
  accepted: boolean
  error?: string
}

async function sendOtpEmailViaResend(
  resendApiKey: string,
  emailFrom: string,
  toEmail: string,
  recipientName: string,
  otpCode: string
): Promise<EmailSendResult> {
  if (!resendApiKey || !resendApiKey.startsWith("re_")) {
    return { success: false, accepted: false, error: "RESEND_API_KEY is not configured or invalid." }
  }

  const fromAddress = emailFrom || "Warehouse Ledger <noreply@resend.dev>"
  const subject = "رمز التحقق من البريد الإلكتروني - حركة المخزن"
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #0f172a; margin-top: 0;">رمز التحقق لتسجيل الموظفين</h2>
      <p style="color: #334155; font-size: 16px;">مرحباً <strong>${recipientName}</strong>،</p>
      <p style="color: #475569; font-size: 15px; line-height: 1.6;">
        لقد تم تقديم طلب تسجيل لحسابك في نظام حركة المخزن (Warehouse Ledger). للتحقق من ملكية بريدك الإلكتروني ومتابعة مراجعة الطلب من الإدارة، يرجى استخدام رمز التحقق التالي داخل بوت التيليجرام:
      </p>
      <div style="background: #f8fafc; border: 2px dashed #0284c7; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0284c7; font-family: monospace;">${otpCode}</span>
      </div>
      <p style="color: #64748b; font-size: 14px;">
        * هذا الرمز صالح لمدة <strong>10 دقائق فقط</strong> وللاستخدام لمرة واحدة.<br>
        * أدخل الرمز في بوت التيليجرام عبر الأمر: <code>/verify ${otpCode}</code><br>
        * إذا لم تكن قد طلبت التسجيل، يمكنك تجاهل هذه الرسالة بأمان.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
        نظام إدارة وحركة المخازن والمشتريات الموحد &copy; ${new Date().getFullYear()}
      </p>
    </div>
  `

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, accepted: false, error: `Resend HTTP ${res.status}: ${errText}` }
    }

    const data = await res.json().catch(() => ({}))
    return { success: true, accepted: Boolean(data.id) }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, accepted: false, error: msg }
  }
}

// ─── Telegram Message Sender ──────────────────────────────────────────────────
async function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: Record<string, unknown>) {
  if (!botToken) return
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
  }
  if (replyMarkup) {
    body.reply_markup = replyMarkup
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error("Telegram send error:", err)
  }
}

// ─── Rate Limiter Helper ──────────────────────────────────────────────────────
async function checkAndRecordRateLimit(
  supabaseAdmin: any,
  eventType: string,
  identifier: string,
  maxAllowed: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const cleanId = identifier.trim().toLowerCase()
  const threshold = new Date(Date.now() - windowSeconds * 1000).toISOString()

  const { data, count, error } = await supabaseAdmin
    .from("telegram_rate_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", eventType)
    .eq("identifier", cleanId)
    .gte("created_at", threshold)

  if (error) {
    // Fail open safely on rate event read error to avoid locking users, but log
    console.warn("Rate limit check error:", error)
    return { allowed: true, remaining: 1 }
  }

  const currentCount = count || 0
  if (currentCount >= maxAllowed) {
    return { allowed: false, remaining: 0 }
  }

  // Record this attempt
  await supabaseAdmin.from("telegram_rate_events").insert({
    event_type: eventType,
    identifier: cleanId,
  })

  return { allowed: true, remaining: maxAllowed - currentCount - 1 }
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // Strict: Reject non-POST requests immediately
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? ""
    const webhookSecret = (Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "").trim()
    const otpPepper = Deno.env.get("OTP_PEPPER") ?? ""
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? ""
    const emailFrom = Deno.env.get("EMAIL_FROM") ?? ""

    // 1. Fail Closed: If webhook secret is not configured, reject with 500 and process NOTHING
    if (!webhookSecret) {
      console.error("Configuration Error: TELEGRAM_WEBHOOK_SECRET is missing or empty. Rejecting request to prevent unauthenticated access.")
      return new Response(JSON.stringify({ error: "Server Configuration Error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Validate incoming secret header using constant-time comparison
    const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token") || ""
    if (!incomingSecret || !timingSafeEqual(incomingSecret, webhookSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized webhook caller" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const update = await req.json().catch(() => ({}))
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Update Deduplication (Idempotency)
    const updateId = update.update_id
    if (updateId) {
      const { error: dedupErr } = await supabaseAdmin
        .from("telegram_processed_updates")
        .insert({ update_id: updateId })

      if (dedupErr) {
        // Duplicate update received from Telegram retry; acknowledge immediately and process nothing
        return new Response("ok (duplicate update ignored)", { headers: corsHeaders })
      }
    }

    // ─── Handle Callback Query (Inline Buttons) ───────────────────────────────
    if (update.callback_query) {
      const query = update.callback_query
      const chatId = query.message?.chat?.id
      const data = query.data || ""
      const tgUser = query.from

      if (!chatId || !tgUser) {
        return new Response("ok", { headers: corsHeaders })
      }

      if (data === "register_start") {
        const promptMsg = `لبدء تسجيل طلبك، يرجى إرسال بياناتك برسالة نصية واحدة بالصيغة التالية:\n\n` +
          `<b>الاسم الكامل | البريد الإلكتروني | القسم | الدور المطلوب</b>\n\n` +
          `مثال:\n<code>أحمد محمد علي | ahmed@example.com | المخازن | موظف مخازن</code>`
        await sendTelegramMessage(botToken, chatId, promptMsg)
      }

      return new Response("ok", { headers: corsHeaders })
    }

    // ─── Handle Text Message ──────────────────────────────────────────────────
    const message = update.message
    if (!message || !message.text) {
      return new Response("ok", { headers: corsHeaders })
    }

    const chatId = message.chat.id
    const text = message.text.trim()
    const tgUser = message.from
    const tgUserId = tgUser?.id

    if (!tgUserId) {
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /start ─────────────────────────────────────────────────────
    if (text === "/start") {
      const keyboard = {
        inline_keyboard: [
          [{ text: "بدء التسجيل", callback_data: "register_start" }],
        ],
      }
      await sendTelegramMessage(botToken, chatId, WELCOME_MESSAGE, keyboard)
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /status ────────────────────────────────────────────────────
    if (text === "/status") {
      // Ownership check: strictly queries caller's own telegram_user_id
      const { data: request } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("telegram_user_id", tgUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!request) {
        await sendTelegramMessage(botToken, chatId, "لا يوجد طلب تسجيل مسجل لهذا الحساب. يمكنك تقديم طلب جديد عبر كتابة /start.")
        return new Response("ok", { headers: corsHeaders })
      }

      if (request.approval_status === "approved") {
        const msg = `تهانينا! تم اعتماد حسابك بنجاح.\n\nالرقم الوظيفي: <b>${request.employee_id}</b>\nالدور المعتمد: ${ROLE_LABELS[request.approved_role] || request.approved_role}\nالقسم: ${DEPT_LABELS[request.requested_department] || request.requested_department}\n\nيمكنك الآن تسجيل الدخول عبر واجهة النظام باستخدام الرقم الوظيفي أو اسم المستخدم.`
        await sendTelegramMessage(botToken, chatId, msg)
      } else if (request.approval_status === "rejected") {
        const msg = `تم رفض طلب التسجيل.\nسبب الرفض: ${request.rejection_reason || "لم يحدد"}\nيمكنك مراجعة إدارة النظام أو التقديم مرة أخرى عبر /start.`
        await sendTelegramMessage(botToken, chatId, msg)
      } else if (request.approval_status === "cancelled") {
        await sendTelegramMessage(botToken, chatId, "تم إلغاء طلب التسجيل السابق. يمكنك تقديم طلب جديد في أي وقت عبر /start.")
      } else if (request.verification_status === "delivery_failed") {
        await sendTelegramMessage(botToken, chatId, "تعذر إرسال رمز التحقق إلى بريدك الإلكتروني في المحاولة السابقة. يمكنك إعادة المحاولة عبر الأمر:\n/resend")
      } else if (request.verification_status !== "verified") {
        await sendTelegramMessage(botToken, chatId, "طلبك قيد انتظار التحقق من البريد الإلكتروني.\nيرجى كتابة رمز التحقق المكون من 6 أرقام المرسل لبريدك عبر الأمر:\n<code>/verify الرمز</code>\nأو طلب رمز جديد عبر:\n<code>/resend</code>")
      } else {
        await sendTelegramMessage(botToken, chatId, "تم التحقق من بريدك الإلكتروني بنجاح! طلبك قيد المراجعة والاعتماد لدى إدارة النظام حالياً.")
      }
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /cancel ────────────────────────────────────────────────────
    if (text === "/cancel") {
      const { data: request } = await supabaseAdmin
        .from("registration_requests")
        .select("id, approval_status")
        .eq("telegram_user_id", tgUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!request || request.approval_status === "cancelled") {
        await sendTelegramMessage(botToken, chatId, "لا يوجد طلب تسجيل معلق لإلغائه.")
        return new Response("ok", { headers: corsHeaders })
      }

      if (request.approval_status === "approved") {
        await sendTelegramMessage(botToken, chatId, "غير متاح: تم اعتماد حسابك مسبقاً بالفعل ولا يمكن إلغاء الحساب المعتمد من هنا. يرجى التواصل مع الإدارة.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Safe update: mark cancelled instead of deleting records
      await supabaseAdmin
        .from("registration_requests")
        .update({
          approval_status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id)

      await sendTelegramMessage(botToken, chatId, "تم إلغاء طلب التسجيل بنجاح. يمكنك تقديم طلب جديد في أي وقت عبر /start.")
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /resend ────────────────────────────────────────────────────
    if (text === "/resend") {
      const { data: request } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("telegram_user_id", tgUserId)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!request) {
        await sendTelegramMessage(botToken, chatId, "لا يوجد طلب تسجيل معلق لإعادة إرسال الرمز له.")
        return new Response("ok", { headers: corsHeaders })
      }

      if (request.verification_status === "verified") {
        await sendTelegramMessage(botToken, chatId, "تم التحقق من بريدك الإلكتروني مسبقاً! طلبك قيد المراجعة والاعتماد.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Check Resend Cooldown (60 seconds)
      if (request.last_resend_at) {
        const secondsSinceLast = (Date.now() - new Date(request.last_resend_at).getTime()) / 1000
        if (secondsSinceLast < 60) {
          const waitSec = Math.ceil(60 - secondsSinceLast)
          await sendTelegramMessage(botToken, chatId, `يرجى الانتظار لمدة ${waitSec} ثانية قبل إعادة طلب رمز التحقق مجدداً.`)
          return new Response("ok", { headers: corsHeaders })
        }
      }

      // Hourly Resend Cap: max 3 per hour
      const rateRes = await checkAndRecordRateLimit(supabaseAdmin, "resend", String(tgUserId), 3, 3600)
      if (!rateRes.allowed) {
        await sendTelegramMessage(botToken, chatId, "تم تجاوز الحد الأقصى لإعادة إرسال الرمز في الساعة الواحدة (3 محاولات). يرجى المحاولة لاحقاً.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Generate new uniform OTP and hash
      const newOtp = generateUniform6DigitOtp()
      const newHash = await hashTokenWithPepper(newOtp, otpPepper)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

      // Attempt send via Resend
      const emailRes = await sendOtpEmailViaResend(resendApiKey, emailFrom, request.email, request.full_name, newOtp)

      const sendStatus = emailRes.accepted ? "sent" : "failed"
      const verStatus = emailRes.accepted ? "pending" : "delivery_failed"

      await supabaseAdmin
        .from("registration_requests")
        .update({
          verification_token_hash: newHash,
          verification_token_expires_at: expiresAt,
          verification_attempts: 0,
          resend_count: (request.resend_count || 0) + 1,
          last_resend_at: new Date().toISOString(),
          email_send_status: sendStatus,
          verification_status: verStatus,
          email_sent_at: emailRes.accepted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id)

      if (!emailRes.accepted) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "تعذر إرسال رمز التحقق إلى بريدك الإلكتروني حالياً بسبب عدم اكتمال تهيئة مزود البريد في الخادم.\nتم تسجيل حالة الطلب، يرجى التواصل مع إدارة النظام."
        )
      } else {
        await sendTelegramMessage(
          botToken,
          chatId,
          "تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني (صالح لمدة 10 دقائق).\nيرجى فحص صندوق الوارد وإدخال الرمز عبر:\n<code>/verify الرمز</code>"
        )
      }
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /verify <code> ─────────────────────────────────────────────
    if (text.startsWith("/verify")) {
      const parts = text.split(/\s+/)
      const token = parts[1]?.trim()

      if (!token || !/^\d{6}$/.test(token)) {
        await sendTelegramMessage(botToken, chatId, "يرجى كتابة رمز التحقق المكون من 6 أرقام بعد الأمر، مثال:\n<code>/verify 123456</code>")
        return new Response("ok", { headers: corsHeaders })
      }

      // Rate limit verify attempts: max 10 attempts per 5 minutes per Telegram user
      const rateRes = await checkAndRecordRateLimit(supabaseAdmin, "verify", String(tgUserId), 10, 300)
      if (!rateRes.allowed) {
        await sendTelegramMessage(botToken, chatId, "تم تجاوز عدد محاولات التحقق المسموح بها مؤقتاً. يرجى الانتظار بضع دقائق والمحاولة مرة أخرى.")
        return new Response("ok", { headers: corsHeaders })
      }

      // 1. Fetch active request
      const { data: request } = await supabaseAdmin
        .from("registration_requests")
        .select("id, verification_status, approval_status")
        .eq("telegram_user_id", tgUserId)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!request) {
        await sendTelegramMessage(botToken, chatId, "لم يتم العثور على طلب تسجيل معلق للتحقق منه.")
        return new Response("ok", { headers: corsHeaders })
      }

      if (request.verification_status === "verified") {
        await sendTelegramMessage(botToken, chatId, "تم التحقق من بريدك مسبقاً! طلبك قيد المراجعة والاعتماد لدى الإدارة.")
        return new Response("ok", { headers: corsHeaders })
      }

      // 2. Atomic attempt increment using database RPC (race condition protection)
      const { data: attemptRows, error: rpcErr } = await supabaseAdmin.rpc("record_verification_attempt", {
        p_request_id: request.id,
        p_telegram_user_id: tgUserId,
      })

      if (rpcErr || !attemptRows || attemptRows.length === 0) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "تعذر التحقق: تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات) أو انتهت صلاحية الرمز (10 دقائق).\nيمكنك طلب رمز جديد عبر الأمر /resend أو إلغاء الطلب عبر /cancel."
        )
        return new Response("ok", { headers: corsHeaders })
      }

      const attemptResult = attemptRows[0]
      const storedHash = attemptResult.token_hash || ""
      const currentAttempts = attemptResult.attempts || 1

      // 3. Constant-time hash comparison
      const computedHash = await hashTokenWithPepper(token, otpPepper)
      const isMatch = timingSafeEqual(computedHash, storedHash)

      if (!isMatch) {
        const remainingAttempts = Math.max(0, 5 - currentAttempts)
        if (remainingAttempts === 0) {
          await sendTelegramMessage(
            botToken,
            chatId,
            "رمز التحقق غير صحيح. تم استنفاد كافة المحاولات الخمس المسموح بها لهذا الرمز.\nيرجى طلب رمز جديد عبر /resend."
          )
        } else {
          await sendTelegramMessage(
            botToken,
            chatId,
            `رمز التحقق غير صحيح. تبقى لك ${remainingAttempts} محاولات متبقية.`
          )
        }
        return new Response("ok", { headers: corsHeaders })
      }

      // 4. Mark verified atomically via RPC (also clears sensitive token hash)
      await supabaseAdmin.rpc("mark_verification_verified", {
        p_request_id: request.id,
        p_telegram_user_id: tgUserId,
      })

      await sendTelegramMessage(
        botToken,
        chatId,
        "تم التحقق من بريدك الإلكتروني بنجاح!\nتم إرسال طلبك إلى لوحة الإدارة للمراجعة والاعتماد.\nستتلقى إشعاراً هنا فور اعتماد حسابك وتخصيص رقمك الوظيفي."
      )
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── REGISTRATION INPUT PARSING ──────────────────────────────────────────
    // Format: الاسم الكامل | البريد الإلكتروني | القسم | الدور المطلوب
    if (text.includes("@") && (text.includes("مخازن") || text.includes("مشتريات") || text.includes("|") || text.includes(","))) {
      const parts = text.split(/[|,\n]/).map((p: string) => p.trim()).filter(Boolean)
      const fullName = parts[0]
      const rawEmail = parts.find((p: string) => p.includes("@")) || ""
      const email = rawEmail.trim().toLowerCase()
      const deptPart = parts.find((p: string) => p.includes("مخازن") || p.includes("مشتريات")) || ""
      const rolePart = parts.find((p: string) => p.includes("مشرف") || p.includes("مدير") || p.includes("موظف")) || ""

      // Input Validation: Name length and characters
      if (!fullName || fullName.length < 3 || fullName.length > 100) {
        await sendTelegramMessage(botToken, chatId, "يرجى كتابة اسم كامل صالح يتراوح طوله بين 3 و 100 حرف.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Input Validation: Strict Email Format
      if (!isValidEmail(email)) {
        await sendTelegramMessage(botToken, chatId, "صيغة البريد الإلكتروني غير صالحة. يرجى إدخال بريد إلكتروني صحيح.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Rate limit registration submissions: max 3 per hour per TG user and per email
      const rateTg = await checkAndRecordRateLimit(supabaseAdmin, "register", String(tgUserId), 3, 3600)
      const rateEmail = await checkAndRecordRateLimit(supabaseAdmin, "register", email, 3, 3600)

      if (!rateTg.allowed || !rateEmail.allowed) {
        await sendTelegramMessage(botToken, chatId, "تم تجاوز الحد الأقصى لطلبات التسجيل في الساعة الواحدة. يرجى الانتظار والمحاولة لاحقاً.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Allowlist validation for Department and Role
      const isWarehouse = deptPart.includes("مخازن") || deptPart.toLowerCase().includes("warehouse")
      const isProcurement = deptPart.includes("مشتريات") || deptPart.toLowerCase().includes("procurement")

      if (!isWarehouse && !isProcurement) {
        await sendTelegramMessage(botToken, chatId, "القسم المحدد غير مدعوم. الأقسام المتاحة هي: المخازن، أو المشتريات.")
        return new Response("ok", { headers: corsHeaders })
      }

      const requestedDept = isWarehouse ? "warehouse" : "procurement"
      const isAdminRole = rolePart.includes("مشرف") || rolePart.includes("مدير") || rolePart.toLowerCase().includes("admin")

      let requestedRole = isWarehouse
        ? (isAdminRole ? "warehouse_admin" : "warehouse_employee")
        : (isAdminRole ? "procurement_admin" : "procurement_employee")

      // Security rule: Ordinary registration can NEVER request or grant system_admin
      if (requestedRole === "system_admin" || text.toLowerCase().includes("system_admin")) {
        requestedRole = isWarehouse ? "warehouse_employee" : "procurement_employee"
      }

      // Duplicate Check with Parameterized Queries (NO string interpolation into PostgREST filter!)
      const { data: userByEmail } = await supabaseAdmin
        .from("app_users")
        .select("id")
        .eq("email", email)
        .maybeSingle()

      const { data: userByTg } = await supabaseAdmin
        .from("app_users")
        .select("id")
        .eq("telegram_user_id", tgUserId)
        .maybeSingle()

      if (userByEmail || userByTg) {
        // Generic response that does not leak specifics about other users
        await sendTelegramMessage(botToken, chatId, "تعذر إنشاء الطلب: توجد بيانات مسجلة مسبقاً تطابق هذا الحساب. يرجى مراجعة إدارة النظام.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Check active pending registration requests
      const { data: pendingByEmail } = await supabaseAdmin
        .from("registration_requests")
        .select("id")
        .eq("email", email)
        .eq("approval_status", "pending")
        .maybeSingle()

      const { data: pendingByTg } = await supabaseAdmin
        .from("registration_requests")
        .select("id")
        .eq("telegram_user_id", tgUserId)
        .eq("approval_status", "pending")
        .maybeSingle()

      if (pendingByEmail || pendingByTg) {
        await sendTelegramMessage(botToken, chatId, "يوجد طلب تسجيل معلق قيد المعالجة بالفعل لهذا الحساب أو البريد. يمكنك متابعة حالة الطلب عبر الأمر /status.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Generate Uniform 6-digit OTP and Hash with server pepper
      const otp = generateUniform6DigitOtp()
      const tokenHash = await hashTokenWithPepper(otp, otpPepper)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

      // Send OTP via server-side Resend API (NEVER in Telegram message!)
      const emailRes = await sendOtpEmailViaResend(resendApiKey, emailFrom, email, fullName, otp)

      const emailSendStatus = emailRes.accepted ? "sent" : "failed"
      const verificationStatus = emailRes.accepted ? "pending" : "delivery_failed"

      // Insert registration request
      const { error: insertErr } = await supabaseAdmin.from("registration_requests").insert({
        full_name: fullName,
        email: email,
        telegram_user_id: tgUserId,
        telegram_username: tgUser?.username || "",
        requested_department: requestedDept,
        requested_role: requestedRole,
        verification_status: verificationStatus,
        verification_token_hash: tokenHash,
        verification_token_expires_at: expiresAt,
        approval_status: "pending",
        email_send_status: emailSendStatus,
        email_sent_at: emailRes.accepted ? new Date().toISOString() : null,
      })

      if (insertErr) {
        throw insertErr
      }

      if (!emailRes.accepted) {
        const errorMsg = `تم استلام بياناتك بنجاح ولكن تعذر إرسال رمز التحقق إلى بريدك الإلكتروني حالياً بسبب عدم اكتمال تهيئة مزود البريد.\n\nالاسم: ${fullName}\nالبريد: ${email}\nالقسم: ${DEPT_LABELS[requestedDept]}\nالدور: ${ROLE_LABELS[requestedRole]}\n\nتم تسجيل طلبك بحالة (تعذر التسليم). يمكنك إعادة طلب إرسال الرمز لاحقاً عبر /resend.`
        await sendTelegramMessage(botToken, chatId, errorMsg)
      } else {
        const confirmMsg = `تم استلام بياناتك بنجاح!\n\nالاسم: ${fullName}\nالبريد: ${email}\nالقسم: ${DEPT_LABELS[requestedDept]}\nالدور: ${ROLE_LABELS[requestedRole]}\n\nتم إرسال رمز التحقق إلى بريدك الإلكتروني (صالح لمدة 10 دقائق).\nيرجى فحص صندوق الوارد (أو مجلد الرسائل غير المرغوب فيها) ثم كتابة الرمز هنا عبر الأمر:\n<code>/verify الرمز</code>`
        await sendTelegramMessage(botToken, chatId, confirmMsg)
      }

      return new Response("ok", { headers: corsHeaders })
    }

    // Default reply for unrecognized commands
    await sendTelegramMessage(
      botToken,
      chatId,
      "أهلاً بك! يمكنك بدء التسجيل عبر الأمر /start، أو فحص حالة طلبك عبر /status، أو إعادة إرسال الرمز عبر /resend، أو إلغاء الطلب عبر /cancel."
    )
    return new Response("ok", { headers: corsHeaders })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Error"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
