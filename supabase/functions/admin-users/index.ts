import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer"

const DEFAULT_APP_ORIGIN = "https://warehouse-ledger-vert.vercel.app"

function getAllowedOrigins(): string[] {
  const origins = new Set<string>([DEFAULT_APP_ORIGIN])
  const envUrl = (Deno.env.get("APP_BASE_URL") || Deno.env.get("SITE_URL") || "").trim()
  if (envUrl && envUrl.startsWith("https://")) {
    origins.add(envUrl.replace(/\/+$/, ""))
  }
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",")
  for (const item of extra) {
    const clean = item.trim().replace(/\/+$/, "")
    if (clean) origins.add(clean)
  }
  return Array.from(origins)
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get("origin") || "").trim().replace(/\/+$/, "")
  const allowed = getAllowedOrigins()
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  }
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function isSafeFilterIdentifier(value: string): boolean {
  if (!value || value.length > 254) return false
  // Disallow PostgREST .or() operators & wildcard/delimiter characters
  return !/[(),*%\\'";\s]/.test(value)
}

function getRequestIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length > 0) {
    // Prefer the rightmost proxy-appended client hop when present
    return parts[parts.length - 1]
  }
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  )
}

async function logAdminSecurityEvent(
  supabaseAdmin: any,
  req: Request,
  params: {
    caller?: { id?: string; email?: string; app_metadata?: Record<string, any> } | null
    action: string
    eventType: string
    severity: "info" | "warning" | "critical"
    entityType?: string
    entityId?: string
    tableName?: string
    oldData?: Record<string, any> | null
    newData?: Record<string, any> | null
    details?: Record<string, any>
  }
): Promise<void> {
  try {
    const reqIp = getRequestIp(req)
    const payload = {
      user_id: params.caller?.id || null,
      actor_id: params.caller?.id || null,
      actor_role: (params.caller?.app_metadata?.role as string) || "anon",
      user_email: params.caller?.email || "anonymous",
      action: params.action,
      event_type: params.eventType,
      entity_type: params.entityType || "security_violation",
      entity_id: params.entityId || params.caller?.id || "",
      table_name: params.tableName || params.entityType || "edge_function:admin-users",
      record_id: params.entityId || params.caller?.id || "",
      old_data: params.oldData || null,
      new_data: params.newData || null,
      ip: reqIp,
      ip_address: reqIp,
      user_agent: req.headers.get("user-agent") || "",
      severity: params.severity,
      details: params.details || {},
    }

    // For 401/403 authorization denials, emit directly to PostgREST so rejected requests
    // never invoke business/directory client abstractions and stay completely non-blocking.
    if (params.eventType === "unauthorized_api_access") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      if (supabaseUrl && supabaseServiceKey && typeof fetch === "function") {
        await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/audit_logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(payload),
          signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(1500) : undefined,
        }).catch(() => undefined)
      }
      return
    }

    await supabaseAdmin.from("audit_logs").insert(payload)
  } catch {
    // Non-blocking audit logging
  }
}

function normalizeUsername(input: string | null | undefined): string {
  if (!input) return ""
  let normalized = String(input).trim().toLowerCase().normalize("NFKC")
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E]/g, "")
  normalized = normalized.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
  const homoglyphs: Record<string, string> = {
    "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y",
    "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w",
    "α": "a", "ο": "o", "υ": "u",
  }
  return normalized.replace(/[асеорхуіјѕԁԛԝαου]/g, (char) => homoglyphs[char] || char)
}

function isProtectedUsername(usernameOrEmail: string | null | undefined): boolean {
  if (!usernameOrEmail) return false
  const clean = normalizeUsername(usernameOrEmail)
  const bootstrapEmail = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || "").trim()
  const bootstrapUsername = (Deno.env.get("BOOTSTRAP_ADMIN_USERNAME") || "").trim()
  const reserved = [
    "marwan-desouky",
    "marwan-desouky@warehouse.local",
    "marwandesouqhi@gmail.com",
    ...(bootstrapEmail ? [bootstrapEmail] : []),
    ...(bootstrapUsername ? [bootstrapUsername] : []),
  ]
  for (const r of reserved) {
    if (clean === normalizeUsername(r)) return true
  }
  if (clean.endsWith("@warehouse.local")) {
    const prefix = clean.replace(/@warehouse\.local$/, "")
    if (prefix === "marwan-desouky" || (bootstrapUsername && prefix === normalizeUsername(bootstrapUsername))) {
      return true
    }
  }
  return false
}

function generateSecureTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*"
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join("")
}

async function ensureAuthUserForRecovery(supabaseAdmin: any, appUser: Record<string, any> | null) {
  if (!appUser?.email) {
    return null
  }

  const targetEmail = String(appUser.email).trim().toLowerCase()
  if (!targetEmail) {
    return null
  }

  const { data: existingUser, error: existingError } = await supabaseAdmin.auth.admin.getUserByEmail(targetEmail)
  if (!existingError && existingUser?.user) {
    if (appUser.id && appUser.auth_user_id !== existingUser.user.id) {
      await supabaseAdmin
        .from("app_users")
        .update({ auth_user_id: existingUser.user.id, must_change_password: true })
        .eq("id", appUser.id)
    }
    return existingUser.user
  }

  const username = String(appUser.username || appUser.display_name || targetEmail.split("@")[0] || "user").trim()
  const displayName = String(appUser.display_name || appUser.username || username).trim()
  const generatedPassword = generateSecureTempPassword()

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: targetEmail,
    password: generatedPassword,
    email_confirm: true,
    user_metadata: {
      username,
      displayName,
      name: displayName,
    },
    app_metadata: {
      username,
      role: appUser.role || "viewer",
      system_admin: false,
      employee_id: appUser.employee_id || null,
      department: appUser.department || null,
      must_change_password: true,
    },
  })

  if (createError || !createdUser?.user) {
    throw createError ?? new Error(`Could not create Auth user for recovery email: ${targetEmail}`)
  }

  if (appUser.id) {
    await supabaseAdmin
      .from("app_users")
      .update({ auth_user_id: createdUser.user.id, must_change_password: true })
      .eq("id", appUser.id)
  }

  return createdUser.user
}

function resolveAppBaseUrl(req: Request): string {
  const envUrl = (Deno.env.get("APP_BASE_URL") || Deno.env.get("SITE_URL") || "").trim()
  if (envUrl && envUrl.startsWith("https://")) {
    return envUrl.replace(/\/+$/, "")
  }
  const origin = (req.headers.get("origin") || "").trim().replace(/\/+$/, "")
  const allowed = getAllowedOrigins()
  if (origin && allowed.includes(origin)) {
    return origin
  }
  return DEFAULT_APP_ORIGIN
}

