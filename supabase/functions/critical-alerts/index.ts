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

async function sendTelegramAlert(botToken: string, chatId: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const MAX_CHUNK = 3800
  const chunks: string[] = []
  if (text.length <= MAX_CHUNK) {
    chunks.push(text)
  } else {
    let current = ""
    for (const line of text.split("\n")) {
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

  let firstMessageId: string | undefined
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
        return { success: false, error: data?.description || res.statusText }
      }
      if (!firstMessageId && data.result?.message_id) {
        firstMessageId = String(data.result.message_id)
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  return { success: true, messageId: firstMessageId }
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

    // Check if critical alerts are enabled in config
    const { data: configRow } = await supabaseAdmin
      .from("security_monitor_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle()

    if (configRow && (configRow.telegram_notifications_enabled === false || configRow.critical_alerts_enabled === false)) {
      return new Response(JSON.stringify({ message: "Critical alerts are disabled in security_monitor_config." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 1. Fetch undelivered critical audit logs
    // Look back at most 7 days to keep query lightweight
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // Fetch existing delivery IDs
    const { data: deliveries } = await supabaseAdmin
      .from("audit_alert_deliveries")
      .select("audit_log_id")

    const deliveredIds = new Set((deliveries || []).map((d: any) => d.audit_log_id))

    // Fetch critical audit logs
    const { data: criticalLogs, error: critErr } = await supabaseAdmin
      .from("audit_logs")
      .select("id, created_at, actor_id, actor_role, event_type, table_name, record_id, old_data, new_data, ip, user_agent, severity, user_id, user_email, action, entity_type, details")
      .eq("severity", "critical")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: true })
      .limit(50)

    if (critErr) {
      throw critErr
    }

    const pendingAlerts = (criticalLogs || []).filter((log: any) => !deliveredIds.has(log.id))

    if (pendingAlerts.length === 0) {
      return new Response(JSON.stringify({ success: true, newAlertsCount: 0, message: "No new critical events to dispatch." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let sentCount = 0
    let failedCount = 0

    // 2. Dispatch an instant alert for each critical event and record delivery
    for (const log of pendingAlerts) {
      const timeStr = formatCairoDate(log.created_at)
      const actor = log.user_email || log.user_id || (log.actor_id ? `usr-${log.actor_id.slice(0, 8)}` : "غير معروف")
      const actionText = log.action || log.event_type || "حدث أمني حرج"
      const tbl = log.table_name || log.entity_type || ""
      const recId = log.record_id || ""

      let text = `🚨 <b>تنبيه أمني فوري: رصد حدث حرج (Security Alert)</b>\n`
      text += `🏛️ <b>جامعة الزقازيق الأهلية - منظومة المخازن والمشتريات</b>\n`
      text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`
      text += `⚠️ <b>نوع الحدث:</b> ${escapeTelegramHtml(actionText)}\n`
      text += `⏱️ <b>التوقيت:</b> <code>${escapeTelegramHtml(timeStr)}</code>\n`
      text += `👤 <b>المستخدم:</b> <code>${escapeTelegramHtml(actor)}</code>\n`
      text += `🔑 <b>الدور الوظيفي:</b> <code>${escapeTelegramHtml(log.actor_role || "anon")}</code>\n`

      if (tbl) {
        text += `📂 <b>الجدول المتأثر:</b> <code>${escapeTelegramHtml(tbl)}</code>\n`
      }
      if (recId) {
        text += `🆔 <b>معرّف السجل:</b> <code>${escapeTelegramHtml(recId)}</code>\n`
      }
      if (log.ip) {
        text += `🌐 <b>عنوان IP:</b> <code>${escapeTelegramHtml(log.ip)}</code>\n`
      }

      // Add diff / details snippet if relevant
      const details = log.details || {}
      if (details.is_self_change) {
        text += `\n🔴 <b>ملاحظة فائقة الخطورة:</b> قام المستخدم بتعديل صلاحيات أو دور حسابه الشخصي!\n`
      }
      if (details.alert) {
        text += `ℹ️ <b>التشخيص:</b> ${escapeTelegramHtml(details.alert)}\n`
      }
      if (details.recent_deletes_count) {
        text += `🗑️ <b>عدد السجلات المحذوفة:</b> ${escapeTelegramHtml(details.recent_deletes_count)} في ${escapeTelegramHtml(details.window_minutes)} دقائق\n`
      }
      if (details.old_role && details.new_role) {
        text += `🔄 <b>تغير الدور:</b> ${escapeTelegramHtml(details.old_role)} ➔ ${escapeTelegramHtml(details.new_role)}\n`
      }

      text += `\n🔍 <i>يُرجى مراجعة سجل العمليات والتدقيق في لوحة الإدارة فوراً.</i>`

      const sendRes = await sendTelegramAlert(botToken, chatId, text)

      if (sendRes.success) {
        sentCount++
        // Record delivery to guarantee no duplicate alerts
        await supabaseAdmin.from("audit_alert_deliveries").insert({
          audit_log_id: log.id,
          delivered_at: new Date().toISOString(),
          status: "delivered",
          telegram_message_id: sendRes.messageId || null,
        })
      } else {
        failedCount++
        console.error(`Failed to send alert for audit_log ${log.id}:`, sendRes.error)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: pendingAlerts.length,
      sentCount,
      failedCount,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error("critical-alerts Edge Function error:", err)
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

