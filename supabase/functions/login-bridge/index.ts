import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const GENERIC_LOGIN_ERROR = "تعذر تسجيل الدخول. تحقق من بيانات الدخول أو تواصل مع الإدارة."

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

const EMPLOYEE_ID_REGEX = /^[A-Z]{2,3}-[A-Z]{3}-\d{6}$/
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,50}$/
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

interface SecurityMonitorConfig {
  failed_login_threshold: number
  failed_login_window_minutes: number
  unusual_hours_start: number
  unusual_hours_end: number
  timezone: string
}

const DEFAULT_SECURITY_CONFIG: SecurityMonitorConfig = {
  failed_login_threshold: 5,
  failed_login_window_minutes: 10,
  unusual_hours_start: 22,
  unusual_hours_end: 7,
  timezone: "Africa/Cairo",
}

function extractClientIp(req: Request): string {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp
  const realIp = req.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded
  return "unknown-ip"
}

function getLocalHour(timezone: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "Africa/Cairo",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now)
    const hourStr = parts.find((p) => p.type === "hour")?.value
    const parsed = Number(hourStr)
    if (!Number.isNaN(parsed)) return parsed === 24 ? 0 : parsed
  } catch {
    // Fallback to Cairo UTC+2 if timezone string is invalid
  }
  return (now.getUTCHours() + 2) % 24
}

function isWithinUnusualHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end)
}

async function loadSecurityConfig(supabaseAdmin: any): Promise<SecurityMonitorConfig> {
  try {
    const { data } = await supabaseAdmin
      .from("security_monitor_config")
      .select("failed_login_threshold, failed_login_window_minutes, unusual_hours_start, unusual_hours_end, timezone")
      .eq("id", "default")
      .maybeSingle()
    if (!data) return DEFAULT_SECURITY_CONFIG
    return {
      failed_login_threshold: Number(data.failed_login_threshold) || 5,
      failed_login_window_minutes: Number(data.failed_login_window_minutes) || 10,
      unusual_hours_start: data.unusual_hours_start ?? 22,
      unusual_hours_end: data.unusual_hours_end ?? 7,
      timezone: data.timezone || "Africa/Cairo",
    }
  } catch {
    return DEFAULT_SECURITY_CONFIG
  }
}

async function recordFailedLoginAttempt(params: {
  supabaseAdmin: any
  identifier: string
  clientIp: string
  userAgent: string
  reason: string
  targetActorId?: string | null
  targetRole?: string | null
  targetEmail?: string | null
  config: SecurityMonitorConfig
  insertAttempt?: boolean
}): Promise<void> {
  const {
    supabaseAdmin,
    identifier,
    clientIp,
    userAgent,
    reason,
    targetActorId,
    targetRole,
    targetEmail,
    config,
    insertAttempt = true,
  } = params

  try {
    if (insertAttempt) {
      await supabaseAdmin.from("login_attempts").insert({
        username: identifier,
        ip_address: clientIp,
        success: false,
      })
    }

    const windowStartIso = new Date(
      Date.now() - config.failed_login_window_minutes * 60 * 1000
    ).toISOString()

    let userFailures = 0
    try {
      const { count } = await supabaseAdmin
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("username", identifier)
        .eq("success", false)
        .gte("attempted_at", windowStartIso)
      userFailures = count ?? 0
    } catch {
      userFailures = 0
    }

    let ipFailures = 0
    if (clientIp && clientIp !== "unknown-ip") {
      try {
        const { count } = await supabaseAdmin
          .from("login_attempts")
          .select("id", { count: "exact", head: true })
          .eq("ip_address", clientIp)
          .eq("success", false)
          .gte("attempted_at", windowStartIso)
        ipFailures = count ?? 0
      } catch {
        ipFailures = 0
      }
    }

    const isBruteForce =
      userFailures >= config.failed_login_threshold ||
      ipFailures >= config.failed_login_threshold

    await supabaseAdmin.from("audit_logs").insert({
      user_id: targetActorId || null,
      actor_id: targetActorId || null,
      actor_role: targetRole || "anon",
      user_email: targetEmail || identifier,
      action: isBruteForce
        ? `🚨 إنذار أمني حرج: تجاوز حد محاولات الدخول الفاشلة (${Math.max(userFailures, ipFailures)} خلال ${config.failed_login_window_minutes} دقائق)`
        : "محاولة تسجيل دخول فاشلة",
      event_type: isBruteForce ? "brute_force_failed_logins" : "failed_login",
      entity_type: "auth",
      entity_id: targetActorId || identifier,
      table_name: "auth",
      record_id: targetActorId || identifier,
      ip: clientIp,
      ip_address: clientIp,
      user_agent: userAgent,
      severity: isBruteForce ? "critical" : "warning",
      details: {
        identifier,
        reason,
        user_failures_in_window: userFailures,
        ip_failures_in_window: ipFailures,
        window_minutes: config.failed_login_window_minutes,
        threshold: config.failed_login_threshold,
      },
    })
  } catch {
    // Telemetry must not crash auth flow
  }
}

