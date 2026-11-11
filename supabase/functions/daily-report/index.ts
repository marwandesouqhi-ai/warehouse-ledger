import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function isAuthorizedCronOrServiceCaller(req: Request, serviceRoleKey: string, cronSecret: string): boolean {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || ""
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
  const providedSecret = (req.headers.get("x-cron-secret") || "").trim()

  if (serviceRoleKey && bearer && timingSafeEqual(bearer, serviceRoleKey)) {
    return true
  }
  if (cronSecret && providedSecret && timingSafeEqual(providedSecret, cronSecret)) {
    return true
  }
  if (cronSecret && bearer && timingSafeEqual(bearer, cronSecret)) {
    return true
  }
  return false
}

function escapeTelegramHtml(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function formatCairoDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d)
  } catch {
    return isoString
  }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  // Telegram max length per message is 4096 characters.
  const MAX_CHUNK = 3800
  const chunks: string[] = []

  if (text.length <= MAX_CHUNK) {
    chunks.push(text)
  } else {
    let current = ""
    const lines = text.split("\n")
    for (const line of lines) {
      if (line.length > MAX_CHUNK) {
        if (current) {
          chunks.push(current)
          current = ""
        }
        for (let i = 0; i < line.length; i += MAX_CHUNK) {
          chunks.push(line.slice(i, i + MAX_CHUNK))
        }
        continue
      }
      if ((current + "\n" + line).length > MAX_CHUNK) {
        if (current) chunks.push(current)
        current = line
      } else {
        current = current ? (current + "\n" + line) : line
      }
    }
    if (current) chunks.push(current)
  }

  let allSuccess = true
  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "HTML",
          protect_content: true,
          link_preview_options: { is_disabled: true },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        console.error("Telegram API Error:", data?.description || res.statusText)
        allSuccess = false
      }
    } catch (err) {
      console.error("Failed to send telegram chunk:", err)
      allSuccess = false
    }
  }

  return allSuccess
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const cronSecret = Deno.env.get("CRON_WEBHOOK_SECRET")?.trim() ?? ""
    const botToken =
      Deno.env.get("TELEGRAM_MONITOR_BOT_TOKEN")?.trim() ||
      Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ||
      ""
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? ""

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Supabase environment not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!isAuthorizedCronOrServiceCaller(req, supabaseServiceKey, cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized: valid service role key or x-cron-secret required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!botToken || !chatId) {
      return new Response(JSON.stringify({
        error: "TELEGRAM_MONITOR_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) and/or TELEGRAM_CHAT_ID secrets are not set in Edge Function environment.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Check if security reporting is enabled in config
    const { data: configRow } = await supabaseAdmin
      .from("security_monitor_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle()

    if (configRow && (configRow.telegram_notifications_enabled === false || configRow.daily_report_enabled === false)) {
      return new Response(JSON.stringify({ message: "Daily security report is disabled in security_monitor_config." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 1. Fetch audit logs for the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: logs, error: logsErr } = await supabaseAdmin
      .from("audit_logs")
      .select("id, created_at, actor_id, actor_role, event_type, table_name, record_id, severity, user_id, user_email, action, entity_type, ip, details")
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: true })

    if (logsErr) {
      throw logsErr
    }

    const allLogs = logs || []

    // 2. Aggregate metrics
    let totalLogins = 0
    let failedLogins = 0
    let totalCreates = 0
    let totalUpdates = 0
    let totalDeletes = 0
    let roleChangesCount = 0
    let unauthorizedAttempts = 0
    const criticalEvents: any[] = []
    const userActivityMap = new Map<string, number>()

    for (const log of allLogs) {
      const ev = (log.event_type || log.action || "").toLowerCase()
      const sev = (log.severity || "info").toLowerCase()
      const userKey = log.user_email || log.user_id || (log.actor_id ? `usr-${log.actor_id.slice(0, 8)}` : "غير معروف")

      // Track active users
      userActivityMap.set(userKey, (userActivityMap.get(userKey) || 0) + 1)

      // Logins
      if (ev.includes("login_success") || ev === "login" || ev.includes("تسجيل دخول")) {
        totalLogins++
      }
      if (ev.includes("failed_login") || ev.includes("login_failure") || ev.includes("brute_force") || ev.includes("دخول فاشل")) {
        failedLogins++
      }

      // DML
      if (ev.startsWith("insert_") || ev.includes("إضافة") || ev === "create") {
        totalCreates++
      }
      if (ev.startsWith("update_") || ev.includes("تعديل") || ev === "update") {
        totalUpdates++
      }
      if (ev.startsWith("delete_") || ev.includes("حذف") || ev === "delete" || ev.includes("mass_delete")) {
        totalDeletes++
      }

      // Role changes
      if (ev.includes("role_permission") || ev.includes("delegation_setting") || ev.includes("صلاحيات") || ev.includes("دور")) {
        roleChangesCount++
      }

      // Unauthorized attempts & cross user
      if (ev.includes("unauthorized") || ev.includes("cross_user") || ev.includes("غير مصرح") || ev.includes("مرفوض")) {
        unauthorizedAttempts++
      }

      // Critical events
      if (sev === "critical") {
        criticalEvents.push(log)
      }
    }

    // Top 5 active users
    const topUsers = Array.from(userActivityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    // 3. Format Telegram Message in Clean HTML
    const reportDateStr = formatCairoDate(new Date().toISOString())
    const criticalBadge = criticalEvents.length > 0
      ? `🚨 <b>أحداث حرجة:</b> ${criticalEvents.length}`
      : "✅ <b>لا توجد أحداث حرجة</b>"

    let message = `📊 <b>التقرير الأمني والرقابي اليومي</b>\n`
    message += `🏛️ <b>جامعة الزقازيق الأهلية - منظومة المخازن والمشتريات</b>\n`
    message += `🗓️ <i>توقيت التقرير: ${escapeTelegramHtml(reportDateStr)} (آخر 24 ساعة)</i>\n\n`

    message += `📈 <b>ملخص المؤشرات العامة:</b>\n`
    message += `• تسجيلات الدخول الناجحة: <b>${totalLogins}</b>\n`
    message += `• محاولات الدخول الفاشلة: <b>${failedLogins}</b> ${failedLogins > 0 ? "⚠️" : ""}\n`
    message += `• عمليات الإضافة والتوريد: <b>${totalCreates}</b>\n`
    message += `• عمليات التعديل: <b>${totalUpdates}</b>\n`
    message += `• عمليات الحذف: <b>${totalDeletes}</b> ${totalDeletes > 5 ? "⚠️" : ""}\n`
    message += `• تعديل الأدوار والصلاحيات: <b>${roleChangesCount}</b> ${roleChangesCount > 0 ? "🔒" : ""}\n`
    message += `• محاولات الوصول غير المصرح: <b>${unauthorizedAttempts}</b> ${unauthorizedAttempts > 0 ? "🛑" : ""}\n`
    message += `• إجمالي العمليات المسجلة: <b>${allLogs.length}</b>\n\n`

    message += `👥 <b>أكثر المستخدمين نشاطاً:</b>\n`
    if (topUsers.length === 0) {
      message += `• <i>لا توجد أنشطة مسجلة خلال الفترة</i>\n`
    } else {
      topUsers.forEach(([u, count], idx) => {
        message += `${idx + 1}. <code>${escapeTelegramHtml(u)}</code> — <b>${count}</b> عملية\n`
      })
    }
    message += `\n`

    message += `🛡️ <b>الحالة الأمنية العامة:</b> ${criticalBadge}\n`
    if (criticalEvents.length > 0) {
      message += `\n<b>قائمة الأحداث الأمنية الحرجة (${criticalEvents.length}):</b>\n`
      criticalEvents.forEach((crit, idx) => {
        const timeStr = formatCairoDate(crit.created_at)
        const actor = crit.user_email || crit.user_id || "غير محدد"
        const desc = crit.action || crit.event_type || "حدث أمني غير مسمى"
        const tbl = crit.table_name || crit.entity_type || ""
        message += `\n${idx + 1}. <b>${escapeTelegramHtml(desc)}</b>\n`
        message += `   ⏱️ <i>${escapeTelegramHtml(timeStr)}</i>\n`
        message += `   👤 المنفذ: <code>${escapeTelegramHtml(actor)}</code> (${escapeTelegramHtml(crit.actor_role || "anon")})\n`
        if (tbl) message += `   📂 الجدول: <code>${escapeTelegramHtml(tbl)}</code>\n`
        if (crit.ip) message += `   🌐 عنوان IP: <code>${escapeTelegramHtml(crit.ip)}</code>\n`
      })
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━\n`
    message += `🤖 <i>نظام الرقابة والأمان التلقائي — ZNU Warehouse Security Monitor</i>`

    // 4. Send message to Telegram
    const sent = await sendTelegramMessage(botToken, chatId, message)

    return new Response(JSON.stringify({
      success: sent,
      period: "last_24_hours",
      totalLogs: allLogs.length,
      criticalEventsCount: criticalEvents.length,
      metrics: {
        totalLogins,
        failedLogins,
        totalCreates,
        totalUpdates,
        totalDeletes,
        roleChangesCount,
        unauthorizedAttempts,
      },
    }), {
      status: sent ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("daily-report Edge Function error:", err)
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

