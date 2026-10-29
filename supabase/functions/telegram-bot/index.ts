// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
}

// ─── Arabic Messages & Texts (Mandatory Exact Specifications) ────────────────
const WELCOME_MESSAGE = `أهلًا بك في نظام تسجيل الموظفين الخاص ب ZNU-Warehouse-Ledger .

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

// ─── External Email Sending Integration (Gmail SMTP & Resend API) ─────────────
interface EmailSendResult {
  success: boolean
  accepted: boolean
  error?: string
}

interface EmailProviderConfig {
  resendApiKey?: string
  emailFrom?: string
  smtpUser?: string
  smtpPass?: string
  smtpHost?: string
  smtpPort?: number
}

async function sendOtpEmail(
  config: EmailProviderConfig,
  toEmail: string,
  recipientName: string,
  otpCode: string
): Promise<EmailSendResult> {
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

  // 1. Try Gmail / Custom SMTP if configured
  if (config.smtpUser && config.smtpPass) {
    try {
      const port = config.smtpPort || 465
      const transporter = nodemailer.createTransport({
        host: config.smtpHost || "smtp.gmail.com",
        port,
        secure: port === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      })

      const fromAddress = config.emailFrom || `Warehouse Ledger <${config.smtpUser}>`
      await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        subject,
        html,
      })
      return { success: true, accepted: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("SMTP send error:", msg)
      if (!config.resendApiKey) {
        return { success: false, accepted: false, error: `SMTP Error: ${msg}` }
      }
    }
  }

  // 2. Try Resend API if configured
  if (config.resendApiKey && config.resendApiKey.startsWith("re_")) {
    const fromAddress = config.emailFrom || "Warehouse Ledger <onboarding@resend.dev>"
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.resendApiKey}`,
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

  return {
    success: false,
    accepted: false,
    error: "لم يتم تهيئة مزود البريد في الخادم (يرجى ضبط SMTP_USER و SMTP_PASS لـ Gmail، أو RESEND_API_KEY).",
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

// ─── Callback Query Answerer ──────────────────────────────────────────────────
async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string) {
  if (!botToken || !callbackQueryId) return
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch {
    // ignore
  }
}

// ─── User Session Management for Multi-Step Registration ─────────────────────
interface UserSession {
  step: "awaiting_name" | "awaiting_email" | "awaiting_dept" | "awaiting_role" | "confirm"
  fullName?: string
  email?: string
  department?: string
  role?: string
}

const memorySessions = new Map<number, UserSession>()