async function recordSuccessfulLogin(params: {
  supabaseAdmin: any
  username: string
  authUserId: string
  role: string
  email: string
  clientIp: string
  userAgent: string
  config: SecurityMonitorConfig
}): Promise<void> {
  const {
    supabaseAdmin,
    username,
    authUserId,
    role,
    email,
    clientIp,
    userAgent,
    config,
  } = params

  try {
    await supabaseAdmin.from("login_attempts").insert({
      username,
      ip_address: clientIp,
      success: true,
    })

    // Check prior successful IPs for this user
    let isNewIp = false
    if (clientIp && clientIp !== "unknown-ip") {
      try {
        const { data: priorLogins } = await supabaseAdmin
          .from("login_attempts")
          .select("ip_address")
          .eq("username", username)
          .eq("success", true)
          .neq("ip_address", "unknown-ip")
          .order("attempted_at", { ascending: false })
          .limit(25)

        if (Array.isArray(priorLogins) && priorLogins.length > 1) {
          // Exclude the row we just inserted (or inspect historical set)
          const historicalIps = priorLogins.slice(1).map((r: any) => r.ip_address).filter(Boolean)
          if (historicalIps.length > 0 && !historicalIps.includes(clientIp)) {
            isNewIp = true
          }
        }
      } catch {
        isNewIp = false
      }
    }

    const localHour = getLocalHour(config.timezone)
    const isUnusualHour = isWithinUnusualHours(
      localHour,
      config.unusual_hours_start,
      config.unusual_hours_end
    )

    let severity: "info" | "warning" = "info"
    let eventType = "login_success"
    let action = "تسجيل دخول ناجح إلى النظام"

    if (isNewIp && isUnusualHour) {
      severity = "warning"
      eventType = "login_new_ip_unusual_hour"
      action = `⚠️ تسجيل دخول من عنوان IP جديد (${clientIp}) وفي توقيت غير معتاد (${localHour}:00)`
    } else if (isNewIp) {
      severity = "warning"
      eventType = "login_new_ip"
      action = `⚠️ تسجيل دخول من عنوان IP جديد (${clientIp})`
    } else if (isUnusualHour) {
      severity = "warning"
      eventType = "login_unusual_hour"
      action = `⚠️ تسجيل دخول في توقيت غير معتاد (${localHour}:00 بتوقيت ${config.timezone})`
    }

    await supabaseAdmin.from("audit_logs").insert({
      user_id: authUserId,
      actor_id: authUserId,
      actor_role: role || "authenticated",
      user_email: email || username,
      action,
      event_type: eventType,
      entity_type: "auth",
      entity_id: authUserId,
      table_name: "auth",
      record_id: authUserId,
      ip: clientIp,
      ip_address: clientIp,
      user_agent: userAgent,
      severity,
      details: {
        username,
        new_ip_detected: isNewIp,
        unusual_hour_detected: isUnusualHour,
        local_hour: localHour,
        timezone: config.timezone,
      },
    })
  } catch {
    // Non-blocking audit logging
  }
}