async function sendActivationInviteEmail(options: {
  toEmail: string
  fullName: string
  employeeId: string
  role: string
  department: string
  actionLink: string
}): Promise<{ success: boolean; error?: string }> {
  const { toEmail, fullName, employeeId, role, department, actionLink } = options

  const smtpUser = Deno.env.get("SMTP_USER")?.trim()
  if (!smtpUser) throw new Error("Server misconfigured: SMTP_USER environment variable is not set")
  const rawPass = Deno.env.get("SMTP_PASS")
  if (!rawPass) throw new Error("Server misconfigured: SMTP_PASS environment variable is not set")
  const smtpPass = rawPass.replace(/\s+/g, "")
  const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com"
  const smtpPort = Number(Deno.env.get("SMTP_PORT")) || 465
  // Sender email MUST strictly match the authenticated Gmail account for SPF/DKIM/DMARC pass
  const fromName = "منظومة إدارة المخازن"
  const emailFrom = `"${fromName}" <${smtpUser}>`

  const roleNameMap: Record<string, string> = {
    warehouse_employee: "موظف مخازن",
    warehouse_admin: "مدير مخازن",
    procurement_employee: "موظف مشتريات",
    procurement_admin: "مدير مشتريات",
    system_admin: "مدير نظام رئيسي",
  }
  const displayRole = roleNameMap[role] || role
  const displayDept = department === "warehouse" ? "إدارة المخازن" : department === "procurement" ? "إدارة المشتريات" : department

  const safeFullName = escapeHtml(fullName)
  const safeEmployeeId = escapeHtml(employeeId)
  const safeDept = escapeHtml(displayDept)
  const safeRole = escapeHtml(displayRole)
  const safeActionHref = actionLink.startsWith("https://") || actionLink.startsWith("http://localhost")
    ? escapeHtml(actionLink)
    : ""

  const emailSubject = `دعوة تفعيل حسابك في نظام المستودع - الرقم الوظيفي (${employeeId})`

  // Plain text fallback ensures anti-spam filters score the email favorably
  const emailText = `مرحباً بك يا ${fullName}،

يسعدنا إبلاغك بأنه تمت الموافقة على طلب انضمامك إلى منظومة إدارة المخازن والمشتريات وتخصيص رقمك الوظيفي الرسمي:

البيانات الوظيفية:
• الاسم: ${fullName}
• الرقم الوظيفي الفريد: ${employeeId}
• القسم: ${displayDept}
• الدور الوظيفي: ${displayRole}

يُرجى الضغط على الرابط أدناه لتفعيل حسابك واختيار اسم المستخدم وكلمة المرور الخاصة بك:
${actionLink}

⚠️ ملاحظة أمنية: هذا الرابط مخصص لك وحدك، ويرتبط بحسابك مباشرة. إذا لم تكن قد طلبت التسجيل في النظام، يُرجى تجاهل هذه الرسالة.

نظام إدارة المخازن والمشتريات الداخلي © 2026 جميع الحقوق محفوظة.`

  const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(emailSubject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; direction: rtl; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 30px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; }
    .content { padding: 30px 24px; }
    .welcome { font-size: 17px; font-weight: 600; margin-bottom: 16px; color: #0f172a; }
    .info-card { background: #f1f5f9; border-radius: 8px; padding: 18px; margin: 20px 0; border-right: 4px solid #0d9488; }
    .btn-container { text-align: center; margin: 30px 0 15px 0; }
    .btn { display: inline-block; background-color: #0d9488; color: #ffffff !important; padding: 14px 32px; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(13, 148, 136, 0.3); text-align: center; }
    .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .note { font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 20px; }
  </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; direction: rtl;">
  <div class="container" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
    <div class="header" style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">منظومة إدارة المخازن والمشتريات</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; color: #f0fdfa;">Warehouse Ledger System</p>
    </div>
    <div class="content" style="padding: 30px 24px;">
      <div class="welcome" style="font-size: 17px; font-weight: 600; margin-bottom: 16px; color: #0f172a;">مرحباً بك يا ${safeFullName}،</div>
      <p style="line-height: 1.6; color: #334155; font-size: 15px; margin: 0 0 16px 0;">
        يسعدنا إبلاغك بأنه تمت الموافقة على طلب انضمامك إلى المنظومة وتخصيص رقمك الوظيفي الرسمي.
      </p>

      <div class="info-card" style="background: #f1f5f9; border-radius: 8px; padding: 18px; margin: 20px 0; border-right: 4px solid #0d9488;">
        <table border="0" cellpadding="6" cellspacing="0" width="100%" style="font-size: 15px; direction: rtl;">
          <tr style="border-bottom: 1px dashed #cbd5e1;">
            <td style="color: #64748b; font-weight: 500; width: 40%;">الاسم:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: left;">${safeFullName}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #cbd5e1;">
            <td style="color: #64748b; font-weight: 500;">الرقم الوظيفي الفريد:</td>
            <td style="color: #0d9488; font-weight: 700; text-align: left;">${safeEmployeeId}</td>
          </tr>
          <tr style="border-bottom: 1px dashed #cbd5e1;">
            <td style="color: #64748b; font-weight: 500;">القسم:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: left;">${safeDept}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">الدور الوظيفي:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: left;">${safeRole}</td>
          </tr>
        </table>
      </div>

      <p style="line-height: 1.6; color: #334155; font-size: 15px; margin: 16px 0;">
        يُرجى الضغط على الزر أدناه لتفعيل حسابك واختيار اسم المستخدم وكلمة المرور الخاصة بك:
      </p>

      <div style="text-align: center; margin: 30px 0 20px 0;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin: 0 auto; text-align: center;">
          <tr>
            <td align="center" bgcolor="#0d9488" style="border-radius: 8px; background-color: #0d9488;">
              <a href="${safeActionHref}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 34px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 16px; font-weight: 700; color: #ffffff !important; text-decoration: none; border-radius: 8px; background-color: #0d9488; -webkit-text-size-adjust: none;">تفعيل الحساب وتعيين كلمة المرور</a>
            </td>
          </tr>
        </table>
      </div>

      <div style="margin-top: 15px; margin-bottom: 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.6; word-break: break-all;">
        إذا واجهتك مشكلة في الضغط على الزر أعلاه، يمكنك نسخ الرابط التالي ولصقه في المتصفح:<br>
        <a href="${safeActionHref}" target="_blank" rel="noopener noreferrer" style="color: #0d9488; text-decoration: underline; font-weight: 500;">${safeActionHref}</a>
      </div>

      <p class="note" style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
        ⚠️ <strong>ملاحظة أمنية:</strong> هذا الرابط مخصص لك وحدك، ويرتبط بحسابك مباشرة. إذا لم تكن قد طلبت التسجيل في النظام، يرجى تجاهل هذه الرسالة.
      </p>
    </div>
    <div class="footer" style="background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
      نظام إدارة المخازن والمشتريات الداخلي &copy; 2026 جميع الحقوق محفوظة
    </div>
  </div>
</body>
</html>
`

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    })

    await transporter.sendMail({
      from: emailFrom,
      to: toEmail,
      replyTo: smtpUser,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
      headers: {
        "X-Mailer": "Warehouse-Ledger-System",
        "X-Entity-Ref-ID": employeeId,
      },
    })

    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("sendActivationInviteEmail error:", err)
    return { success: false, error: msg }
  }
}

function escapeTelegramHtml(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

async function sendActivationInviteTelegram(options: {
  telegramUserId?: number | string | null
  email: string
  fullName: string
  employeeId: string
  role: string
  department: string
}): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  try {
    const { telegramUserId, email, fullName, employeeId, role, department } = options

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim()
    if (!botToken || !telegramUserId) {
      return { success: false, skipped: true }
    }

    const roleNameMap: Record<string, string> = {
      warehouse_employee: "موظف مخازن",
      warehouse_admin: "مدير مخازن",
      procurement_employee: "موظف مشتريات",
      procurement_admin: "مدير مشتريات",
      system_admin: "مدير نظام رئيسي",
    }
    const displayRole = roleNameMap[role] || role
    const displayDept = department === "warehouse" ? "إدارة المخازن" : department === "procurement" ? "إدارة المشتريات" : department

    const safeName = escapeTelegramHtml(fullName)
    const safeEmpId = escapeTelegramHtml(employeeId)
    const safeRole = escapeTelegramHtml(displayRole)
    const safeDept = escapeTelegramHtml(displayDept)
    const safeEmail = escapeTelegramHtml(email)

    const messageText = `تهانينا يا <b>${safeName}</b>! 🎉\n\n` +
      `تمت الموافقة على طلب انضمامك إلى منظومة إدارة المخازن والمشتريات وتخصيص رقمك الوظيفي الرسمي.\n\n` +
      `📋 <b>البيانات الوظيفية:</b>\n` +
      `• الاسم: ${safeName}\n` +
      `• الرقم الوظيفي: <b>${safeEmpId}</b>\n` +
      `• القسم: ${safeDept}\n` +
      `• الدور الوظيفي: ${safeRole}\n\n` +
      `📧 <b>خطوة التفعيل:</b>\n` +
      `تم إرسال رابط التفعيل السري والمخصص للاستخدام لمرة واحدة إلى بريدك الإلكتروني الموثق فقط (${safeEmail}).\n` +
      `يُرجى فحص صندوق الوارد (أو الرسائل غير المرغوب فيها) لاستكمال تعيين اسم المستخدم وكلمة المرور.\n\n` +
      `⚠️ <b>ملاحظة أمنية:</b> لأمان حسابك، لا تُرسل روابط التفعيل داخل محادثات تيليجرام.`

    const payload: Record<string, unknown> = {
      chat_id: telegramUserId,
      text: messageText,
      parse_mode: "HTML",
      protect_content: true,
      link_preview_options: { is_disabled: true },
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      const errorMsg = (typeof data?.description === "string" && data.description.trim())
        ? data.description.trim()
        : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`
      return { success: false, error: errorMsg }
    }

    return { success: true }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, error: errorMsg }
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    const body = await req.json().catch(() => ({}))
    const authHeader = req.headers.get("Authorization")
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Verify caller identity using JWT or trusted system admin record
    let caller: any = null
    if (authHeader) {
      try {
        const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        })
        const { data: { user } } = await supabaseCaller.auth.getUser()
        if (user) {
          caller = user
        }
      } catch {
        // ignore
      }
    }

    const action = body.action || "list_users"

    // Password recovery is self-service; all other actions require a verified caller.
    if (!caller && action !== "send_password_recovery") {
      await logAdminSecurityEvent(supabaseAdmin, req, {
        action: `محاولة استدعاء وظيفة الإدارة (${action}) بدون مصادقة صالحة`,
        eventType: "unauthorized_api_access",
        severity: "warning",
        entityId: action,
        details: { action, reason: "missing_or_invalid_jwt" },
      })
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: bootstrap_system_admin (One-Time Verified Bootstrap) ─────────
    if (action === "bootstrap_system_admin") {
      const expectedEmail = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || "").trim().toLowerCase()
      const expectedUsername = (Deno.env.get("BOOTSTRAP_ADMIN_USERNAME") || "marwan-desouky").trim()
      if (!expectedEmail) {
        return new Response(JSON.stringify({
          error: "لم يتم إعداد BOOTSTRAP_ADMIN_EMAIL في أسرار الخادم.",
        }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 1. Authoritatively fetch caller from Auth admin API (never trust request body)
      const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(caller.id)
      const verifiedAuthUser = authUserData?.user

      const isEmailVerified = Boolean(verifiedAuthUser?.email_confirmed_at)
      const isEmailMatch = (verifiedAuthUser?.email || "").trim().toLowerCase() === expectedEmail

      if (authUserErr || !verifiedAuthUser || !isEmailVerified || !isEmailMatch) {
        // Record security denial in audit_logs
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller: { id: caller.id, email: verifiedAuthUser?.email || caller.email || "unknown", app_metadata: caller.app_metadata },
          action: "محاولة تهيئة مدير نظام مرفوضة (Bootstrap Denied)",
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityType: "security_violation",
          entityId: caller.id,
          details: { outcome: "denied", reason: "identity_or_verification_mismatch" },
        })

        return new Response(JSON.stringify({
          error: "غير مصرح لك: إجراء التهيئة الأولية مخصص حصرياً للمالك مع بريد مؤكد.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 2. Call hardened database bootstrap function
      const { data: bootRes, error: bootErr } = await supabaseAdmin.rpc("bootstrap_system_admin", {
        p_email: expectedEmail,
        p_username: expectedUsername,
        p_auth_user_id: caller.id,
      })

      if (bootErr) {
        throw bootErr
      }

      const allocatedEmployeeId = bootRes?.employee_id || "SYS-ADM-000001"

      // 3. Server-managed Auth metadata update
      await supabaseAdmin.auth.admin.updateUserById(caller.id, {
        app_metadata: {
          ...verifiedAuthUser.app_metadata,
          role: "system_admin",
          system_admin: true,
          employee_id: allocatedEmployeeId,
          department: "الإدارة العامة",
          permissions: ["view_audit", "view_settings", "manage_records"],
          status: "active",
        },
      })

      return new Response(JSON.stringify({
        success: true,
        message: bootRes?.message || "تمت تهيئة وتأكيد حساب مدير النظام الرئيسي بنجاح.",
        status: bootRes?.status,
        employeeId: allocatedEmployeeId,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: send_password_recovery (Public / Self-Service) ─────────────
    if (action === "send_password_recovery") {
      const rawIdentifier = String(body.identifier || body.email || body.username || "").trim()
      if (!rawIdentifier) {
        return new Response(JSON.stringify({ error: "يُرجى إدخال اسم المستخدم أو الرقم الوظيفي أو البريد الإلكتروني." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const cleanIdent = rawIdentifier.toLowerCase()
      if (!isSafeFilterIdentifier(cleanIdent)) {
        return new Response(JSON.stringify({
          success: true,
          message: "إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Per-IP & per-identifier rate limiting via telegram_rate_events
      try {
        const clientIp = getRequestIp(req)
        const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString()
        const [{ count: ipCount }, { count: identCount }] = await Promise.all([
          supabaseAdmin
            .from("telegram_rate_events")
            .select("*", { count: "exact", head: true })
            .eq("event_type", "recovery_ip")
            .eq("identifier", clientIp)
            .gte("created_at", windowStart),
          supabaseAdmin
            .from("telegram_rate_events")
            .select("*", { count: "exact", head: true })
            .eq("event_type", "recovery_ident")
            .eq("identifier", cleanIdent)
            .gte("created_at", windowStart),
        ])

        if ((ipCount ?? 0) >= 8 || (identCount ?? 0) >= 3) {
          return new Response(JSON.stringify({
            success: true,
            message: "إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.",
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        await supabaseAdmin.from("telegram_rate_events").insert([
          { event_type: "recovery_ip", identifier: clientIp },
          { event_type: "recovery_ident", identifier: cleanIdent },
        ])
      } catch {
        // Continue safely if rate-limit table unavailable
      }

      let targetEmail = ""
      let targetFullName = ""
      let matchedKnownUser = false
      let dbUser: Record<string, any> | null = null

      if (cleanIdent.includes("@")) {
        const { data } = await supabaseAdmin
          .from("app_users")
          .select("id, auth_user_id, display_name, email, employee_id, username, role, department, status")
          .ilike("email", cleanIdent)
          .maybeSingle()
        dbUser = data
      } else {
        const { data: byUsername } = await supabaseAdmin
          .from("app_users")
          .select("id, auth_user_id, display_name, email, employee_id, username, role, department, status")
          .ilike("username", cleanIdent)
          .maybeSingle()
        dbUser = byUsername
        if (!dbUser) {
          const { data: byEmpId } = await supabaseAdmin
            .from("app_users")
            .select("id, auth_user_id, display_name, email, employee_id, username, role, department, status")
            .ilike("employee_id", cleanIdent)
            .maybeSingle()
          dbUser = byEmpId
        }
      }

      if (dbUser?.email && dbUser.status === "active") {
        targetEmail = dbUser.email.trim().toLowerCase()
        targetFullName = dbUser.display_name || dbUser.username
        matchedKnownUser = true
      }

      if (!matchedKnownUser) {
        // For security, do not expose whether user exists or not, return uniform generic response
        return new Response(JSON.stringify({
          success: true,
          message: "إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const appBaseUrl = resolveAppBaseUrl(req)

      let recoveryLink = ""
      let linkErr: any = null

      try {
        const { data: linkData, error: generatedErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: targetEmail,
          options: {
            redirectTo: `${appBaseUrl}/?type=recovery`,
          },
        })

        linkErr = generatedErr
        if (!generatedErr && linkData?.properties?.action_link) {
          recoveryLink = linkData.properties.action_link
        }
      } catch (generateError) {
        linkErr = generateError
      }

      if ((!recoveryLink || linkErr) && dbUser?.email && dbUser.status === "active") {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr || "")
        if (msg.toLowerCase().includes("user with this email not found") || msg.toLowerCase().includes("email not found")) {
          const repairedUser = await ensureAuthUserForRecovery(supabaseAdmin, dbUser)
          if (repairedUser) {
            const { data: repairedLinkData, error: repairedErr } = await supabaseAdmin.auth.admin.generateLink({
              type: "recovery",
              email: targetEmail,
              options: {
                redirectTo: `${appBaseUrl}/#type=recovery`,
              },
            })

            if (!repairedErr && repairedLinkData?.properties?.action_link) {
              recoveryLink = repairedLinkData.properties.action_link
              linkErr = null
            } else {
              linkErr = repairedErr
            }
          }
        }
      }

      if (!recoveryLink || linkErr) {
        console.warn("send_password_recovery link generation failed:", linkErr?.message || linkErr)
        return new Response(JSON.stringify({
          success: true,
          message: "إذا كان الحساب مسجلاً في المنظومة، فقد تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const smtpUser = Deno.env.get("SMTP_USER")?.trim()
      if (!smtpUser) {
        return new Response(JSON.stringify({ error: "Server misconfigured: SMTP_USER environment variable is not set" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const rawPass = Deno.env.get("SMTP_PASS")
      if (!rawPass) {
        return new Response(JSON.stringify({ error: "Server misconfigured: SMTP_PASS environment variable is not set" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const smtpPass = rawPass.replace(/\s+/g, "")
      const smtpHost = Deno.env.get("SMTP_HOST") || "smtp.gmail.com"
      const smtpPort = Number(Deno.env.get("SMTP_PORT")) || 465
      const fromName = "جامعة الزقازيق الأهلية - منظومة المخازن"
      const emailFrom = `"${fromName}" <${smtpUser}>`

      const emailSubject = "[جامعة الزقازيق الأهلية] رابط استعادة كلمة المرور الخاص بحسابك"

      const emailText = `مرحباً ${targetFullName || "بك"}،

تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في منظومة إدارة المخازن والمشتريات بجامعة الزقازيق الأهلية.

يُرجى الضغط على الرابط التالي لاختيار كلمة مرور جديدة لحسابك:
${recoveryLink}

⚠️ ملاحظة أمنية: هذا الرابط مخصص لك وصالح لفترة محدودة وللاستخدام مرة واحدة فقط. إذا لم تكن قد طلبت تعيين كلمة المرور، يرجى تجاهل هذه الرسالة وسيبقى حسابك آمناً تماماً.

جامعة الزقازيق الأهلية — الإدارة العامة للمخازن والمشتريات © 2026`

      const safeTargetName = escapeHtml(targetFullName || "بك")
      const safeRecoveryHref = recoveryLink.startsWith("https://") || recoveryLink.startsWith("http://localhost")
        ? escapeHtml(recoveryLink)
        : ""

      const emailHtml = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(emailSubject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; direction: rtl;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">جامعة الزقازيق الأهلية</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.95; font-size: 15px; color: #f0fdfa;">منظومة إدارة المخازن والمشتريات — استعادة كلمة المرور</p>
    </div>
    <div style="padding: 30px 24px;">
      <div style="font-size: 17px; font-weight: 600; margin-bottom: 16px; color: #0f172a;">مرحباً ${safeTargetName}،</div>
      <p style="line-height: 1.6; color: #334155; font-size: 15px; margin: 0 0 16px 0;">
        تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في المنظومة. يُرجى الضغط على الزر أدناه لاختيار كلمة مرور جديدة:
      </p>

      <div style="text-align: center; margin: 30px 0 25px 0;">
        <a href="${safeRecoveryHref}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0d9488; color: #ffffff !important; padding: 14px 34px; font-size: 16px; font-weight: 700; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(13, 148, 136, 0.3); text-align: center;">إعادة تعيين كلمة المرور الآن</a>
      </div>

      <div style="margin-top: 15px; margin-bottom: 25px; text-align: center; font-size: 13px; color: #64748b; line-height: 1.6;">
        إذا واجهتك مشكلة في الضغط على الزر أعلاه، يُرجى <a href="${safeRecoveryHref}" target="_blank" rel="noopener noreferrer" style="color: #0d9488; font-weight: 600; text-decoration: underline;">الضغط هنا لفتح صفحة تعيين كلمة المرور مباشرة</a>.
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
        ⚠️ <strong>ملاحظة أمنية:</strong> هذا الرابط صالح للاستخدام لمرة واحدة فقط وينتهي تلقائياً بعد فترة قصيرة. إذا لم تكن قد طلبت تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة بكل أمان.
      </p>
    </div>
    <div style="background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.5;">
      جامعة الزقازيق الأهلية &copy; 2026 — الإدارة العامة للمخازن والمشتريات<br>
      <span style="font-size: 11px; color: #94a3b8;">تم إرسال هذا البريد الإلكتروني تلقائياً للتحقق من هوية صاحب الحساب.</span>
    </div>
  </div>
</body>
</html>
`

      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        })

        await transporter.sendMail({
          from: emailFrom,
          to: targetEmail,
          replyTo: smtpUser,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
          headers: {
            "Auto-Submitted": "auto-generated",
            "X-Auto-Response-Suppress": "All",
            "Precedence": "bulk",
          },
        })
      } catch (err: unknown) {
        console.error("send_password_recovery email error:", err)
        return new Response(JSON.stringify({
          error: "تعذر إرسال رسالة تعيين كلمة المرور عبر مزود البريد. يرجى المحاولة لاحقاً.",
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      return new Response(JSON.stringify({
        success: true,
        message: "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني المسجل في النظام بنجاح.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Caller privilege check (System Admin or Department Admin)
    const isSystemAdmin =
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === "system_admin"

    const isDepartmentAdmin = caller.app_metadata?.role === "admin"

    if (!isSystemAdmin) {
      await logAdminSecurityEvent(supabaseAdmin, req, {
        caller,
        action: `محاولة وصول غير مصرح لإجراء إداري (${action}) من غير مدير النظام`,
        eventType: "unauthorized_api_access",
        severity: "warning",
        entityId: action,
        details: { action, reason: "forbidden_non_system_admin" },
      })
      return new Response(JSON.stringify({
        error: "غير مصرح لك: إجراءات إدارة الحسابات مقتصرة حصرياً على مدراء النظام والأقسام.",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Department admins may only perform delegation-allowed actions
    const allowedDeptAdminActions = [
      "list_registration_requests",
      "approve_registration_request",
      "resend_registration_invitation",
      "cancel_registration_invitation",
      "reject_registration_request",
      "get_department_delegation",
      "inspect_invite_link",
    ]

    if (!isSystemAdmin && !allowedDeptAdminActions.includes(action)) {
      return new Response(JSON.stringify({
        error: "غير مصرح لمدير القسم تنفيذ هذا الإجراء. الإجراء مقتصر على مدير النظام الرئيسي (System Admin).",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const callerUsername = (caller.app_metadata?.username as string) || (caller.email?.replace(/@warehouse\.local$/, "") ?? "")
    const isCallerProtected = isProtectedUsername(callerUsername) || isProtectedUsername(caller.email)

    // ─── ACTION: list_users ──────────────────────────────────────────────────
    if (action === "list_users") {
      const page = Math.max(1, Number(body.page) || 1)
      const perPage = Math.min(100, Math.max(1, Number(body.perPage) || 50))
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
      if (listError) throw listError

      // Fetch mirror profile data from app_users
      const { data: appUsersData } = await supabaseAdmin
        .from("app_users")
        .select("id, username, display_name, role, status, created_at, activated_at, last_login_at, notes, permissions, auth_user_id, must_change_password, employee_id, email, department, telegram_user_id")

      const appUserMap = new Map((appUsersData as any[] || []).map((u: any) => [normalizeUsername(u.username), u]))

      const allUsers = (listData?.users || []).map((u: any) => {
        const username = (u.app_metadata?.username as string) || (u.email?.replace(/@warehouse\.local$/, "") ?? "")
        const mirror: any = appUserMap.get(normalizeUsername(username))

        const employeeId = mirror?.employee_id || (u.app_metadata?.employee_id as string) || (isProtectedUsername(username) ? "SYS-ADM-000001" : "")
        const department = mirror?.department || (u.app_metadata?.department as string) || (isProtectedUsername(username) ? "الإدارة العامة" : "")

        return {
          id: u.id,
          username,
          displayName: (u.user_metadata?.displayName as string) || mirror?.display_name || username,
          email: u.email ?? "",
          role: u.app_metadata?.role || mirror?.role || "viewer",
          systemAdmin: u.app_metadata?.system_admin === true || u.app_metadata?.role === "system_admin",
          status: mirror?.status || (u.app_metadata?.status as string) || "active",
          employeeId,
          department,
          telegramUserId: mirror?.telegram_user_id || null,
          permissions: (u.app_metadata?.permissions as string[]) || mirror?.permissions || [],
          mustChangePassword: Boolean(u.app_metadata?.must_change_password ?? mirror?.must_change_password),
          createdAt: u.created_at,
          lastSignInAt: u.last_sign_in_at || mirror?.last_login_at,
        }
      })

      // Layer 2: Hide protected System Admin marwan-desouky from all other callers
      const visibleUsers = allUsers.filter((u: any) => {
        if (isProtectedUsername(u.username) || isProtectedUsername(u.email)) {
          return isCallerProtected
        }
        return true
      })

      return new Response(JSON.stringify({ success: true, users: visibleUsers }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: create_user ─────────────────────────────────────────────────
    if (action === "create_user") {
      const { username, displayName, password, role = "viewer", permissions = [], requirePasswordChange = true } = body

      const cleanUsername = normalizeUsername(username)
      if (!cleanUsername) {
        return new Response(JSON.stringify({ error: "اسم المستخدم مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (cleanUsername.includes(" ")) {
        return new Response(JSON.stringify({ error: "اسم المستخدم يجب ألا يحتوي على مسافات." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 1. Reserved username check
      if (isProtectedUsername(cleanUsername)) {
        return new Response(JSON.stringify({
          error: "اسم المستخدم محجوز لحساب مدير النظام الرئيسي ولا يمكن استخدامه.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 2. Sole System Admin rule: Forbid creating another user with system_admin role
      if (role === "system_admin" || body.system_admin === true) {
        return new Response(JSON.stringify({
          error: "غير مصرح: مدير النظام الرئيسي (System Admin) حساب ثابت وموحد، ولا يمكن تعيين مدير نظام آخر. يمكنك منح صلاحيات إضافية محددة بدلاً من ذلك.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const allowedRoles = [
        "admin",
        "warehouse_admin",
        "warehouse_employee",
        "procurement_admin",
        "procurement_employee",
        "warehouse_staff",
        "purchasing_staff",
        "editor",
        "viewer",
      ]
      if (!allowedRoles.includes(role)) {
        return new Response(JSON.stringify({ error: "الدور المحدد غير صالح." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Generate strong temporary password if not provided
      let effectivePassword = password
      if (!effectivePassword || typeof effectivePassword !== "string" || effectivePassword.trim().length === 0) {
        effectivePassword = generateSecureTempPassword()
      } else if (effectivePassword.length < 6) {
        return new Response(JSON.stringify({ error: "كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const syntheticEmail = `${cleanUsername}@warehouse.local`

      // Generate or allocate employee_id if not explicitly provided
      let assignedEmployeeId = body.employeeId || null
      if (!assignedEmployeeId) {
        try {
          const { data: codeData } = await supabaseAdmin.rpc("generate_employee_code", { p_role: role })
          if (codeData) assignedEmployeeId = codeData
        } catch {
          // ignore RPC error and fallback
        }
      }
      if (!assignedEmployeeId) {
        const prefix = (role === "warehouse_admin" || role === "admin") ? "WH-ADM"
          : role === "procurement_admin" ? "PUR-ADM"
            : role === "procurement_employee" ? "PUR-EMP"
              : role === "viewer" ? "WH-VIE"
                : "WH-EMP"
        const [appRes, regRes] = await Promise.all([
          supabaseAdmin.from("app_users").select("employee_id").ilike("employee_id", `${prefix}-%`),
          supabaseAdmin.from("registration_requests").select("employee_id").ilike("employee_id", `${prefix}-%`),
        ])
        const allCodes = [...(appRes.data || []), ...(regRes.data || [])]
        let maxNum = 0
        for (const row of allCodes) {
          const match = (row.employee_id || "").match(/(\d+)$/)
          if (match) {
            const n = parseInt(match[1], 10)
            if (n > maxNum) maxNum = n
          }
        }
        assignedEmployeeId = `${prefix}-${String(maxNum + 1).padStart(6, "0")}`
      }

      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        password: effectivePassword,
        email_confirm: true,
        user_metadata: {
          username: cleanUsername,
          displayName: displayName?.trim() || cleanUsername,
          name: displayName?.trim() || cleanUsername,
          employee_id: assignedEmployeeId,
        },
        app_metadata: {
          username: cleanUsername,
          role,
          department: body.department || (role.startsWith('procurement') ? 'المشتريات' : role.startsWith('warehouse') ? 'المخازن' : 'المخازن'),
          system_admin: false,
          employee_id: assignedEmployeeId,
          permissions: permissions || [],
          must_change_password: Boolean(requirePasswordChange),
        },
      })

      if (createError) {
        console.error("admin createUser error:", createError.message)
        return new Response(JSON.stringify({ error: "تعذر إنشاء حساب المستخدم." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Upsert mirror row in app_users WITHOUT plaintext password
      await supabaseAdmin.from("app_users").upsert({
        username: cleanUsername,
        display_name: displayName?.trim() || cleanUsername,
        role,
        department: body.department || (role.startsWith('procurement') ? 'المشتريات' : role.startsWith('warehouse') ? 'المخازن' : 'المخازن'),
        email: body.email || null,
        employee_id: assignedEmployeeId,
        status: "active",
        permissions: permissions || [],
        auth_user_id: createData.user?.id,
        must_change_password: Boolean(requirePasswordChange),
      }, { onConflict: "username" })

      // Audit log (never log passwords!)
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `إنشاء مستخدم جديد: ${cleanUsername} (${role})`,
        entity_type: "user_management",
        entity_id: createData.user?.id,
        details: { username: cleanUsername, role, requirePasswordChange },
      })

      return new Response(JSON.stringify({
        success: true,
        user: {
          id: createData.user?.id,
          username: cleanUsername,
          displayName: displayName?.trim() || cleanUsername,
          role,
          mustChangePassword: Boolean(requirePasswordChange),
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: change_password ─────────────────────────────────────────────
    if (action === "change_password") {
      const { userId, username, newPassword, mustChangePassword = false } = body

      let targetAuthUser: any = null
      let targetUsername = username ? normalizeUsername(username) : ""

      // 1. Try finding by Supabase Auth UID if it's a valid UUID
      if (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        const { data: byId } = await supabaseAdmin.auth.admin.getUserById(userId)
        if (byId?.user) {
          targetAuthUser = byId.user
          targetUsername = targetAuthUser.email?.replace(/@warehouse\.local$/, "") ?? ""
        }
      }

      // 2. Look up by username or internal ID in app_users
      if (!targetAuthUser) {
        let appUserQuery = supabaseAdmin.from("app_users").select("*")
        if (targetUsername) {
          appUserQuery = appUserQuery.ilike("username", targetUsername)
        } else if (userId) {
          appUserQuery = appUserQuery.eq("id", userId)
        }
        const { data: dbUser } = await appUserQuery.maybeSingle()
        if (dbUser) {
          targetUsername = normalizeUsername(dbUser.username)
          if (dbUser.auth_user_id) {
            const { data: byAuthId } = await supabaseAdmin.auth.admin.getUserById(dbUser.auth_user_id)
            if (byAuthId?.user) {
              targetAuthUser = byAuthId.user
            }
          }
        }
      }

      // 3. Look up by synthetic email in Auth users list using paginated lookup
      if (!targetAuthUser && targetUsername) {
        const syntheticEmail = `${targetUsername}@warehouse.local`
        const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 50 })
        targetAuthUser = (authList?.users || []).find(
          (u: any) => normalizeUsername(u.email) === normalizeUsername(syntheticEmail)
        )
      }

      if (!targetUsername) {
        return new Response(JSON.stringify({ error: "اسم المستخدم أو المعرّف مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const isTargetProtected = isProtectedUsername(targetUsername) || (targetAuthUser && isProtectedUsername(targetAuthUser.email))

      // Strictly forbid changing marwan-desouky's password via admin-users Edge Function
      if (isTargetProtected) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: `محاولة غير مصرح بها لإعادة تعيين كلمة مرور الحساب المحمي (${targetUsername})`,
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityId: targetUsername,
          details: { action: "reset_password", targetUsername, reason: "protected_account_violation" },
        })
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن إعادة تعيين كلمة مرور مدير النظام الرئيسي من لوحة الإدارة. يتم تغيير كلمة المرور حصرياً من قِبل صاحب الحساب من داخل جلسته الشخصية.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      let effectivePassword = newPassword
      if (!effectivePassword || typeof effectivePassword !== "string" || effectivePassword.trim().length === 0) {
        effectivePassword = generateSecureTempPassword()
      } else if (effectivePassword.length < 6) {
        return new Response(JSON.stringify({ error: "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف أو أرقام للأمان." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const syntheticEmail = `${targetUsername}@warehouse.local`

      if (targetAuthUser) {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetAuthUser.id, {
          password: effectivePassword,
          app_metadata: {
            ...targetAuthUser.app_metadata,
            must_change_password: Boolean(mustChangePassword),
          },
        })
        if (updateError) throw updateError
      } else {
        // Create in Supabase Auth directly if not yet provisioned
        const { data: createdAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: syntheticEmail,
          password: effectivePassword,
          email_confirm: true,
          user_metadata: {
            username: targetUsername,
          },
          app_metadata: {
            username: targetUsername,
            role: "viewer",
            system_admin: false,
            must_change_password: Boolean(mustChangePassword),
          },
        })
        if (createError) throw createError
        targetAuthUser = createdAuth?.user
      }

      // Update app_users row with auth_user_id and must_change_password (NEVER store password!)
      await supabaseAdmin.from("app_users").update({
        auth_user_id: targetAuthUser.id,
        must_change_password: Boolean(mustChangePassword),
      }).ilike("username", targetUsername)

      // Audit log (never includes password)
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `إعادة تعيين كلمة مرور المستخدم: ${targetUsername}`,
        entity_type: "user_management",
        entity_id: targetAuthUser.id,
        details: { target_username: targetUsername, must_change_password: Boolean(mustChangePassword) },
      })

      return new Response(JSON.stringify({
        success: true,
        message: "تم تغيير كلمة المرور بنجاح.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: update_user ─────────────────────────────────────────────────
    if (action === "update_user") {
      const { userId, role, permissions, displayName } = body
      if (!userId) {
        return new Response(JSON.stringify({ error: "معرّف المستخدم مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: targetUser, error: getError } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (getError || !targetUser?.user) {
        return new Response(JSON.stringify({ error: "المستخدم غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const targetUsername = targetUser.user.email?.replace(/@warehouse\.local$/, "") ?? ""
      const isTargetProtected = isProtectedUsername(targetUsername) || isProtectedUsername(targetUser.user.email)

      // 1. Protected System Admin constraints
      if (isTargetProtected) {
        if (!isCallerProtected) {
          await logAdminSecurityEvent(supabaseAdmin, req, {
            caller,
            action: `محاولة غير مصرح بها لتعديل بيانات الحساب المحمي (${targetUsername})`,
            eventType: "unauthorized_api_access",
            severity: "critical",
            entityId: userId,
            details: { action: "update_user", targetUsername, reason: "protected_account_violation" },
          })
          return new Response(JSON.stringify({
            error: "غير مصرح: بيانات وهوية حساب مدير النظام الرئيسي محمية بالكامل ولا يمكن تعديلها إلا من قِبل صاحب الحساب نفسه.",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Even caller himself cannot demote his own role away from system_admin
        if (role && role !== "system_admin") {
          return new Response(JSON.stringify({
            error: "غير مصرح: لا يمكن تعديل أو تخفيض دور مدير النظام الرئيسي.",
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      // 2. Sole System Admin rule: Forbid promoting anyone else to system_admin
      if (!isTargetProtected && (role === "system_admin" || body.system_admin === true)) {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن ترقية أي مستخدم لدور مدير النظام (System Admin). يمكنك منح صلاحيات إضافية محددة بدلاً من ذلك.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 3. Root admin demotion protection
      if (targetUsername.toLowerCase() === "admin" && role && role !== "admin") {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن تخفيض صلاحيات المشرف الرئيسي (admin).",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const oldRole = targetUser.user.app_metadata?.role || "viewer"
      const oldPermissions = targetUser.user.app_metadata?.permissions ?? []
      const oldDepartment = targetUser.user.app_metadata?.department
      const newRole = isTargetProtected ? "system_admin" : (role || oldRole)
      const newPermissions = isTargetProtected
        ? ["view_audit", "view_settings", "manage_records"]
        : (permissions ?? oldPermissions)

      const newDepartment = body.department || oldDepartment
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...targetUser.user.user_metadata,
          displayName: displayName || targetUser.user.user_metadata?.displayName,
        },
        app_metadata: {
          ...targetUser.user.app_metadata,
          role: newRole,
          department: newDepartment,
          system_admin: isTargetProtected,
          permissions: newPermissions,
        },
      })

      if (updateError) throw updateError

      // Mirror to app_users
      await supabaseAdmin.from("app_users").update({
        display_name: displayName || targetUser.user.user_metadata?.displayName,
        role: newRole,
        department: newDepartment,
        permissions: newPermissions,
      }).eq("username", targetUsername.toLowerCase())

      const roleChanged = oldRole !== newRole
      const permsChanged = JSON.stringify(oldPermissions) !== JSON.stringify(newPermissions)
      const isSelfChange = caller.id === userId || (caller.email && targetUser.user.email && caller.email.toLowerCase() === targetUser.user.email.toLowerCase())
      const isPrivilegeChange = roleChanged || permsChanged

      await logAdminSecurityEvent(supabaseAdmin, req, {
        caller,
        action: isPrivilegeChange
          ? (isSelfChange
            ? `⚠️ تنبيه أمني حرج: محاولة تعديل صلاحيات أو دور الحساب الشخصي (${targetUsername})`
            : `تعديل الصلاحيات أو الدور للمستخدم (${targetUsername}): ${oldRole} ➔ ${newRole}`)
          : `تحديث بيانات المستخدم: ${targetUsername}`,
        eventType: isPrivilegeChange
          ? (isSelfChange ? "self_role_permission_change" : "role_permission_change")
          : "update_user",
        severity: isPrivilegeChange ? "critical" : "info",
        entityType: "user_management",
        entityId: userId,
        tableName: "app_users",
        oldData: {
          role: oldRole,
          permissions: oldPermissions,
          department: oldDepartment,
        },
        newData: {
          role: newRole,
          permissions: newPermissions,
          department: newDepartment,
        },
        details: {
          target_username: targetUsername,
          oldRole,
          newRole,
          oldPermissions,
          newPermissions,
          is_self_change: Boolean(isSelfChange && isPrivilegeChange),
        },
      })

      return new Response(JSON.stringify({ success: true, message: "تم تحديث المستخدم بنجاح." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: delete_user ─────────────────────────────────────────────────
    if (action === "delete_user") {
      const { userId, username, email } = body
      if (!userId && !username && !email) {
        return new Response(JSON.stringify({ error: "معرّف المستخدم أو اسم المستخدم مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      let targetAuthId: string | null = null
      let targetUsername = username ? normalizeUsername(username) : ""
      let targetEmail = email ? email.trim().toLowerCase() : ""

      // 1. Try resolving auth user if userId looks like a UUID
      const isUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
      if (isUuid) {
        const { data: targetAuth } = await supabaseAdmin.auth.admin.getUserById(userId)
        if (targetAuth?.user) {
          targetAuthId = targetAuth.user.id
          if (!targetUsername) {
            targetUsername = (targetAuth.user.app_metadata?.username as string) || (targetAuth.user.email?.replace(/@warehouse\.local$/, "") ?? "")
          }
          if (!targetEmail && targetAuth.user.email) {
            targetEmail = targetAuth.user.email.toLowerCase()
          }
        }
      }

      // 2. If not found yet, search in app_users using parameterized exact queries
      let mirror: Record<string, any> | null = null
      if (userId) {
        const { data: byId } = await supabaseAdmin.from("app_users").select("*").eq("id", userId).maybeSingle()
        mirror = byId
        if (!mirror && isUuid) {
          const { data: byAuth } = await supabaseAdmin.from("app_users").select("*").eq("auth_user_id", userId).maybeSingle()
          mirror = byAuth
        }
      }
      if (!mirror && targetUsername && isSafeFilterIdentifier(targetUsername)) {
        const { data: byUser } = await supabaseAdmin.from("app_users").select("*").ilike("username", targetUsername).maybeSingle()
        mirror = byUser
      }
      if (mirror) {
        if (!targetUsername) targetUsername = mirror.username
        if (!targetAuthId && mirror.auth_user_id) targetAuthId = mirror.auth_user_id
        if (!targetEmail && mirror.email) targetEmail = mirror.email.toLowerCase()
      }

      // 3. Search auth.users by paginated listUsers if targetAuthId is still not resolved
      if (!targetAuthId && targetUsername) {
        const syntheticEmail = `${targetUsername}@warehouse.local`.toLowerCase()
        let page = 1
        const perPage = 200
        while (page <= 20 && !targetAuthId) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
          const users = listData?.users || []
          const matched = users.find(
            (u) =>
              u.email?.toLowerCase() === syntheticEmail ||
              (targetEmail && u.email?.toLowerCase() === targetEmail) ||
              normalizeUsername(u.app_metadata?.username as string) === targetUsername
          )
          if (matched) {
            targetAuthId = matched.id
            if (!targetEmail && matched.email) targetEmail = matched.email.toLowerCase()
            break
          }
          if (users.length < perPage) break
          page += 1
        }
      }

      // 4. Strictly forbid deleting the System Admin (marwan-desouky / marwandesouqhi@gmail.com)
      const isTargetProtected =
        isProtectedUsername(targetUsername) ||
        isProtectedUsername(targetEmail) ||
        (targetAuthId && caller.id === targetAuthId && isCallerProtected)

      if (isTargetProtected) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: `محاولة غير مصرح بها لحذف الحساب المحمي (${targetUsername})`,
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityId: targetAuthId || userId || targetUsername,
          details: { action: "delete_user", targetUsername, reason: "protected_account_violation" },
        })
        return new Response(JSON.stringify({
          error: "غير مصرح: حساب مدير النظام الرئيسي (marwan-desouky) محمي بشكل دائم ولا يمكن حذفه نهائياً من النظام.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 5. Permanent deletion from Supabase Auth (auth.users)
      if (targetAuthId) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(targetAuthId)
        } catch (authDelErr) {
          console.warn("Could not delete from auth.users:", authDelErr)
        }
      }

      // 6. Permanent deletion from public database tables (app_users, user_invitations, registration_requests, telegram_user_sessions)
      if (targetUsername || userId) {
        if (targetUsername) {
          await supabaseAdmin.from("app_users").delete().ilike("username", targetUsername)
          await supabaseAdmin.from("user_invitations").delete().ilike("username", targetUsername)
          await supabaseAdmin.from("telegram_user_sessions").delete().ilike("username", targetUsername)
        }
        if (userId) {
          await supabaseAdmin.from("app_users").delete().eq("id", userId)
        }
        if (targetAuthId) {
          await supabaseAdmin.from("app_users").delete().eq("auth_user_id", targetAuthId)
        }
      }

      if (targetEmail) {
        await supabaseAdmin.from("user_invitations").delete().ilike("email", targetEmail)
        await supabaseAdmin.from("registration_requests").delete().ilike("email", targetEmail)
        await supabaseAdmin.from("telegram_user_sessions").delete().ilike("email", targetEmail)
      }

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `حذف حساب المستخدم نهائياً من قاعدة البيانات: ${targetUsername || userId}`,
        entity_type: "user_management",
        entity_id: targetAuthId || userId,
        details: { target_username: targetUsername, target_email: targetEmail, auth_id: targetAuthId },
      })

      return new Response(JSON.stringify({
        success: true,
        message: "تم حذف المستخدم وجميع سجلاته المرتبطة نهائياً من قاعدة البيانات ونظام المصادقة.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: repair_data_quality ─────────────────────────────────────────
    if (action === "repair_data_quality") {
      try {
        const { data: rpcData } = await supabaseAdmin.rpc("repair_movements_data_quality");

        await supabaseAdmin.from("audit_logs").insert({
          user_id: caller.id,
          user_email: caller.email,
          action: "تشغيل أداة الإصلاح الذاتي لجودة البيانات وتصحيح الحركات",
          entity_type: "data_quality_repair",
          details: rpcData || {},
        });

        return new Response(JSON.stringify({
          success: true,
          message: "تم إصلاح وتدقيق جميع سجلات الحركات وجودة البيانات بنجاح في قاعدة البيانات.",
          result: rpcData || { total_repaired: 0 },
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({
          success: false,
          error: "تعذر تشغيل أداة الإصلاح في قاعدة البيانات: " + errMsg,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── ACTION: purge_demo_data ─────────────────────────────────────────────
    if (action === "purge_demo_data") {
      if (!isSystemAdmin) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: "محاولة وصول غير مصرح لإجراء مسح البيانات التجريبية",
          eventType: "unauthorized_api_access",
          severity: "warning",
          entityId: "purge_demo_data",
          details: { action: "purge_demo_data" },
        })
        return new Response(JSON.stringify({
          error: "إجراء مسح البيانات التجريبية مقتصر على مدير النظام الرئيسي (System Admin).",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // 1. Delete from asset_movement_log
      const { count: astCount } = await supabaseAdmin
        .from("asset_movement_log")
        .delete({ count: "exact" })
        .or("asset_code.in.(ZNU-IT-001,ZNU-MED-044),id.like.ast-%")

      // 2. Delete from supplier_contracts
      const { count: cntCount } = await supabaseAdmin
        .from("supplier_contracts")
        .delete({ count: "exact" })
        .or("contract_number.in.(CNT-2026-001,CNT-2026-002),id.like.cnt-%")

      // 3. Delete from budget_plans
      const { count: bgCount } = await supabaseAdmin
        .from("budget_plans")
        .delete({ count: "exact" })
        .like("id", "bg-%")

      // 4. Delete from financial_reports
      const { count: frCount } = await supabaseAdmin
        .from("financial_reports")
        .delete({ count: "exact" })
        .or("report_number.in.(RPT-FIN-2026-Q3,RPT-FIN-2026-M10),id.like.fr-%")

      // 5. Delete from notifications
      const { count: notifCount } = await supabaseAdmin
        .from("notifications")
        .delete({ count: "exact" })
        .like("id", "notif-%")

      // Log in audit logs
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: "تنظيف ومسح البيانات التجريبية من قاعدة البيانات بنجاح",
        entity_type: "database_cleanup",
        details: {
          deleted_assets: astCount ?? 0,
          deleted_contracts: cntCount ?? 0,
          deleted_budgets: bgCount ?? 0,
          deleted_reports: frCount ?? 0,
          deleted_notifications: notifCount ?? 0,
        },
      })

      return new Response(JSON.stringify({
        success: true,
        message: "تم مسح جميع البيانات التجريبية بنجاح من قاعدة البيانات والأنظمة الفرعية.",
        purged: {
          deleted_assets: astCount ?? 0,
          deleted_contracts: cntCount ?? 0,
          deleted_budgets: bgCount ?? 0,
          deleted_reports: frCount ?? 0,
          deleted_notifications: notifCount ?? 0,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: get_system_backup_stats ─────────────────────────────────────
    if (action === "get_system_backup_stats") {
      try {
        const { data: statsData, error: statsErr } = await supabaseAdmin.rpc("get_system_backup_stats");
        if (!statsErr && statsData) {
          return new Response(JSON.stringify({ success: true, stats: statsData }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        // fallback
      }

      const [
        { count: movementsCount },
        { count: custodyCount },
        { count: usersCount },
        { count: contractsCount },
        { count: disbursementsCount },
        { count: budgetCount },
        { count: financialCount },
        { count: assetsCount },
        { count: ticketsCount },
        { count: inspectionsCount },
        { count: settlementsCount },
      ] = await Promise.all([
        supabaseAdmin.from("ledger_movements").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("custody").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("app_users").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("supplier_contracts").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("disbursement_requests").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("budget_plans").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("financial_reports").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("asset_movement_log").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("support_tickets").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("technical_inspections").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("inventory_settlements").select("*", { count: "exact", head: true }),
      ]);

      return new Response(JSON.stringify({
        success: true,
        stats: {
          movements: movementsCount ?? 0,
          custody: custodyCount ?? 0,
          users: usersCount ?? 0,
          contracts: contractsCount ?? 0,
          disbursementRequests: disbursementsCount ?? 0,
          budgetPlans: budgetCount ?? 0,
          financialReports: financialCount ?? 0,
          assetMovements: assetsCount ?? 0,
          supportTickets: ticketsCount ?? 0,
          technicalInspections: inspectionsCount ?? 0,
          inventorySettlements: settlementsCount ?? 0,
          timestamp: new Date().toISOString(),
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── ACTION: reset_and_seed_system_admin (REJECTED / DISABLED) ───────────
    if (action === "reset_and_seed_system_admin") {
      return new Response(JSON.stringify({
        error: "هذا الإجراء محظور نهائياً لمنع مساس أو حذف أي بيانات مستخدمين. لتهيئة حساب مدير النظام، استخدم إجراء bootstrap_system_admin، ولتعيين كلمة المرور استخدم send_password_recovery.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: get_department_delegation ───────────────────────────────────
    if (action === "get_department_delegation") {
      try {
        const { data: sett, error: settErr } = await supabaseAdmin
          .from("registration_approval_settings")
          .select("department, delegation_enabled, updated_at")

        if (settErr) {
          console.warn("Could not fetch registration_approval_settings:", settErr)
          return new Response(JSON.stringify({
            success: true,
            enableDepartmentDelegation: false,
            updatedAt: null,
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        const isAnyDelegated = Array.isArray(sett) && sett.some((s: any) => s.delegation_enabled === true)

        return new Response(JSON.stringify({
          success: true,
          enableDepartmentDelegation: isAnyDelegated,
          updatedAt: sett?.[0]?.updated_at || null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      } catch (err: unknown) {
        console.warn("get_department_delegation error:", err)
        return new Response(JSON.stringify({
          success: true,
          enableDepartmentDelegation: false,
          updatedAt: null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    // ─── ACTION: set_department_delegation ───────────────────────────────────
    if (action === "set_department_delegation") {
      if (!isSystemAdmin) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: "محاولة غير مصرح بها لتعديل إعدادات تفويض اعتماد الأقسام",
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityId: "set_department_delegation",
          details: { action: "set_department_delegation" },
        })
        return new Response(JSON.stringify({
          error: "تعديل تفويض اعتماد طلبات الأقسام مقتصر حصرياً على مدير النظام الرئيسي.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const enabled = Boolean(body.enabled)

      const { error: updErr } = await supabaseAdmin
        .from("registration_approval_settings")
        .update({
          delegation_enabled: enabled,
          updated_at: new Date().toISOString(),
          enabled_by: caller.id,
        })
        .in("department", ["warehouse", "procurement", "المخازن", "المشتريات"])

      if (updErr) {
        console.warn("Could not update registration_approval_settings:", updErr)
      }

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `تعديل تفويض اعتماد طلبات الأقسام إلى: ${enabled ? "مفعّل" : "معطّل"}`,
        entity_type: "settings",
        entity_id: "registration_approval_settings",
        details: { enable_department_delegation: enabled },
      })

      return new Response(JSON.stringify({
        success: true,
        message: `تم ${enabled ? "تفعيل" : "تعطيل"} تفويض اعتماد الأقسام بنجاح.`,
        enableDepartmentDelegation: enabled,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: list_registration_requests ──────────────────────────────────
    if (action === "list_registration_requests") {
      let query = supabaseAdmin
        .from("registration_requests_admin_view")
        .select("*")
        .order("created_at", { ascending: false })

      // Department admins only see requests for their own department
      if (!isSystemAdmin && isDepartmentAdmin) {
        const callerDept = caller.app_metadata?.department
        if (callerDept) {
          query = query.eq("requested_department", callerDept)
        }
      }

      const { data: requests, error: reqErr } = await query

      if (reqErr) {
        // Fallback to table excluding sensitive OTP columns
        let fallbackQuery = supabaseAdmin
          .from("registration_requests")
          .select("id, full_name, email, telegram_user_id, telegram_username, requested_department, requested_role, verification_status, approval_status, approved_role, employee_id, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at")
          .order("created_at", { ascending: false })

        if (!isSystemAdmin && isDepartmentAdmin && caller.app_metadata?.department) {
          fallbackQuery = fallbackQuery.eq("requested_department", caller.app_metadata.department)
        }

        const { data: fallbackRequests, error: fbErr } = await fallbackQuery
        if (fbErr) throw fbErr

        return new Response(JSON.stringify({ success: true, requests: fallbackRequests || [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      return new Response(JSON.stringify({ success: true, requests: requests || [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: approve_registration_request ────────────────────────────────
    if (action === "approve_registration_request") {
      const { requestId, approvedRole } = body
      if (!requestId) {
        return new Response(JSON.stringify({ error: "معرّف طلب التسجيل مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Fetch request
      const { data: regReq, error: fetchErr } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle()

      if (fetchErr || !regReq) {
        return new Response(JSON.stringify({ error: "طلب التسجيل غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (regReq.approval_status === "approved" && regReq.invitation_status === "accepted") {
        return new Response(JSON.stringify({
          error: `تم اعتماد وتفعيل هذا الحساب مسبقاً بالرقم الوظيفي: ${regReq.employee_id}`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (regReq.verification_status !== "verified") {
        return new Response(JSON.stringify({
          error: "لا يمكن اعتماد طلب تسجيل لم يتم التحقق من بريده الإلكتروني بعد.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Strictly block self-approval
      if (caller.email && regReq.email && caller.email.trim().toLowerCase() === regReq.email.trim().toLowerCase()) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: `محاولة غير مصرح بها للاعتماد الذاتي لطلب تسجيل (${regReq.email})`,
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityId: requestId,
          details: { action: "approve_registration_request", reason: "self_approval_blocked" },
        })
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يجوز للمشرف اعتماد طلب التسجيل الخاص به.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const roleToAssign = approvedRole || regReq.requested_role

      if (roleToAssign === "system_admin") {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن منح دور مدير النظام الرئيسي من خلال طلبات تسجيل الموظفين.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const allowedRoles = [
        "warehouse_employee",
        "warehouse_admin",
        "procurement_employee",
        "procurement_admin",
        "admin",
        "viewer",
        "warehouse_staff",
        "purchasing_staff",
        "editor",
      ]
      if (!allowedRoles.includes(roleToAssign)) {
        return new Response(JSON.stringify({
          error: "الدور الوظيفي المحدد غير مسموح به في دورة الاعتماد.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Department admin specific safeguards
      if (!isSystemAdmin) {
        if (roleToAssign === "admin" || roleToAssign === "warehouse_admin" || roleToAssign === "procurement_admin") {
          await logAdminSecurityEvent(supabaseAdmin, req, {
            caller,
            action: `محاولة تصعيد صلاحيات مرفوضة: محاولة مدير قسم منح دور إداري (${roleToAssign})`,
            eventType: "unauthorized_api_access",
            severity: "critical",
            entityId: requestId,
            details: { action: "approve_registration_request", roleToAssign, reason: "privilege_escalation_blocked" },
          })
          return new Response(JSON.stringify({
            error: "غير مصرح: لا يمكن لمدير القسم تعيين دور إداري. فقط مدير النظام الرئيسي يمتلك هذه الصلاحية.",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        const callerDept = caller.app_metadata?.department
        if (!callerDept || callerDept !== regReq.requested_department) {
          await logAdminSecurityEvent(supabaseAdmin, req, {
            caller,
            action: `محاولة اعتماد طلب تسجيل خارج القسم (${regReq.requested_department})`,
            eventType: "unauthorized_api_access",
            severity: "warning",
            entityId: requestId,
            details: { action: "approve_registration_request", callerDept, requestedDept: regReq.requested_department },
          })
          return new Response(JSON.stringify({
            error: "غير مصرح: لا يمكنك اعتماد طلبات خارج قسمك.",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      // Execute SQL RPC approve_employee_registration (allocates Unique ID, reserves code registry, sets pending_activation)
      let allocatedEmployeeId = regReq.employee_id
      try {
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("approve_employee_registration", {
          p_request_id: requestId,
          p_approved_role: roleToAssign,
          p_reviewer_auth_id: caller.id,
        })
        if (!rpcErr && rpcRes?.employee_id) {
          allocatedEmployeeId = rpcRes.employee_id
        }
      } catch {
        // ignore RPC error and fallback to direct table allocation
      }

      if (!allocatedEmployeeId) {
        const prefix = (roleToAssign === "warehouse_admin" || roleToAssign === "admin") ? "WH-ADM"
          : roleToAssign === "procurement_admin" ? "PUR-ADM"
            : roleToAssign === "procurement_employee" ? "PUR-EMP"
              : roleToAssign === "viewer" ? "WH-VIE"
                : "WH-EMP"

        const [appRes, regRes] = await Promise.all([
          supabaseAdmin.from("app_users").select("employee_id").ilike("employee_id", `${prefix}-%`),
          supabaseAdmin.from("registration_requests").select("employee_id").ilike("employee_id", `${prefix}-%`),
        ])

        const allCodes = [...(appRes.data || []), ...(regRes.data || [])]
        let maxNum = 0
        for (const row of allCodes) {
          const match = (row.employee_id || "").match(/(\d+)$/)
          if (match) {
            const n = parseInt(match[1], 10)
            if (n > maxNum) maxNum = n
          }
        }
        const nextNum = maxNum + 1
        allocatedEmployeeId = `${prefix}-${String(nextNum).padStart(6, "0")}`

        // Insert or update placeholder in app_users
        const tempUsername = `pending_${allocatedEmployeeId.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
        await supabaseAdmin
          .from("app_users")
          .upsert({
            id: `usr-${allocatedEmployeeId.toLowerCase()}`,
            username: tempUsername,
            display_name: regReq.full_name,
            role: roleToAssign,
            department: regReq.requested_department,
            status: "pending_activation",
            email: regReq.email,
            employee_id: allocatedEmployeeId,
            telegram_user_id: regReq.telegram_user_id,
            notes: "قيد تفعيل الحساب واختيار اسم المستخدم وكلمة المرور",
          }, { onConflict: "employee_id" })

        // Update registration_requests table
        await supabaseAdmin
          .from("registration_requests")
          .update({
            approval_status: "approved",
            approved_role: roleToAssign,
            employee_id: allocatedEmployeeId,
            reviewed_by: caller.id,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestId)
      }
      const appBaseUrl = resolveAppBaseUrl(req)

      const targetEmail = regReq.email.trim().toLowerCase()
      // Generate invitation link ONLY (fail closed if email belongs to an existing Auth user to prevent recovery/magiclink takeover)
      let actionLink = ""
      let targetAuthUser: any = null

      try {
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: "invite",
          email: targetEmail,
          options: {
            redirectTo: `${appBaseUrl}/?type=invite&email=${encodeURIComponent(targetEmail)}`,
            data: {
              name: regReq.full_name,
              displayName: regReq.full_name,
              employee_id: allocatedEmployeeId,
            },
          },
        })
        if (!linkErr && linkData?.properties?.action_link && linkData.properties.action_link.includes("verify?token=")) {
          actionLink = linkData.properties.action_link
          targetAuthUser = linkData.user
        }
      } catch (err) {
        console.warn("generateLink invite error:", err)
      }

      if (!actionLink || !targetAuthUser) {
        return new Response(JSON.stringify({
          error: "تعذر توليد رابط دعوة تفعيل آمن لهذا البريد الإلكتروني (قد يكون البريد مسجلاً مسبقاً في نظام المصادقة).",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Dispatch direct invitation email via Google SMTP (Nodemailer) ONLY (never expose activation token in Telegram)
      const mailRes = await sendActivationInviteEmail({
        toEmail: regReq.email,
        fullName: regReq.full_name,
        employeeId: allocatedEmployeeId,
        role: roleToAssign,
        department: regReq.requested_department,
        actionLink,
      })

      if (!mailRes.success) {
        await supabaseAdmin
          .from("registration_requests")
          .update({
            invitation_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestId)

        await supabaseAdmin.from("audit_logs").insert({
          user_id: caller.id,
          user_email: caller.email,
          action: `فشل إرسال بريد دعوة تفعيل الموظف عبر Google SMTP: ${regReq.email}`,
          entity_type: "employee_approval",
          entity_id: allocatedEmployeeId,
          details: { requestId, error: mailRes.error },
        })

        return new Response(JSON.stringify({
          error: `تم اعتماد الطلب وتخصيص الرقم الوظيفي (${allocatedEmployeeId})، ولكن تعذر إرسال رسالة الدعوة عبر مزود البريد. يُرجى التحقق من إعدادات البريد وإعادة المحاولة.`,
          employeeId: allocatedEmployeeId,
          recoverable: true,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (targetAuthUser) {
        // Update server-managed app_metadata (never trust client user_metadata)
        await supabaseAdmin.auth.admin.updateUserById(targetAuthUser.id, {
          app_metadata: {
            role: roleToAssign,
            employee_id: allocatedEmployeeId,
            department: regReq.requested_department,
            system_admin: false,
            status: "pending_activation",
          },
        })

        // Link auth_user_id in app_users
        await supabaseAdmin
          .from("app_users")
          .update({
            auth_user_id: targetAuthUser.id,
            status: "pending_activation",
          })
          .eq("employee_id", allocatedEmployeeId)
      }

      // Record successful invitation send
      await supabaseAdmin
        .from("registration_requests")
        .update({
          invitation_status: "sent",
          invitation_sent_at: new Date().toISOString(),
          invitation_sent_by: caller.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)

      // Deliver status notification via Telegram (never transmit secret activation links over Telegram)
      const tgRes = await sendActivationInviteTelegram({
        telegramUserId: regReq.telegram_user_id,
        email: regReq.email,
        fullName: regReq.full_name,
        employeeId: allocatedEmployeeId,
        role: roleToAssign,
        department: regReq.requested_department,
      })
      const telegramInvitation: "sent" | "skipped" | "failed" = tgRes.success
        ? "sent"
        : tgRes.skipped
          ? "skipped"
          : "failed"

      // Record audit log
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `اعتماد طلب تسجيل الموظف وإرسال دعوة التفعيل بالبريد عبر Google SMTP: ${regReq.email}`,
        entity_type: "employee_approval",
        entity_id: allocatedEmployeeId,
        details: {
          requestId,
          employee_id: allocatedEmployeeId,
          role: roleToAssign,
          email: regReq.email,
          telegram_invitation: telegramInvitation,
          telegram_error: tgRes.error || null,
        },
      })

      let successMessage = "تم اعتماد الموظف وتخصيص الرقم الوظيفي وإرسال رابط الدعوة إلى البريد الإلكتروني عبر Google SMTP بنجاح."
      if (telegramInvitation === "sent") {
        successMessage = "تم اعتماد الموظف وتخصيص الرقم الوظيفي وإرسال رابط الدعوة إلى البريد الإلكتروني وتليجرام بنجاح."
      } else if (telegramInvitation === "failed") {
        successMessage = `تم اعتماد الموظف وتخصيص الرقم الوظيفي وإرسال رابط الدعوة إلى البريد الإلكتروني بنجاح (تعذر إرسال دعوة تليجرام: ${tgRes.error || "خطأ غير معروف"}).`
      }

      return new Response(JSON.stringify({
        success: true,
        message: successMessage,
        employeeId: allocatedEmployeeId,
        role: roleToAssign,
        invitationStatus: "sent",
        telegramInvitation,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: resend_registration_invitation ──────────────────────────────
    if (action === "resend_registration_invitation") {
      const { requestId } = body
      if (!requestId) {
        return new Response(JSON.stringify({ error: "معرّف طلب التسجيل مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: regReq } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle()

      if (!regReq) {
        return new Response(JSON.stringify({ error: "طلب التسجيل غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (regReq.approval_status !== "approved") {
        return new Response(JSON.stringify({ error: "الطلب غير معتمد بعد لإرسال دعوة." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (regReq.invitation_status === "accepted") {
        return new Response(JSON.stringify({ error: "تم تفعيل هذا الحساب بالفعل ولا يمكن إعادة إرسال الدعوة." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rate limit check: at least 30 seconds between resends
      if (regReq.invitation_sent_at) {
        const diffMs = Date.now() - new Date(regReq.invitation_sent_at).getTime()
        if (diffMs < 30000) {
          const waitSec = Math.ceil((30000 - diffMs) / 1000)
          return new Response(JSON.stringify({ error: `يرجى الانتظار ${waitSec} ثانية قبل إعادة إرسال الدعوة مرة أخرى.` }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      const appBaseUrl = resolveAppBaseUrl(req)
      const targetEmail = regReq.email.trim().toLowerCase()
      let actionLink = ""
      let targetAuthUser: any = null

      const { data: linkData, error: inviteErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email: targetEmail,
        options: {
          redirectTo: `${appBaseUrl}/?type=invite&email=${encodeURIComponent(targetEmail)}`,
          data: {
            name: regReq.full_name,
            displayName: regReq.full_name,
            employee_id: regReq.employee_id,
          },
        },
      })
      if (!inviteErr && linkData?.properties?.action_link && linkData.properties.action_link.includes("verify?token=")) {
        actionLink = linkData.properties.action_link
        targetAuthUser = linkData.user
      } else {
        // Only permit re-sending for unconfirmed pending_activation Auth accounts belonging to this registration
        const { data: existingData } = await supabaseAdmin.auth.admin.getUserByEmail(targetEmail)
        const existingUser = existingData?.user
        if (existingUser && !existingUser.email_confirmed_at && existingUser.app_metadata?.status === "pending_activation") {
          const { data: recData } = await supabaseAdmin.auth.admin.generateLink({
            type: "recovery",
            email: targetEmail,
            options: {
              redirectTo: `${appBaseUrl}/?type=invite&email=${encodeURIComponent(targetEmail)}`,
            },
          })
          if (recData?.properties?.action_link && recData.properties.action_link.includes("verify?token=")) {
            actionLink = recData.properties.action_link
            targetAuthUser = recData.user
          }
        }
      }

      if (!actionLink || !targetAuthUser) {
        return new Response(JSON.stringify({
          error: "تعذر إعادة توليد رابط دعوة التفعيل لهذا الحساب.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Send via Google SMTP (Nodemailer) ONLY
      const mailRes = await sendActivationInviteEmail({
        toEmail: regReq.email,
        fullName: regReq.full_name,
        employeeId: regReq.employee_id || "WH-EMP-NEW",
        role: regReq.approved_role || regReq.requested_role,
        department: regReq.requested_department,
        actionLink,
      })

      if (!mailRes.success) {
        return new Response(JSON.stringify({ error: "فشل إعادة إرسال الدعوة عبر مزود البريد." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (targetAuthUser) {
        await supabaseAdmin.auth.admin.updateUserById(targetAuthUser.id, {
          app_metadata: {
            role: regReq.approved_role || regReq.requested_role,
            employee_id: regReq.employee_id,
            department: regReq.requested_department,
            system_admin: false,
            status: "pending_activation",
          },
        })

        if (regReq.employee_id) {
          await supabaseAdmin
            .from("app_users")
            .update({
              auth_user_id: targetAuthUser.id,
              status: "pending_activation",
            })
            .eq("employee_id", regReq.employee_id)
        }
      }

      await supabaseAdmin
        .from("registration_requests")
        .update({
          invitation_status: "sent",
          invitation_sent_at: new Date().toISOString(),
          invitation_sent_by: caller.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)

      // Deliver status notification via Telegram (never transmit secret activation links over Telegram)
      const tgRes = await sendActivationInviteTelegram({
        telegramUserId: regReq.telegram_user_id,
        email: regReq.email,
        fullName: regReq.full_name,
        employeeId: regReq.employee_id || "WH-EMP-NEW",
        role: regReq.approved_role || regReq.requested_role,
        department: regReq.requested_department,
      })
      const telegramInvitation: "sent" | "skipped" | "failed" = tgRes.success
        ? "sent"
        : tgRes.skipped
          ? "skipped"
          : "failed"

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `إعادة إرسال دعوة تفعيل الموظف بالبريد عبر Google SMTP: ${regReq.email}`,
        entity_type: "employee_approval",
        entity_id: regReq.employee_id || requestId,
        details: {
          requestId,
          email: regReq.email,
          telegram_invitation: telegramInvitation,
          telegram_error: tgRes.error || null,
        },
      })

      let resendMessage = "تمت إعادة إرسال رابط الدعوة إلى البريد الإلكتروني عبر Google SMTP بنجاح."
      if (telegramInvitation === "sent") {
        resendMessage = "تمت إعادة إرسال رابط الدعوة إلى البريد الإلكتروني وتليجرام بنجاح."
      } else if (telegramInvitation === "failed") {
        resendMessage = `تمت إعادة إرسال رابط الدعوة إلى البريد الإلكتروني بنجاح (تعذر إرسال دعوة تليجرام: ${tgRes.error || "خطأ غير معروف"}).`
      }

      return new Response(JSON.stringify({
        success: true,
        message: resendMessage,
        invitationStatus: "sent",
        telegramInvitation,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: cancel_registration_invitation ──────────────────────────────
    if (action === "cancel_registration_invitation") {
      const { requestId } = body
      if (!requestId) {
        return new Response(JSON.stringify({ error: "معرّف طلب التسجيل مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: regReq } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle()

      if (!regReq) {
        return new Response(JSON.stringify({ error: "طلب التسجيل غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (regReq.invitation_status === "accepted") {
        return new Response(JSON.stringify({ error: "لا يمكن إلغاء دعوة لحساب تم تفعيله بالفعل." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Update request to cancelled
      await supabaseAdmin
        .from("registration_requests")
        .update({
          invitation_status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)

      // Suspend app_users profile (never delete!)
      if (regReq.employee_id) {
        await supabaseAdmin
          .from("app_users")
          .update({ status: "suspended" })
          .eq("employee_id", regReq.employee_id)
      }

      // Ban auth user so token cannot activate
      if (regReq.email) {
        const { data: uList } = await supabaseAdmin
          .from("app_users")
          .select("auth_user_id")
          .eq("email", regReq.email)
          .maybeSingle()

        if (uList?.auth_user_id) {
          await supabaseAdmin.auth.admin.updateUserById(uList.auth_user_id, {
            ban_duration: "876000h",
            app_metadata: { status: "suspended" },
          })
        }
      }

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `إلغاء دعوة تفعيل الموظف وتعليق الحساب: ${regReq.email}`,
        entity_type: "employee_approval",
        entity_id: regReq.employee_id || requestId,
        details: { requestId, email: regReq.email },
      })

      return new Response(JSON.stringify({
        success: true,
        message: "تم إلغاء الدعوة وتعليق صلاحية التفعيل بنجاح دون حذف السجلات.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: consistency_report ──────────────────────────────────────────
    if (action === "consistency_report") {
      if (!isSystemAdmin) {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: "محاولة غير مصرح بها لعرض تقرير مطابقة الهويات",
          eventType: "unauthorized_api_access",
          severity: "warning",
          entityId: "consistency_report",
          details: { action: "consistency_report" },
        })
        return new Response(JSON.stringify({ error: "تقرير مطابقة وتكامل الهويات مقتصر حصرياً على مدير النظام الرئيسي." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: reportData, error: reportErr } = await supabaseAdmin.rpc("get_identity_consistency_report")
      if (!reportErr && reportData) {
        return new Response(JSON.stringify({ success: true, report: reportData }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Fallback manual checks if RPC is not yet applied
      const { data: appUsersAll } = await supabaseAdmin.from("app_users").select("id, username, employee_id, email, status, auth_user_id")
      const { data: regReqsAll } = await supabaseAdmin.from("registration_requests").select("id, full_name, email, employee_id, approval_status, invitation_status, invitation_sent_at")

      const missingAuth = (appUsersAll || []).filter((u: any) => !u.auth_user_id).map((u: any) => ({
        app_user_id: u.id,
        username: u.username,
        employee_id: u.employee_id,
        email: u.email,
        status: u.status,
        reason: "auth_user_id_is_null",
      }))

      const approvedNoInvite = (regReqsAll || []).filter((r: any) => r.approval_status === "approved" && (!r.invitation_status || r.invitation_status === "pending" || !r.invitation_sent_at)).map((r: any) => ({
        request_id: r.id,
        full_name: r.full_name,
        email: r.email,
        employee_id: r.employee_id,
        approval_status: r.approval_status,
        invitation_status: r.invitation_status,
        reason: "approved_without_invitation_sent",
      }))

      const activeWithoutUser = (appUsersAll || []).filter((u: any) => u.status === "active" && (!u.username || u.username.startsWith("pending_") || u.username.startsWith("temp_"))).map((u: any) => ({
        app_user_id: u.id,
        username: u.username,
        employee_id: u.employee_id,
        status: u.status,
        reason: "active_with_placeholder_username",
      }))

      const emailCounts: Record<string, number> = {}
      for (const u of (appUsersAll || [])) {
        if (u.email) {
          const em = u.email.trim().toLowerCase()
          emailCounts[em] = (emailCounts[em] || 0) + 1
        }
      }
      const duplicateEmails = Object.entries(emailCounts).filter(([, count]) => count > 1).map(([email, count]) => ({
        email,
        count,
        reason: "duplicate_email_in_app_users",
      }))

      const manualReport = {
        generated_at: new Date().toISOString(),
        has_issues: missingAuth.length > 0 || approvedNoInvite.length > 0 || activeWithoutUser.length > 0 || duplicateEmails.length > 0,
        missing_auth_users: missingAuth,
        missing_app_users: [],
        approved_without_invitation: approvedNoInvite,
        active_without_username: activeWithoutUser,
        duplicate_emails: duplicateEmails,
      }

      return new Response(JSON.stringify({ success: true, report: manualReport }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: reject_registration_request ─────────────────────────────────
    if (action === "reject_registration_request") {
      const { requestId, rejectionReason } = body
      if (!requestId) {
        return new Response(JSON.stringify({ error: "معرّف طلب التسجيل مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: regReq } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle()

      if (!regReq) {
        return new Response(JSON.stringify({ error: "طلب التسجيل غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Department admin specific safeguards
      if (!isSystemAdmin) {
        const targetDept = regReq.requested_department || ""
        const { data: sett } = await supabaseAdmin
          .from("registration_approval_settings")
          .select("delegation_enabled")
          .in("department", [targetDept, targetDept === "warehouse" ? "المخازن" : targetDept === "procurement" ? "المشتريات" : targetDept])
          .maybeSingle()
        if (!sett?.delegation_enabled) {
          return new Response(JSON.stringify({
            error: "تفويض الأقسام معطل حالياً. يتطلب مراجعة مدير النظام الرئيسي.",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        const callerDept = caller.app_metadata?.department
        if (!callerDept || callerDept !== regReq.requested_department) {
          return new Response(JSON.stringify({
            error: "غير مصرح لك برفض طلبات خارج قسمك.",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      await supabaseAdmin
        .from("registration_requests")
        .update({
          approval_status: "rejected",
          rejection_reason: rejectionReason || "لم يتم تحديد سبب",
          reviewed_by: caller.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `رفض طلب تسجيل الموظف: ${regReq.email}`,
        entity_type: "employee_approval",
        entity_id: requestId,
        details: { requestId, rejectionReason },
      })

      // Notify Telegram user if botToken configured
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")
      if (botToken && regReq.telegram_user_id) {
        const notifyUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
        try {
          await fetch(notifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: regReq.telegram_user_id,
              text: `تمت مراجعة طلب التسجيل ولم تتم الموافقة عليه.\nالسبب: ${rejectionReason || "لم يتم تحديد سبب"}`,
            }),
          })
        } catch {
          // ignore notification failure
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "تم رفض طلب التسجيل بنجاح.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: set_user_status ─────────────────────────────────────────────
    if (action === "set_user_status") {
      const userId = String(body.userId || "").trim()
      const status = String(body.status || "").trim()
      if (!userId || !status) {
        return new Response(JSON.stringify({ error: "معرّف المستخدم والحالة الجديدة مطلوبان." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const validStatuses = ["active", "suspended", "pending_activation"]
      if (!validStatuses.includes(status)) {
        return new Response(JSON.stringify({ error: "الحالة المحددة غير صالحة." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Resolve both app_users row and auth.users record before evaluating protections
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
      let appUserRow: Record<string, any> | null = null
      const { data: byAppId } = await supabaseAdmin
        .from("app_users")
        .select("id, auth_user_id, username, email, role, status")
        .eq("id", userId)
        .maybeSingle()
      appUserRow = byAppId
      if (!appUserRow && isUuid) {
        const { data: byAuthId } = await supabaseAdmin
          .from("app_users")
          .select("id, auth_user_id, username, email, role, status")
          .eq("auth_user_id", userId)
          .maybeSingle()
        appUserRow = byAuthId
      }

      const resolvedAuthId = (appUserRow?.auth_user_id as string | undefined) || (isUuid ? userId : "")
      const targetUser = resolvedAuthId
        ? (await supabaseAdmin.auth.admin.getUserById(resolvedAuthId)).data
        : null

      const targetUsername =
        appUserRow?.username ||
        (targetUser?.user?.app_metadata?.username as string) ||
        targetUser?.user?.email?.replace(/@warehouse\.local$/, "") ||
        ""
      const targetEmail = appUserRow?.email || targetUser?.user?.email || ""
      const isTargetSysAdmin =
        appUserRow?.role === "system_admin" ||
        targetUser?.user?.app_metadata?.role === "system_admin" ||
        targetUser?.user?.app_metadata?.system_admin === true
      const isTargetProtected =
        isTargetSysAdmin ||
        isProtectedUsername(targetUsername) ||
        isProtectedUsername(targetEmail)

      if (isTargetProtected && status !== "active") {
        await logAdminSecurityEvent(supabaseAdmin, req, {
          caller,
          action: `محاولة غير مصرح بها لتعطيل أو تعليق حساب مدير النظام الرئيسي (${targetUsername || userId})`,
          eventType: "unauthorized_api_access",
          severity: "critical",
          entityId: userId,
          details: { action: "set_user_status", targetUsername, status },
        })
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن تعليق أو تعطيل حساب مدير النظام الرئيسي.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const previousStatus = appUserRow?.status || targetUser?.user?.app_metadata?.status || "unknown"
      if (targetUser?.user && resolvedAuthId) {
        // Enforce Auth ban_duration when suspended, and clear ban when active
        const banDuration = status === "suspended" ? "876000h" : "none"
        await supabaseAdmin.auth.admin.updateUserById(resolvedAuthId, {
          ban_duration: banDuration,
          app_metadata: {
            ...targetUser.user.app_metadata,
            status,
          },
        })
      }

      // Mirror to app_users without .or() string interpolation
      if (appUserRow?.id) {
        await supabaseAdmin.from("app_users").update({ status }).eq("id", appUserRow.id)
      } else if (isUuid) {
        await supabaseAdmin.from("app_users").update({ status }).eq("auth_user_id", userId)
      } else {
        await supabaseAdmin.from("app_users").update({ status }).eq("id", userId)
      }

      const isSelfStatusChange = caller.id === resolvedAuthId || caller.id === userId
      await logAdminSecurityEvent(supabaseAdmin, req, {
        caller,
        action: `تعديل حالة حساب المستخدم إلى (${status}): ${targetUsername || userId}`,
        eventType: isSelfStatusChange ? "self_role_permission_change" : "role_permission_change",
        severity: "critical",
        entityType: "user_management",
        entityId: userId,
        tableName: "app_users",
        oldData: { status: previousStatus },
        newData: { status },
        details: { target_id: userId, target_username: targetUsername, previousStatus, status, is_self_change: isSelfStatusChange },
      })

      return new Response(JSON.stringify({
        success: true,
        message: `تم تحديث حالة الحساب إلى ${status === "suspended" ? "معلّق" : status === "pending_activation" ? "بانتظار التفعيل" : "نشط"} بنجاح.`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }



    return new Response(JSON.stringify({ error: "إجراء غير معروف." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    console.error("admin-users internal error:", err instanceof Error ? err.message : String(err))
    return new Response(JSON.stringify({ error: "حدث خطأ غير متوقع أثناء معالجة الطلب." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