async function getUserSession(supabaseAdmin: any, tgUserId: number): Promise<UserSession | null> {
  // 1. Try dedicated table first (supports both jsonb session_data and flat columns)
  try {
    const { data, error } = await supabaseAdmin
      .from("telegram_user_sessions")
      .select("*")
      .eq("telegram_user_id", tgUserId)
      .maybeSingle()
    if (!error && data) {
      // Schema A: jsonb session_data column
      if (data.session_data && typeof data.session_data === "object" && data.session_data.step) {
        return data.session_data as UserSession
      }
      // Schema B: flat columns
      if (data.step) {
        return {
          step: data.step,
          fullName: data.full_name,
          email: data.email,
          department: data.department,
          role: data.role,
        }
      }
    }
  } catch (e) {
    console.warn("telegram_user_sessions read warning:", e)
  }

  // 2. Fallback: try reading from telegram_rate_events (guaranteed on remote database)
  try {
    const { data, error } = await supabaseAdmin
      .from("telegram_rate_events")
      .select("identifier, created_at")
      .eq("event_type", `session:${tgUserId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data?.identifier) {
      const parsed = JSON.parse(data.identifier) as UserSession
      if (parsed && parsed.step) {
        return parsed
      }
    }
  } catch {
    // fallback
  }

  // 3. Fallback to in-memory map
  return memorySessions.get(tgUserId) || null
}

async function saveUserSession(supabaseAdmin: any, tgUserId: number, session: UserSession): Promise<void> {
  memorySessions.set(tgUserId, session)

  // 1. Save to telegram_user_sessions: resilient to both session_data JSONB and flat columns schemas
  try {
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await supabaseAdmin
      .from("telegram_user_sessions")
      .delete()
      .lt("updated_at", staleThreshold)

    // Attempt A: flat columns + session_data jsonb combined
    const fullPayload = {
      telegram_user_id: tgUserId,
      step: session.step,
      full_name: session.fullName || null,
      email: session.email || null,
      department: session.department || null,
      role: session.role || null,
      session_data: session,
      updated_at: new Date().toISOString(),
    }

    const { error: errA } = await supabaseAdmin
      .from("telegram_user_sessions")
      .upsert(fullPayload, { onConflict: "telegram_user_id" })

    if (errA) {
      // Attempt B: session_data JSONB column only
      const jsonPayload = {
        telegram_user_id: tgUserId,
        session_data: session,
        updated_at: new Date().toISOString(),
      }
      const { error: errB } = await supabaseAdmin
        .from("telegram_user_sessions")
        .upsert(jsonPayload, { onConflict: "telegram_user_id" })

      if (errB) {
        // Attempt C: flat columns only (without session_data column)
        const flatPayload = {
          telegram_user_id: tgUserId,
          step: session.step,
          full_name: session.fullName || null,
          email: session.email || null,
          department: session.department || null,
          role: session.role || null,
          updated_at: new Date().toISOString(),
        }
        await supabaseAdmin
          .from("telegram_user_sessions")
          .upsert(flatPayload, { onConflict: "telegram_user_id" })
      }
    }
  } catch (err) {
    console.warn("telegram_user_sessions save exception:", err)
  }

  // 2. Always persist fallback in telegram_rate_events so stateless Edge Functions never lose wizard state
  try {
    await supabaseAdmin
      .from("telegram_rate_events")
      .delete()
      .eq("event_type", `session:${tgUserId}`)

    await supabaseAdmin
      .from("telegram_rate_events")
      .insert({
        event_type: `session:${tgUserId}`,
        identifier: JSON.stringify(session),
      })
  } catch (err) {
    console.warn("telegram_rate_events session backup notice:", err)
  }
}

async function clearUserSession(supabaseAdmin: any, tgUserId: number): Promise<void> {
  memorySessions.delete(tgUserId)
  try {
    await supabaseAdmin
      .from("telegram_user_sessions")
      .delete()
      .eq("telegram_user_id", tgUserId)
  } catch {
    // ignore
  }
  try {
    await supabaseAdmin
      .from("telegram_rate_events")
      .delete()
      .eq("event_type", `session:${tgUserId}`)
  } catch {
    // ignore
  }
}

// ─── Registration Execution Core ──────────────────────────────────────────────
async function executeRegistration(params: {
  supabaseAdmin: any
  botToken: string
  chatId: number
  tgUserId: number
  tgUsername: string
  fullName: string
  email: string
  requestedDept: string
  requestedRole: string
  otpPepper: string
  emailConfig: EmailProviderConfig
}) {
  const {
    supabaseAdmin,
    botToken,
    chatId,
    tgUserId,
    tgUsername,
    fullName,
    email,
    requestedDept,
    requestedRole,
    otpPepper,
    emailConfig,
  } = params

  const cleanEmail = email.trim().toLowerCase()

  // 1. Rate limit registration submissions: max 15 per hour per TG user and 3 per email
  const rateTg = await checkAndRecordRateLimit(supabaseAdmin, "register", String(tgUserId), 15, 3600)
  const rateEmail = await checkAndRecordRateLimit(supabaseAdmin, "register", cleanEmail, 3, 3600)

  if (!rateTg.allowed || !rateEmail.allowed) {
    await sendTelegramMessage(botToken, chatId, "تم تجاوز الحد الأقصى لطلبات التسجيل في الساعة الواحدة. يرجى الانتظار والمحاولة لاحقاً.")
    return
  }

  // 2. Duplicate Check: only check if this exact email is already registered in app_users
  const { data: userByEmail } = await supabaseAdmin
    .from("app_users")
    .select("id, email")
    .ilike("email", cleanEmail)
    .maybeSingle()

  if (userByEmail) {
    await sendTelegramMessage(botToken, chatId, `⚠️ تعذر إنشاء الطلب: البريد الإلكتروني (${email}) مسجل وموجود بالفعل في قاعدة بيانات النظام لموظف سابق أو حالي. يرجى مراجعة إدارة النظام.`)
    return
  }

  // 3. Check active pending registration requests strictly by email
  const { data: pendingByEmail } = await supabaseAdmin
    .from("registration_requests")
    .select("id, full_name, email")
    .ilike("email", cleanEmail)
    .eq("approval_status", "pending")
    .maybeSingle()

  if (pendingByEmail) {
    await sendTelegramMessage(botToken, chatId, `⏳ يوجد طلب تسجيل معلق قيد المراجعة والاعتماد بالفعل لهذا البريد الإلكتروني (${email}). فور موافقة الإدارة ستصلك رسالة دعوة لتفعيل حسابك على هذا البريد.`)
    return
  }

  // 4. Insert registration request directly for Admin review (NO Telegram OTP)
  // verification_status is set to 'verified' so it is immediately eligible for Admin review & invitation sending
  // (Legacy note: previously verificationStatus = emailRes.accepted ? "pending" : "delivery_failed" with "تعذر إرسال رمز التحقق إلى بريدك الإلكتروني حالياً")
  const insertPayload: Record<string, any> = {
    full_name: fullName,
    email: email,
    telegram_user_id: tgUserId,
    telegram_username: tgUsername || "",
    requested_department: requestedDept,
    requested_role: requestedRole,
    verification_status: "verified",
    approval_status: "pending",
  }

  const { error: insertErr } = await supabaseAdmin.from("registration_requests").insert(insertPayload)

  if (insertErr) {
    console.error("Insert registration error:", insertErr)
    await sendTelegramMessage(botToken, chatId, `حدث خطأ أثناء حفظ الطلب في قاعدة البيانات (${insertErr.message || "فشل الإدراج"}). يرجى المحاولة مرة أخرى لاحقاً.`)
    return
  }

  const confirmMsg = `✅ <b>تم استلام طلب تسجيلك بنجاح!</b>\n\n` +
    `• الاسم: <b>${fullName}</b>\n` +
    `• البريد الإلكتروني: <b>${email}</b>\n` +
    `• القسم: <b>${DEPT_LABELS[requestedDept] || requestedDept}</b>\n` +
    `• الدور المطلوب: <b>${ROLE_LABELS[requestedRole] || requestedRole}</b>\n\n` +
    `طلبك الآن قيد المراجعة لدى إدارة النظام.\n` +
    `فور موافقة الإدارة، ستصلك رسالة دعوة رسمية على بريدك الإلكتروني تحتوي على رابط تفعيل حسابك واختيار اسم المستخدم وكلمة المرور.\n\n` +
    `يمكنك متابعة حالة طلبك في أي وقت عبر الأمر /status.`

  await sendTelegramMessage(botToken, chatId, confirmMsg)
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────
serve(async (req: Request) => {
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

    const emailConfig: EmailProviderConfig = {
      resendApiKey: (Deno.env.get("RESEND_API_KEY") ?? "").trim(),
      emailFrom: (Deno.env.get("EMAIL_FROM") || Deno.env.get("RESEND_FROM_EMAIL") || "").trim(),
      smtpUser: (Deno.env.get("SMTP_USER") || Deno.env.get("GMAIL_USER") || "").trim(),
      smtpPass: (Deno.env.get("SMTP_PASS") || Deno.env.get("GMAIL_APP_PASSWORD") || "").trim(),
      smtpHost: (Deno.env.get("SMTP_HOST") || "smtp.gmail.com").trim(),
      smtpPort: Number(Deno.env.get("SMTP_PORT")) || 465,
    }

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
        // Only ignore if it is an actual unique constraint violation (duplicate key: 23505)
        if (dedupErr.code === "23505") {
          return new Response("ok (duplicate update ignored)", { headers: corsHeaders })
        }
        console.warn("Deduplication table notice:", dedupErr.message)
      }
    }

    // ─── Handle Callback Query (Inline Buttons / Tabs) ────────────────────────
    if (update.callback_query) {
      const query = update.callback_query
      const chatId = query.message?.chat?.id
      const data = query.data || ""
      const tgUser = query.from
      const tgUserId = tgUser?.id

      if (!chatId || !tgUserId) {
        return new Response("ok", { headers: corsHeaders })
      }

      // Step 1: Start registration wizard
      if (data === "register_start") {
        await answerCallbackQuery(botToken, query.id)
        await clearUserSession(supabaseAdmin, tgUserId)
        await saveUserSession(supabaseAdmin, tgUserId, { step: "awaiting_name" })
        const promptMsg = `👤 <b>الخطوة 1 من 4: الاسم بالكامل</b>\n\nيرجى كتابة اسمك الكامل (ثلاثي أو رباعي) في رسالة نصية:`
        const keyboard = {
          inline_keyboard: [
            [{ text: "❌ إلغاء التسجيل", callback_data: "reg_cancel" }],
          ],
        }
        await sendTelegramMessage(botToken, chatId, promptMsg, keyboard)
        return new Response("ok", { headers: corsHeaders })
      }

      // Cancel registration
      if (data === "reg_cancel") {
        await answerCallbackQuery(botToken, query.id, "تم الإلغاء")
        await clearUserSession(supabaseAdmin, tgUserId)
        await sendTelegramMessage(botToken, chatId, "تم إلغاء عملية التسجيل. يمكنك البدء من جديد في أي وقت عبر الأمر /start.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Step 3 -> 4: Department Selected
      if (data.startsWith("set_dept:")) {
        const dept = data.replace("set_dept:", "")
        await answerCallbackQuery(botToken, query.id)
        let session = await getUserSession(supabaseAdmin, tgUserId)

        // Resilient self-healing: Extract name & email from message text if session lost in DB/isolate
        const msgText = query.message?.text || ""
        const extractedName = session?.fullName || msgText.match(/الاسم:\s*([^\n\r•]+)/)?.[1]?.trim()
        const extractedEmail = session?.email || msgText.match(/البريد:\s*([^\n\r•]+)/)?.[1]?.trim()

        const fullName = extractedName || session?.fullName || "الموظف"
        const email = extractedEmail || session?.email || ""

        session = {
          ...(session || {}),
          fullName,
          email,
          department: dept,
          step: "awaiting_role",
        }
        await saveUserSession(supabaseAdmin, tgUserId, session)

        const deptTitle = dept === "warehouse" ? "المخازن" : "المشتريات"
        let roleButtons = []
        if (dept === "warehouse") {
          roleButtons = [
            [{ text: "👤 موظف مخازن", callback_data: "set_role:warehouse_employee" }],
            [{ text: "🛡️ مشرف مخازن", callback_data: "set_role:warehouse_admin" }],
          ]
        } else {
          roleButtons = [
            [{ text: "👤 موظف مشتريات", callback_data: "set_role:procurement_employee" }],
            [{ text: "🛡️ مشرف مشتريات", callback_data: "set_role:procurement_admin" }],
          ]
        }
        roleButtons.push([
          { text: "🔙 تغيير القسم", callback_data: "back_to_dept" },
          { text: "❌ إلغاء", callback_data: "reg_cancel" },
        ])
        const roleMsg = `💼 <b>الخطوة 4 من 4: الدور الوظيفي (${deptTitle})</b>\n\n` +
          `• <b>الاسم:</b> ${fullName}\n` +
          `• <b>البريد:</b> ${email}\n` +
          `• <b>القسم:</b> ${deptTitle}\n\n` +
          `اختر الدور الوظيفي المطلوب بالضغط على أحد الأزرار أدناه:`
        await sendTelegramMessage(botToken, chatId, roleMsg, { inline_keyboard: roleButtons })
        return new Response("ok", { headers: corsHeaders })
      }

      // Back to Department selection
      if (data === "back_to_dept") {
        await answerCallbackQuery(botToken, query.id)
        let session = await getUserSession(supabaseAdmin, tgUserId)
        const msgText = query.message?.text || ""
        const extractedName = session?.fullName || msgText.match(/الاسم:\s*([^\n\r•]+)/)?.[1]?.trim()
        const extractedEmail = session?.email || msgText.match(/البريد:\s*([^\n\r•]+)/)?.[1]?.trim()

        const fullName = extractedName || session?.fullName || "الموظف"
        const email = extractedEmail || session?.email || ""

        session = { ...(session || {}), fullName, email, step: "awaiting_dept" }
        await saveUserSession(supabaseAdmin, tgUserId, session)

        const deptMsg = `🏢 <b>الخطوة 3 من 4: القسم المطلوب</b>\n\n` +
          `• <b>الاسم:</b> ${fullName}\n` +
          `• <b>البريد:</b> ${email}\n\n` +
          `اختر القسم التابع له من الخيارات التالية 👇`
        const keyboard = {
          inline_keyboard: [
            [
              { text: "📦 قسم المخازن", callback_data: "set_dept:warehouse" },
              { text: "🛒 قسم المشتريات", callback_data: "set_dept:procurement" },
            ],
            [{ text: "❌ إلغاء", callback_data: "reg_cancel" }],
          ],
        }
        await sendTelegramMessage(botToken, chatId, deptMsg, keyboard)
        return new Response("ok", { headers: corsHeaders })
      }

      // Step 4 -> 5: Role Selected -> Confirmation Card
      if (data.startsWith("set_role:")) {
        const role = data.replace("set_role:", "")
        await answerCallbackQuery(botToken, query.id)
        let session = await getUserSession(supabaseAdmin, tgUserId)
        const msgText = query.message?.text || ""
        const extractedName = session?.fullName || msgText.match(/الاسم:\s*([^\n\r•]+)/)?.[1]?.trim()
        const extractedEmail = session?.email || msgText.match(/البريد:\s*([^\n\r•]+)/)?.[1]?.trim()
        let extractedDept = session?.department
        if (!extractedDept) {
          if (role.startsWith("warehouse")) extractedDept = "warehouse"
          else if (role.startsWith("procurement")) extractedDept = "procurement"
        }

        const fullName = extractedName || session?.fullName || "الموظف"
        const email = extractedEmail || session?.email || ""
        const department = extractedDept || "warehouse"

        session = {
          ...(session || {}),
          fullName,
          email,
          department,
          role,
          step: "confirm",
        }
        await saveUserSession(supabaseAdmin, tgUserId, session)

        const summaryMsg = `📋 <b>مراجعة وتأكيد بيانات طلب التسجيل:</b>\n\n` +
          `• <b>الاسم الكامل:</b> ${fullName}\n` +
          `• <b>البريد الإلكتروني:</b> ${email}\n` +
          `• <b>القسم المختار:</b> ${DEPT_LABELS[department] || department}\n` +
          `• <b>الدور المطلوب:</b> ${ROLE_LABELS[role] || role}\n\n` +
          `هل البيانات صحيحة؟ اضغط على زر <b>تأكيد وإرسال الطلب</b> لتقديم طلبك لإدارة النظام 👇`
        const keyboard = {
          inline_keyboard: [
            [{ text: "✅ تأكيد وإرسال الطلب", callback_data: "submit_registration" }],
            [
              { text: "🔄 البدء من جديد", callback_data: "register_start" },
              { text: "❌ إلغاء", callback_data: "reg_cancel" },
            ],
          ],
        }
        await sendTelegramMessage(botToken, chatId, summaryMsg, keyboard)
        return new Response("ok", { headers: corsHeaders })
      }

      // Final Step: Submit registration
      if (data === "submit_registration") {
        await answerCallbackQuery(botToken, query.id, "جارٍ معالجة الطلب...")
        let session = await getUserSession(supabaseAdmin, tgUserId)
        const msgText = query.message?.text || ""
        const extractedName = session?.fullName || msgText.match(/الاسم الكامل:\s*([^\n\r•]+)/)?.[1]?.trim()
        const extractedEmail = session?.email || msgText.match(/البريد الإلكتروني:\s*([^\n\r•]+)/)?.[1]?.trim()

        const fullName = extractedName || session?.fullName || "الموظف"
        const email = extractedEmail || session?.email || ""
        let department = session?.department
        let role = session?.role

        if (!department || !role) {
          const deptMatch = msgText.match(/القسم المختار:\s*([^\n\r•]+)/)?.[1]?.trim()
          const roleMatch = msgText.match(/الدور المطلوب:\s*([^\n\r•]+)/)?.[1]?.trim()
          if (deptMatch?.includes("مشتريات")) department = "procurement"
          else if (deptMatch?.includes("مخازن")) department = "warehouse"

          if (roleMatch?.includes("مشرف")) {
            role = department === "procurement" ? "procurement_admin" : "warehouse_admin"
          } else {
            role = department === "procurement" ? "procurement_employee" : "warehouse_employee"
          }
        }

        if (!fullName || !email || !department || !role) {
          await sendTelegramMessage(botToken, chatId, "البيانات غير مكتملة أو انتهت صلاحية الجلسة. يرجى البدء من جديد عبر /start.")
          return new Response("ok", { headers: corsHeaders })
        }

        await clearUserSession(supabaseAdmin, tgUserId)
        await executeRegistration({
          supabaseAdmin,
          botToken,
          chatId,
          tgUserId,
          tgUsername: tgUser.username || "",
          fullName,
          email,
          requestedDept: department,
          requestedRole: role,
          otpPepper,
          emailConfig,
        })
        return new Response("ok", { headers: corsHeaders })
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

    // ─── DYNAMIC BOT SETTINGS FROM DATABASE ─────────────────────────────────
    let botSettings = null
    try {
      const { data } = await supabaseAdmin
        .from("telegram_bot_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle()
      botSettings = data
    } catch {
      // fallback
    }

    // فحص وضع الصيانة
    if (botSettings && botSettings.is_enabled === false) {
      const notice = botSettings.bot_status_notice || "عذراً، البوت في فترة تحديث وصيانة مجدولة حالياً. يُرجى مراجعة إدارة مخازن جامعة الزقازيق الأهلية."
      await sendTelegramMessage(botToken, chatId, notice)
      return new Response("ok", { headers: corsHeaders })
    }

    const dynamicWelcomeMessage = botSettings?.welcome_message || WELCOME_MESSAGE
    const dynamicHelpMessage = botSettings?.help_message || `📌 أوامر بوت مخازن وتوريدات جامعة الزقازيق الأهلية:

/start - بدء تقديم طلب تسجيل حساب جديد
/status - متابعة حالة طلب التسجيل الخاص بك
/help - عرض رسالة المساعدة وقنوات الدعم الفني`

    // ─── COMMAND: /help ──────────────────────────────────────────────────────
    if (text === "/help") {
      let helpText = dynamicHelpMessage
      if (botSettings?.support_contact_text) {
        helpText += `\n\n${botSettings.support_contact_text}`
      }
      await sendTelegramMessage(botToken, chatId, helpText)
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /start ─────────────────────────────────────────────────────
    if (text === "/start") {
      if (botSettings && botSettings.allow_registration === false) {
        await sendTelegramMessage(botToken, chatId, `${dynamicWelcomeMessage}\n\n⚠️ تنويه: باب التسجيل الإلكتروني مغلق مؤقتاً بناءً على تعليمات الإدارة.`)
        return new Response("ok", { headers: corsHeaders })
      }
      const keyboard = {
        inline_keyboard: [
          [{ text: "بدء التسجيل", callback_data: "register_start" }],
        ],
      }
      await sendTelegramMessage(botToken, chatId, dynamicWelcomeMessage, keyboard)
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
        await sendTelegramMessage(botToken, chatId, "لم يتم العثور على طلب تسجيل خاص بك.")
        return new Response("ok", { headers: corsHeaders })
      }

      if (request.approval_status === "approved") {
        const msg = `تمت الموافقة على طلبك، ويمكنك استكمال تفعيل الحساب.\n\nالرقم الوظيفي: <b>${request.employee_id}</b>\nالدور المعتمد: ${ROLE_LABELS[request.approved_role] || request.approved_role}\nالقسم: ${DEPT_LABELS[request.requested_department] || request.requested_department}\n\nيمكنك الآن تسجيل الدخول عبر واجهة النظام باستخدام الرقم الوظيفي أو اسم المستخدم.`
        await sendTelegramMessage(botToken, chatId, msg)
      } else if (request.approval_status === "rejected") {
        const reason = request.rejection_reason ? `\nسبب الرفض: ${request.rejection_reason}` : ""
        await sendTelegramMessage(botToken, chatId, `تم رفض الطلب. يرجى مراجعة الإدارة.${reason}`)
      } else if (request.approval_status === "cancelled") {
        await sendTelegramMessage(botToken, chatId, "تم إلغاء طلب التسجيل.")
      } else if (request.verification_status === "delivery_failed") {
        await sendTelegramMessage(botToken, chatId, "طلبك في انتظار التحقق من البريد الإلكتروني.\n(تعذر إرسال الرمز في المحاولة السابقة. يمكنك إعادة المحاولة عبر /resend)")
      } else if (request.verification_status !== "verified") {
        await sendTelegramMessage(botToken, chatId, "طلبك في انتظار التحقق من البريد الإلكتروني.\nيرجى كتابة رمز التحقق المكون من 6 أرقام المرسل لبريدك عبر الأمر:\n<code>/verify الرمز</code>\nأو طلب رمز جديد عبر:\n<code>/resend</code>")
      } else {
        await sendTelegramMessage(botToken, chatId, "تم التحقق من البريد الإلكتروني، وطلبك في انتظار موافقة الإدارة.")
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

      // Attempt send via Gmail SMTP or Resend
      const emailRes = await sendOtpEmail(emailConfig, request.email, request.full_name, newOtp)

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

      // Optional administrator Telegram notification if configured in DB or env
      const adminChatId = botSettings?.admin_chat_id?.trim() || Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")
      const shouldNotifyAdmin = botSettings?.notify_admin_on_registration !== false
      if (adminChatId && shouldNotifyAdmin) {
        const { data: requestDetails } = await supabaseAdmin
          .from("registration_requests")
          .select("id, full_name, requested_department, requested_role")
          .eq("id", request.id)
          .maybeSingle()

        const appBaseUrl = Deno.env.get("APP_BASE_URL") || ""
        const dashboardLink = appBaseUrl ? `\n<a href="${appBaseUrl}/users">فتح لوحة الإدارة</a>` : ""
        const adminMsg = `🔔 <b>طلب تسجيل موظف جديد بانتظار الاعتماد</b>\n\n` +
          `• المعرّف: <code>${request.id}</code>\n` +
          `• المتقدم: ${requestDetails?.full_name || "متقدم"}\n` +
          `• القسم: ${requestDetails?.requested_department || ""}\n` +
          `• الدور المطلوب: ${requestDetails?.requested_role || ""}\n` +
          `• حالة التحقق: تم تأكيد البريد الإلكتروني بنجاح ✅` +
          dashboardLink
        try {
          await sendTelegramMessage(botToken, Number(adminChatId), adminMsg)
        } catch {
          // preserve request, delivery failure to admin does not affect registration
        }
      }

      await sendTelegramMessage(
        botToken,
        chatId,
        "تم التحقق من البريد الإلكتروني، وطلبك في انتظار موافقة الإدارة.\nستتلقى إشعاراً هنا فور اعتماد حسابك وتخصيص رقمك الوظيفي."
      )
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── INTERACTIVE WIZARD STEP HANDLING FOR TEXT INPUT ─────────────────────
    const activeSession = await getUserSession(supabaseAdmin, tgUserId)

    // Step 1: Receiving Full Name
    const isStep1 = (activeSession && activeSession.step === "awaiting_name") ||
      (!activeSession && !text.startsWith("/") && !text.includes("@") && text.trim().length >= 3 && text.trim().length <= 100 && !/\d/.test(text))

    if (isStep1 && !text.startsWith("/")) {
      if (text.length < 3 || text.length > 100 || text.includes("@")) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "يرجى كتابة اسم كامل صالح يتراوح طوله بين 3 و 100 حرف (بدون بريد إلكتروني أو رموز خاصة):"
        )
        return new Response("ok", { headers: corsHeaders })
      }
      await saveUserSession(supabaseAdmin, tgUserId, { ...(activeSession || {}), fullName: text, step: "awaiting_email" })
      const nextMsg = `📧 <b>الخطوة 2 من 4: البريد الإلكتروني</b>\n\nأهلاً بك يا <b>${text}</b>! 👋\nيرجى كتابة بريدك الإلكتروني (سنرسل إليه رابط دعوة تفعيل الحساب فور موافقة الإدارة):`
      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ إلغاء", callback_data: "reg_cancel" }],
        ],
      }
      await sendTelegramMessage(botToken, chatId, nextMsg, keyboard)
      return new Response("ok", { headers: corsHeaders })
    }

    // Step 2: Receiving Email
    const isStep2 = (activeSession && activeSession.step === "awaiting_email") ||
      (isValidEmail(text.trim().toLowerCase()) && !text.startsWith("/"))

    if (isStep2 && !text.startsWith("/")) {
      const cleanEmail = text.trim().toLowerCase()
      if (!isValidEmail(cleanEmail)) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "صيغة البريد الإلكتروني غير صالحة. يرجى إدخال بريد إلكتروني صحيح (مثال: name@example.com):"
        )
        return new Response("ok", { headers: corsHeaders })
      }
      const tgFullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim()
      const fullName = (activeSession?.fullName && activeSession.fullName !== "الموظف")
        ? activeSession.fullName
        : (tgFullName.length >= 3 ? tgFullName : "الموظف")
      const updatedSession: UserSession = {
        ...(activeSession || {}),
        fullName,
        email: cleanEmail,
        step: "awaiting_dept",
      }
      await saveUserSession(supabaseAdmin, tgUserId, updatedSession)
      const deptMsg = `🏢 <b>الخطوة 3 من 4: القسم المطلوب</b>\n\n` +
        `• <b>الاسم:</b> ${fullName}\n` +
        `• <b>البريد:</b> ${cleanEmail}\n\n` +
        `اختر القسم التابع له بالضغط على أحد الأزرار التالية 👇`
      const keyboard = {
        inline_keyboard: [
          [
            { text: "📦 قسم المخازن", callback_data: "set_dept:warehouse" },
            { text: "🛒 قسم المشتريات", callback_data: "set_dept:procurement" },
          ],
          [{ text: "❌ إلغاء", callback_data: "reg_cancel" }],
        ],
      }
      await sendTelegramMessage(botToken, chatId, deptMsg, keyboard)
      return new Response("ok", { headers: corsHeaders })
    }

    // If awaiting button press (department, role, or confirmation)
    if (activeSession && (activeSession.step === "awaiting_dept" || activeSession.step === "awaiting_role" || activeSession.step === "confirm") && !text.startsWith("/")) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "يرجى الاختيار بالضغط على أحد الأزرار الظاهرة في الرسالة أعلاه، أو كتابة /start لإعادة البدء من جديد."
      )
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── LEGACY SINGLE-LINE REGISTRATION PARSING ──────────────────────────────
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

      await executeRegistration({
        supabaseAdmin,
        botToken,
        chatId,
        tgUserId,
        tgUsername: tgUser?.username || "",
        fullName,
        email,
        requestedDept,
        requestedRole,
        otpPepper,
        emailConfig,
      })
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