function isValidIdentifier(identifier: string): boolean {
  if (!identifier || identifier.length > 254) return false
  const upper = identifier.toUpperCase().trim()
  if (EMPLOYEE_ID_REGEX.test(upper)) return true
  if (EMAIL_REGEX.test(identifier.trim())) return true
  if (USERNAME_REGEX.test(identifier.trim())) return true
  return false
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    const body = await req.json().catch(() => ({}))
    const rawIdentifier = body.identifier || body.username
    const password = body.password

    // 1. Validate Identifier format with allowlist
    if (!rawIdentifier || typeof rawIdentifier !== "string" || !password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const cleanIdentifier = rawIdentifier.trim()
    if (!isValidIdentifier(cleanIdentifier)) {
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const normalizedIdentifier = normalizeUsername(cleanIdentifier)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const securityConfig = await loadSecurityConfig(supabaseAdmin)
    const userAgent = req.headers.get("user-agent") || ""

    // 2. Rate limiting check via login_attempts (Max 5 failed attempts in 15 mins)
    const clientIp = extractClientIp(req)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { count: failedCount } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("username", normalizedIdentifier)
      .eq("success", false)
      .gte("attempted_at", fifteenMinutesAgo)

    if (failedCount && failedCount >= 5) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "rate_limited_too_many_attempts",
        config: securityConfig,
        insertAttempt: false,
      })
      return new Response(JSON.stringify({
        error: "تم تجاوز الحد الأقصى للمحاولات الفاشلة. تم تعليق المحاولة مؤقتاً لمدة 15 دقيقة لحماية الحساب.",
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Parameterized server-side lookup in app_users (No PostgREST filter injection!)
    let appUser = null

    // A. Search by username
    const { data: userByUsername } = await supabaseAdmin
      .from("app_users")
      .select("id, username, role, status, auth_user_id, employee_id, email")
      .eq("username", normalizedIdentifier)
      .maybeSingle()

    if (userByUsername) {
      appUser = userByUsername
    }

    // B. If not found, search by employee_id if identifier matches employee code format
    if (!appUser && EMPLOYEE_ID_REGEX.test(cleanIdentifier.toUpperCase())) {
      const { data: usersByEmpId } = await supabaseAdmin
        .from("app_users")
        .select("id, username, role, status, auth_user_id, employee_id, email")
        .eq("employee_id", cleanIdentifier.toUpperCase())

      if (usersByEmpId && usersByEmpId.length > 0) {
        if (usersByEmpId.length === 1) {
          appUser = usersByEmpId[0]
        } else {
          // In case multiple users were assigned the same employee_id, verify password against candidates
          const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey)
          for (const candidate of usersByEmpId) {
            if (candidate.status !== "active") continue
            let candidateEmail = candidate.email
            if (!candidateEmail && candidate.auth_user_id) {
              const { data: authData } = await supabaseAdmin.auth.admin.getUserById(candidate.auth_user_id)
              candidateEmail = authData?.user?.email
            }
            if (candidateEmail) {
              const { data: signInData, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
                email: candidateEmail,
                password: password,
              })
              if (!signInError && signInData?.session) {
                // Successfully authenticated with one of the candidates!
                await recordSuccessfulLogin({
                  supabaseAdmin,
                  username: candidate.username || normalizedIdentifier,
                  authUserId: signInData.user?.id || candidate.auth_user_id || "",
                  role: candidate.role || "authenticated",
                  email: candidate.email || candidateEmail,
                  clientIp,
                  userAgent,
                  config: securityConfig,
                })
                await supabaseAdmin
                  .from("app_users")
                  .update({ last_login_at: new Date().toISOString() })
                  .eq("id", candidate.id)
                return new Response(JSON.stringify({
                  session: signInData.session,
                  user: candidate,
                }), {
                  status: 200,
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                })
              }
            }
          }
          // If none matched password, pick the first active candidate so standard auth flow handles the error
          appUser = usersByEmpId.find((u: any) => u.status === "active") || usersByEmpId[0]
        }
      }
    }

    // C. If not found, search by email if identifier matches email format
    if (!appUser && EMAIL_REGEX.test(cleanIdentifier.toLowerCase())) {
      const { data: userByEmail } = await supabaseAdmin
        .from("app_users")
        .select("id, username, role, status, auth_user_id, employee_id, email")
        .eq("email", cleanIdentifier.toLowerCase())
        .maybeSingle()

      if (userByEmail) {
        appUser = userByEmail
      }
    }

    // If account not found: record failed attempt and return generic message
    if (!appUser) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "account_not_found",
        config: securityConfig,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 4. Require account to be active (Strictly reject suspended, pending, or disabled)
    if (appUser.status !== "active") {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: `inactive_account_status:${appUser.status}`,
        targetActorId: appUser.auth_user_id || null,
        targetRole: appUser.role || "anon",
        targetEmail: appUser.email || appUser.username || normalizedIdentifier,
        config: securityConfig,
      })
      // Return identical generic error to prevent account state enumeration
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 5. Resolve Auth Identity strictly via getUserById using appUser.auth_user_id
    let authUser = null
    if (appUser.auth_user_id) {
      const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(appUser.auth_user_id)
      if (!authUserErr && authUserData?.user) {
        authUser = authUserData.user
      }
    }

    if (!authUser || !authUser.email) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "missing_auth_identity",
        targetActorId: appUser.auth_user_id || null,
        targetRole: appUser.role || "anon",
        targetEmail: appUser.email || appUser.username || normalizedIdentifier,
        config: securityConfig,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check if account is banned in Supabase Auth
    if (authUser.banned_until && new Date(authUser.banned_until).getTime() > Date.now()) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "banned_auth_user",
        targetActorId: authUser.id,
        targetRole: appUser.role || "anon",
        targetEmail: authUser.email,
        config: securityConfig,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Authenticate Password Through Supabase Auth Itself (using anon key client)
    const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey)
    const { data: signInData, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
      email: authUser.email,
      password: password,
    })

    if (signInError || !signInData?.session) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "invalid_credentials",
        targetActorId: authUser.id,
        targetRole: appUser.role || "anon",
        targetEmail: authUser.email,
        config: securityConfig,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 7. Verify returned user identity matches app_users linked identity
    if (signInData.user.id !== authUser.id) {
      await recordFailedLoginAttempt({
        supabaseAdmin,
        identifier: normalizedIdentifier,
        clientIp,
        userAgent,
        reason: "identity_mismatch",
        targetActorId: authUser.id,
        targetRole: appUser.role || "anon",
        targetEmail: authUser.email,
        config: securityConfig,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 8. Record successful login attempt & detect new IP / unusual hours
    await recordSuccessfulLogin({
      supabaseAdmin,
      username: appUser.username || normalizedIdentifier,
      authUserId: signInData.user.id,
      role: appUser.role || "authenticated",
      email: authUser.email,
      clientIp,
      userAgent,
      config: securityConfig,
    })

    // Update last_login_at in app_users
    await supabaseAdmin
      .from("app_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", appUser.id)

    // 9. Return official Supabase session to client (No sensitive profile/email leaked in unauthenticated response)
    return new Response(JSON.stringify({
      success: true,
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_in: signInData.session.expires_in,
        token_type: signInData.session.token_type,
        user: {
          id: signInData.user.id,
          aud: signInData.user.aud,
          email: signInData.user.email,
          user_metadata: signInData.user.user_metadata,
          app_metadata: signInData.user.app_metadata,
        },
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    // Generic response for unexpected server errors
    return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
