import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

function isProtectedAccount(usernameOrEmail: string | null | undefined): boolean {
  if (!usernameOrEmail) return false
  const clean = String(usernameOrEmail).trim().toLowerCase()
  const bootstrapEmail = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || "").trim().toLowerCase()
  const bootstrapUser = (Deno.env.get("BOOTSTRAP_ADMIN_USERNAME") || "").trim().toLowerCase()
  const protectedSet = new Set([
    "marwan-desouky",
    "marwan-desouky@warehouse.local",
    "marwandesouqhi@gmail.com",
    ...(bootstrapEmail ? [bootstrapEmail] : []),
    ...(bootstrapUser ? [bootstrapUser] : []),
  ])
  if (protectedSet.has(clean)) return true
  if (clean.endsWith("@warehouse.local")) {
    const prefix = clean.replace(/@warehouse\.local$/, "")
    if (protectedSet.has(prefix)) return true
  }
  return false
}

function getReqIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  const parts = xff.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length > 0) return parts[parts.length - 1]
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  )
}

async function logUnauthorizedInviteAttempt(
  supabaseUrl: string,
  supabaseServiceKey: string,
  req: Request,
  reason: string,
  caller?: { id?: string; email?: string; app_metadata?: Record<string, any> } | null
): Promise<void> {
  if (!supabaseUrl || !supabaseServiceKey || typeof fetch !== "function") return
  try {
    const reqIp = getReqIp(req)
    await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/audit_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: caller?.id || null,
        actor_id: caller?.id || null,
        actor_role: (caller?.app_metadata?.role as string) || "anon",
        user_email: caller?.email || "anonymous",
        action: `محاولة وصول غير مصرح إلى وظيفة invite-user (${reason})`,
        event_type: "unauthorized_api_access",
        entity_type: "edge_function",
        entity_id: "invite-user",
        table_name: "edge_function:invite-user",
        ip: reqIp,
        ip_address: reqIp,
        user_agent: req.headers.get("user-agent") || "",
        severity: "warning",
        details: { function: "invite-user", reason },
      }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(1500) : undefined,
    }).catch(() => undefined)
  } catch {
    // non-blocking
  }
}

const RL_WINDOW_MS = 60_000
const RL_MAX = 30
const rlHits = new Map<string, number[]>()

