import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" }

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function isAuthorized(req: Request, serviceRoleKey: string, cronSecret: string): boolean {
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
  const provided = (req.headers.get("x-cron-secret") || "").trim()
  if (serviceRoleKey && bearer && timingSafeEqual(bearer, serviceRoleKey)) return true
  if (cronSecret && provided && timingSafeEqual(provided, cronSecret)) return true
  return false
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const cronSecret = Deno.env.get("CRON_WEBHOOK_SECRET")?.trim() ?? ""
  if (!isAuthorized(req, serviceKey, cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders })
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY")?.trim() ?? ""
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY")?.trim() ?? ""
  const vapidSubject = Deno.env.get("VAPID_SUBJECT")?.trim() || "https://warehouse-ledger-vert.vercel.app"
  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: "VAPID keys are not configured" }), { status: 500, headers: jsonHeaders })
  }

  let notificationId = ""
  try {
    const body = await req.json()
    notificationId = String(body?.notification_id ?? "")
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: jsonHeaders })
  }
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
    return new Response(JSON.stringify({ error: "notification_id required" }), { status: 400, headers: jsonHeaders })
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: notif } = await admin
    .from("app_notifications")
    .select("id, user_id, audience_roles, title, body, action_url, type")
    .eq("id", notificationId)
    .maybeSingle()
  if (!notif) return new Response(JSON.stringify({ error: "Notification not found" }), { status: 404, headers: jsonHeaders })

  // Recipients: the targeted user, or every active user whose role is in the audience (system_admin sees everything).
  let userIds: string[] = []
  if (notif.user_id) {
    userIds = [notif.user_id]
  } else {
    const roles = Array.from(new Set([...(notif.audience_roles ?? []), "system_admin"]))
    const { data: users } = await admin
      .from("app_users")
      .select("auth_user_id")
      .in("role", roles)
      .eq("status", "active")
      .not("auth_user_id", "is", null)
    userIds = (users ?? []).map((u: { auth_user_id: string }) => u.auth_user_id)
  }
  if (userIds.length === 0) return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: jsonHeaders })

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds)

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const payload = JSON.stringify({
    title: notif.title,
    body: notif.body,
    url: notif.action_url || "/notifications",
    tag: notif.id,
  })

  let sent = 0
  const expired: string[] = []
  await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) expired.push(s.id)
    }
  }))
  if (expired.length > 0) await admin.from("push_subscriptions").delete().in("id", expired)

  return new Response(JSON.stringify({ success: true, sent, removed: expired.length }), { headers: jsonHeaders })
})
