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

function isValidIdentifier(identifier: string): boolean {
  if (!identifier || identifier.length > 254) return false
  const upper = identifier.toUpperCase().trim()
  if (EMPLOYEE_ID_REGEX.test(upper)) return true
  if (EMAIL_REGEX.test(identifier.trim())) return true
  if (USERNAME_REGEX.test(identifier.trim())) return true
  return false
}

serve(async (req) => {
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

    // 2. Rate limiting check via login_attempts (Max 5 failed attempts in 15 mins)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip"
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { count: failedCount } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("username", normalizedIdentifier)
      .eq("success", false)
      .gte("attempted_at", fifteenMinutesAgo)

    if (failedCount && failedCount >= 5) {
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
      const { data: userByEmpId } = await supabaseAdmin
        .from("app_users")
        .select("id, username, role, status, auth_user_id, employee_id, email")
        .eq("employee_id", cleanIdentifier.toUpperCase())
        .maybeSingle()

      if (userByEmpId) {
        appUser = userByEmpId
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
      await supabaseAdmin.from("login_attempts").insert({
        username: normalizedIdentifier,
        ip_address: clientIp,
        success: false,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 4. Require account to be active (Strictly reject suspended, pending, or disabled)
    if (appUser.status !== "active") {
      await supabaseAdmin.from("login_attempts").insert({
        username: normalizedIdentifier,
        ip_address: clientIp,
        success: false,
      })
      // Return identical generic error to prevent account state enumeration
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 5. Resolve Auth Identity using getUserById (Never listUsers)
    let authUser = null
    if (appUser.auth_user_id) {
      const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(appUser.auth_user_id)
      if (!authUserErr && authUserData?.user) {
        authUser = authUserData.user
      }
    }

    // If user has no auth_user_id linked yet: check if it's the intended system admin
    if (!authUser && (normalizedIdentifier === "marwan-desouky" || appUser.email === "marwandesouqhi@gmail.com")) {
      const { data: adminSearch } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 10 })
      const foundAdmin = (adminSearch?.users || []).find((u) => u.email?.toLowerCase() === "marwandesouqhi@gmail.com")
      if (foundAdmin) {
        authUser = foundAdmin
        // Auto-link auth_user_id
        await supabaseAdmin.from("app_users").update({ auth_user_id: foundAdmin.id }).eq("id", appUser.id)
      }
    }

    if (!authUser || !authUser.email) {
      await supabaseAdmin.from("login_attempts").insert({
        username: normalizedIdentifier,
        ip_address: clientIp,
        success: false,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check if account is banned in Supabase Auth
    if (authUser.banned_until && new Date(authUser.banned_until).getTime() > Date.now()) {
      await supabaseAdmin.from("login_attempts").insert({
        username: normalizedIdentifier,
        ip_address: clientIp,
        success: false,
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
      await supabaseAdmin.from("login_attempts").insert({
        username: normalizedIdentifier,
        ip_address: clientIp,
        success: false,
      })
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 7. Verify returned user identity matches app_users linked identity
    if (signInData.user.id !== authUser.id) {
      return new Response(JSON.stringify({ error: GENERIC_LOGIN_ERROR }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 8. Record successful login attempt
    await supabaseAdmin.from("login_attempts").insert({
      username: normalizedIdentifier,
      ip_address: clientIp,
      success: true,
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