function isRateLimited(req: Request): boolean {
  const key = (req.headers.get("x-forwarded-for") || req.headers.get("authorization") || "anon").slice(0, 200)
  const now = Date.now()
  const hits = (rlHits.get(key) || []).filter((t) => now - t < RL_WINDOW_MS)
  const limited = hits.length >= RL_MAX
  if (!limited) hits.push(now)
  rlHits.set(key, hits)
  if (rlHits.size > 5000) rlHits.clear()
  return limited
}
serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (isRateLimited(req)) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    const body = await req.json().catch(() => ({}))

    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      await logUnauthorizedInviteAttempt(supabaseUrl, supabaseServiceKey, req, "missing_auth_header")
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Verify caller identity with caller's JWT
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser()
    if (userError || !user) {
      await logUnauthorizedInviteAttempt(supabaseUrl, supabaseServiceKey, req, "invalid_jwt")
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Strictly verify System Admin permissions (protected in app_metadata only)
    const isCallerAdmin =
      user.app_metadata?.system_admin === true ||
      user.app_metadata?.role === "system_admin"

    if (!isCallerAdmin) {
      await logUnauthorizedInviteAttempt(supabaseUrl, supabaseServiceKey, req, "forbidden_non_system_admin", user)
      return new Response(JSON.stringify({
        error: "غير مصرح لك: فقط مدير النظام (System Admin) يملك صلاحية دعوة المستخدمين وإدارة الحسابات",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const rawForwarded = req.headers.get("x-forwarded-for") || ""
    const xffParts = rawForwarded.split(",").map((p) => p.trim()).filter(Boolean)
    const ip = (xffParts.length > 0 ? xffParts[xffParts.length - 1] : "") || req.headers.get("x-real-ip")?.trim() || req.headers.get("cf-connecting-ip") || "unknown"
    const userAgent = req.headers.get("user-agent") || ""

    const allowedOrigins = getAllowedOrigins()
    const rawOrigin = (req.headers.get("origin") || "").trim().replace(/\/+$/, "")
    const siteUrl = rawOrigin && allowedOrigins.includes(rawOrigin) ? rawOrigin : allowedOrigins[0]

    const action = body.action || "invite"

    // 1. Action: List all registered system users (for admin management)
    if (action === "list-users") {
      const page = Math.max(1, Number(body.page) || 1)
      const perPage = Math.min(100, Math.max(1, Number(body.perPage) || 50))
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
      if (listError) throw listError
      const users = (listData?.users || []).map((u: any) => ({
        id: u.id,
        email: u.email ?? "",
        role: u.app_metadata?.role || "viewer",
        system_admin: u.app_metadata?.system_admin === true || u.app_metadata?.role === "system_admin",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }))
      return new Response(JSON.stringify({ success: true, users }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Action: Admin resets/changes password for a user who forgot their password
    if (action === "reset-password") {
      const { email, newPassword } = body
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "البريد الإلكتروني غير صالح" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const trimmedEmail = email.trim().toLowerCase()
      const { data: dbUser } = await supabaseAdmin
        .from("app_users")
        .select("auth_user_id, username, email, role")
        .ilike("email", trimmedEmail)
        .maybeSingle()

      const targetUserId = dbUser?.auth_user_id
      if (!targetUserId) {
        return new Response(JSON.stringify({
          error: "لم يتم العثور على مستخدم مسجل بهذا البريد الإلكتروني.",
        }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: targetAuthData } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
      const targetAuthUser = targetAuthData?.user
      const isProtectedTarget =
        dbUser?.role === "system_admin" ||
        targetAuthUser?.app_metadata?.role === "system_admin" ||
        targetAuthUser?.app_metadata?.system_admin === true ||
        isProtectedAccount(trimmedEmail) ||
        isProtectedAccount(dbUser?.username) ||
        isProtectedAccount(targetAuthUser?.email)

      if (isProtectedTarget && targetUserId !== user.id) {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن إعادة تعيين كلمة مرور حساب مدير النظام الرئيسي من هذا المسار.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (newPassword) {
        if (typeof newPassword !== "string" || newPassword.length < 10) {
          return new Response(JSON.stringify({ error: "كلمة المرور يجب أن لا تقل عن 10 أحرف لضمان أمان الحساب." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUserId,
          { password: newPassword }
        )
        if (updateError) throw updateError
      }

      try {
        await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: trimmedEmail,
          options: {
            redirectTo: siteUrl ? `${siteUrl}/#type=recovery` : undefined,
          },
        })
      } catch (err) {
        console.warn("generate recovery link warning:", err)
      }

      // Record in audit_logs
      await supabaseAdmin.from("audit_logs").insert({
        user_id: user.id,
        user_email: user.email,
        action: `إعادة تعيين كلمة مرور للمستخدم: ${trimmedEmail}`,
        entity_type: "user_management",
        entity_id: targetUserId,
        details: {
          target_email: trimmedEmail,
          password_updated_directly: Boolean(newPassword),
        },
        ip_address: ip,
        user_agent: userAgent,
      })

      return new Response(JSON.stringify({
        success: true,
        message: newPassword
          ? `تم تحديث وحفظ كلمة المرور بنجاح للمستخدم (${trimmedEmail})`
          : `تم إرسال رابط إعادة التعيين بنجاح للمستخدم (${trimmedEmail})`,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Action: Invite new user (deprecated legacy path restricted)
    return new Response(JSON.stringify({
      error: "تم إيقاف مسار الدعوات القديم بالأدوار الملغاة (viewer/editor/admin). يُرجى توجيه الموظف للتقديم عبر بوت تيليجرام واعتماد طلبه من صفحة إدارة المستخدمين لإصدار الرقم الوظيفي ودعوة التفعيل الرسمية.",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    console.error("invite-user error:", err instanceof Error ? err.message : String(err))
    return new Response(JSON.stringify({ error: "حدث خطأ غير متوقع أثناء معالجة الطلب." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
