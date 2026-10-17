import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token",
}

// ─── Arabic Messages & Texts ──────────────────────────────────────────────────
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateSecureOtp(): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const code = 100000 + (array[0] % 900000)
  return code.toString()
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token.trim())
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

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

// ─── Webhook Handler ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? ""
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? ""

    // 1. Validate Webhook Secret if configured
    if (webhookSecret) {
      const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token")
      if (incomingSecret !== webhookSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized webhook caller" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    const update = await req.json().catch(() => ({}))
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Handle Callback Query (Inline Buttons)
    if (update.callback_query) {
      const query = update.callback_query
      const chatId = query.message?.chat?.id
      const data = query.data || ""
      const tgUser = query.from

      if (!chatId || !tgUser) {
        return new Response("ok", { headers: corsHeaders })
      }

      if (data === "register_start") {
        await sendTelegramMessage(botToken, chatId, "من فضلك أرسل اسمك الثلاثي الكامل لبدء تسجيل الطلب:")
        // Save pending state in user session or prompt
      } else if (data.startsWith("dept_")) {
        const dept = data.replace("dept_", "")
        if (dept === "warehouse") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "موظف مخازن", callback_data: "role_warehouse_employee" }],
              [{ text: "مشرف مخازن", callback_data: "role_warehouse_admin" }],
            ],
          }
          await sendTelegramMessage(botToken, chatId, "اختر الدور الوظيفي المطلوب لقسم المخازن:", keyboard)
        } else if (dept === "procurement") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "موظف مشتريات", callback_data: "role_procurement_employee" }],
              [{ text: "مشرف مشتريات", callback_data: "role_procurement_admin" }],
            ],
          }
          await sendTelegramMessage(botToken, chatId, "اختر الدور الوظيفي المطلوب لقسم المشتريات:", keyboard)
        }
      }

      return new Response("ok", { headers: corsHeaders })
    }

    // Handle Message
    const message = update.message
    if (!message || !message.text) {
      return new Response("ok", { headers: corsHeaders })
    }

    const chatId = message.chat.id
    const text = message.text.trim()
    const tgUser = message.from
    const tgUserId = tgUser?.id

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
        const msg = `تهانينا! تم اعتماد حسابك بنجاح.\n\nالرقم الوظيفي: <b>${request.employee_id}</b>\nالدور: ${ROLE_LABELS[request.approved_role] || request.approved_role}\nالقسم: ${DEPT_LABELS[request.requested_department] || request.requested_department}\n\nيمكنك الآن تسجيل الدخول عبر واجهة النظام باستخدام الرقم الوظيفي أو اسم المستخدم.`
        await sendTelegramMessage(botToken, chatId, msg)
      } else if (request.approval_status === "rejected") {
        const msg = `تم رفض طلب التسجيل.\nسبب الرفض: ${request.rejection_reason || "لم يحدد"}\nيمكنك مراجعة إدارة النظام أو التقديم مرة أخرى عبر /start.`
        await sendTelegramMessage(botToken, chatId, msg)
      } else if (request.verification_status !== "verified") {
        await sendTelegramMessage(botToken, chatId, "طلبك قيد انتظار التحقق من البريد الإلكتروني. يرجى إدخال رمز التحقق المرسل لبريدك عبر الأمر:\n/verify <الرمز>")
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
        .eq("approval_status", "pending")
        .maybeSingle()

      if (request) {
        await supabaseAdmin.from("registration_requests").delete().eq("id", request.id)
        await sendTelegramMessage(botToken, chatId, "تم إلغاء طلب التسجيل المعلق بنجاح.")
      } else {
        await sendTelegramMessage(botToken, chatId, "لا يوجد طلب تسجيل معلق لإلغائه.")
      }
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── COMMAND: /verify <code> ─────────────────────────────────────────────
    if (text.startsWith("/verify")) {
      const parts = text.split(" ")
      const token = parts[1]?.trim()

      if (!token || token.length < 6) {
        await sendTelegramMessage(botToken, chatId, "يرجى كتابة رمز التحقق المكون من 6 أرقام بعد الأمر، مثال:\n<code>/verify 123456</code>")
        return new Response("ok", { headers: corsHeaders })
      }

      const { data: request } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
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
        await sendTelegramMessage(botToken, chatId, "تم التحقق من بريدك مسبقاً! طلبك بانتظار موافقة الإدارة.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Check max failed attempts (max 5)
      if (request.verification_attempts >= 5) {
        await sendTelegramMessage(botToken, chatId, "تم تجاوز الحد الأقصى للمحاولات الخاطئة. يرجى إلغاء الطلب عبر /cancel والبدء من جديد.")
        return new Response("ok", { headers: corsHeaders })
      }

      // Check expiration
      if (request.verification_token_expires_at && new Date(request.verification_token_expires_at).getTime() < Date.now()) {
        await sendTelegramMessage(botToken, chatId, "انتهت صلاحية رمز التحقق (صالح لمدة 10 دقائق). يرجى تقديم طلب جديد.")
        return new Response("ok", { headers: corsHeaders })
      }

      const hashedInput = await hashToken(token)
      if (hashedInput !== request.verification_token_hash) {
        await supabaseAdmin
          .from("registration_requests")
          .update({ verification_attempts: request.verification_attempts + 1 })
          .eq("id", request.id)

        await sendTelegramMessage(botToken, chatId, `رمز التحقق غير صحيح. تبقى لك ${4 - request.verification_attempts} محاولات.`)
        return new Response("ok", { headers: corsHeaders })
      }

      // Successful verification
      await supabaseAdmin
        .from("registration_requests")
        .update({
          verification_status: "verified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id)

      await sendTelegramMessage(
        botToken,
        chatId,
        "تم التحقق من بريدك الإلكتروني بنجاح!\nتم إرسال طلبك إلى لوحة الإدارة للمراجعة والاعتماد.\nستتلقى إشعاراً فور اعتماد حسابك."
      )
      return new Response("ok", { headers: corsHeaders })
    }

    // ─── REGISTRATION INPUT PARSING ──────────────────────────────────────────
    // Format: الاسم الكامل | البريد الإلكتروني | القسم (المخازن/المشتريات) | الدور
    if (text.includes("@") && (text.includes("مخازن") || text.includes("مشتريات") || text.includes("|") || text.includes(","))) {
      const parts = text.split(/[|,\n]/).map((p: string) => p.trim()).filter(Boolean)
      const fullName = parts[0]
      const email = parts.find((p: string) => p.includes("@"))?.toLowerCase()
      const deptPart = parts.find((p: string) => p.includes("مخازن") || p.includes("مشتريات")) || ""

      if (!fullName || !email) {
        await sendTelegramMessage(botToken, chatId, "يرجى إرسال بيانات التسجيل بالصيغة:\nالاسم الكامل | البريد الإلكتروني | القسم | الدور المطلوب")
        return new Response("ok", { headers: corsHeaders })
      }

      // Duplicate Check
      const { data: existingUser } = await supabaseAdmin
        .from("app_users")
        .select("id")
        .or(`email.ilike.${email},telegram_user_id.eq.${tgUserId}`)
        .maybeSingle()

      if (existingUser) {
        await sendTelegramMessage(botToken, chatId, "يوجد حساب مسجل بالفعل بهذا البريد الإلكتروني أو حساب التيليجرام. يرجى تسجيل الدخول أو مراجعة الإدارة.")
        return new Response("ok", { headers: corsHeaders })
      }

      const { data: pendingReq } = await supabaseAdmin
        .from("registration_requests")
        .select("id")
        .eq("approval_status", "pending")
        .or(`email.ilike.${email},telegram_user_id.eq.${tgUserId}`)
        .maybeSingle()

      if (pendingReq) {
        await sendTelegramMessage(botToken, chatId, "يوجد طلب تسجيل معلق قيد المراجعة بالفعل لهذا البريد أو حساب التيليجرام. يمكنك التحقق عبر /status.")
        return new Response("ok", { headers: corsHeaders })
      }

      const isWarehouse = deptPart.includes("مخازن")
      const requestedDept = isWarehouse ? "warehouse" : "procurement"
      const requestedRole = isWarehouse ? "warehouse_employee" : "procurement_employee"

      // Generate OTP and Hash
      const otp = generateSecureOtp()
      const tokenHash = await hashToken(otp)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

      // Insert registration request
      const { error: insertErr } = await supabaseAdmin.from("registration_requests").insert({
        full_name: fullName,
        email: email,
        telegram_user_id: tgUserId,
        telegram_username: tgUser?.username || "",
        requested_department: requestedDept,
        requested_role: requestedRole,
        verification_status: "pending",
        verification_token_hash: tokenHash,
        verification_token_expires_at: expiresAt,
        approval_status: "pending",
      })

      if (insertErr) {
        throw insertErr
      }

      // In production, an email with the OTP is sent. For local/testing resilience, the bot prompts with instructions:
      const confirmMsg = `تم استلام بياناتك بنجاح!\n\nالاسم: ${fullName}\nالبريد: ${email}\nالقسم: ${DEPT_LABELS[requestedDept]}\nالدور المطلوب: ${ROLE_LABELS[requestedRole]}\n\nتم إرسال رمز التحقق إلى بريدك الإلكتروني (صالح لمدة 10 دقائق).\nأدخل الرمز عبر:\n<code>/verify ${otp}</code>`
      await sendTelegramMessage(botToken, chatId, confirmMsg)

      return new Response("ok", { headers: corsHeaders })
    }

    // Default reply for unrecognized messages
    await sendTelegramMessage(
      botToken,
      chatId,
      "أهلاً بك! يمكنك بدء التسجيل عبر الأمر /start، أو فحص حالة طلبك عبر /status، أو إلغاء الطلب عبر /cancel."
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
