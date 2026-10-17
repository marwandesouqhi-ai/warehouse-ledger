import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  const reserved = [
    "marwan-desouky",
    "marwan-desouky@warehouse.local",
    "marwandesouqhi@gmail.com",
  ]
  for (const r of reserved) {
    if (clean === normalizeUsername(r)) return true
  }
  if (clean.endsWith("@warehouse.local")) {
    const prefix = clean.replace(/@warehouse\.local$/, "")
    if (prefix === "marwan-desouky") return true
  }
  return false
}

async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const aBuf = encoder.encode(a)
  const bBuf = encoder.encode(b)

  const aHash = await crypto.subtle.digest("SHA-256", aBuf)
  const bHash = await crypto.subtle.digest("SHA-256", bBuf)

  const aArray = new Uint8Array(aHash)
  const bArray = new Uint8Array(bHash)

  let diff = aArray.length ^ bArray.length
  for (let i = 0; i < aArray.length; i++) {
    diff |= aArray[i] ^ bArray[i]
  }
  return diff === 0
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    const body = await req.json().catch(() => ({}))
    const rawIdentifier = body.identifier || body.username
    const password = body.password

    const cleanIdentifier = normalizeUsername(rawIdentifier)

    if (!cleanIdentifier || !password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "اسم المستخدم أو الرقم الوظيفي وكلمة المرور مطلوبان." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 1. Fixed System Admin marwan-desouky is strictly excluded from login-bridge
    if (isProtectedUsername(cleanIdentifier)) {
      return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 2. Rate limiting check via login_attempts table (Max 5 failed attempts in 15 mins)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count: failedAttemptsCount } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("username", cleanIdentifier)
      .eq("success", false)
      .gte("attempted_at", fifteenMinutesAgo)

    if (failedAttemptsCount && failedAttemptsCount >= 5) {
      return new Response(JSON.stringify({
        error: "تم تجاوز الحد الأقصى للمحاولات الفاشلة. تم تعليق المحاولة مؤقتاً لمدة 15 دقيقة لحماية الحساب.",
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Query mirror row from app_users by username, employee_id, or email
    const { data: appUser, error: appUserErr } = await supabaseAdmin
      .from("app_users")
      .select("id, username, display_name, password, role, status, permissions, employee_id, email, department")
      .or(`username.ilike.${cleanIdentifier},employee_id.ilike.${cleanIdentifier},email.ilike.${cleanIdentifier}`)
      .maybeSingle()

    if (appUserErr || !appUser) {
      await supabaseAdmin.from("login_attempts").insert({
        username: cleanIdentifier,
        success: false,
      })
      return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const cleanUsername = normalizeUsername(appUser.username)

    if (isProtectedUsername(cleanUsername)) {
      return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 4. Explicitly reject disabled or suspended accounts
    if (appUser.status === "disabled" || appUser.status === "suspended") {
      await supabaseAdmin.from("login_attempts").insert({
        username: cleanIdentifier,
        success: false,
      })
      return new Response(JSON.stringify({ error: "تم تعطيل هذا الحساب. يرجى مراجعة إدارة النظام." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 5. Constant-time password verification against password stored in app_users
    const passwordMatches = await timingSafeEqualString(password, appUser.password || "")
    if (!passwordMatches) {
      await supabaseAdmin.from("login_attempts").insert({
        username: cleanIdentifier,
        success: false,
      })
      return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const effectiveAuthEmail = appUser.email || `${cleanUsername}@warehouse.local`

    // 6. Check if user already exists in Supabase Auth
    const { data: authSearch } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuthUser = (authSearch?.users || []).find(
      (u) => normalizeUsername(u.email) === normalizeUsername(effectiveAuthEmail) ||
             normalizeUsername(u.email) === normalizeUsername(`${cleanUsername}@warehouse.local`)
    )

    if (existingAuthUser) {
      // User exists in Auth, but client signIn failed: sync the updated password into Supabase Auth
      await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        password: password,
      })

      await supabaseAdmin
        .from("app_users")
        .update({
          auth_user_id: existingAuthUser.id,
          status: "active",
        })
        .eq("id", appUser.id)

      await supabaseAdmin.from("login_attempts").insert({
        username: cleanUsername,
        success: true,
      })

      return new Response(JSON.stringify({
        success: true,
        bridged: true,
        email: existingAuthUser.email || effectiveAuthEmail,
        employee_id: appUser.employee_id || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Seamlessly provision Supabase Auth account with matching credentials
    const permissionsArray = Array.isArray(appUser.permissions)
      ? appUser.permissions
      : typeof appUser.permissions === "string"
        ? (() => { try { return JSON.parse(appUser.permissions) } catch { return [] } })()
        : []

    const { data: newAuthUser, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
      email: effectiveAuthEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        username: cleanUsername,
        displayName: appUser.display_name || cleanUsername,
        name: appUser.display_name || cleanUsername,
        employee_id: appUser.employee_id || null,
        department: appUser.department || null,
      },
      app_metadata: {
        username: cleanUsername,
        role: appUser.role || "viewer",
        system_admin: false,
        permissions: permissionsArray,
        must_change_password: true,
        employee_id: appUser.employee_id || null,
        department: appUser.department || null,
      },
    })

    if (createAuthErr || !newAuthUser?.user) {
      throw new Error(createAuthErr?.message || "Failed to provision Supabase Auth user")
    }

    // 7. Link auth_user_id and ensure status is active in app_users
    await supabaseAdmin
      .from("app_users")
      .update({
        auth_user_id: newAuthUser.user.id,
        status: "active",
        must_change_password: true,
      })
      .eq("id", appUser.id)

    // 8. Record success attempt in login_attempts
    await supabaseAdmin.from("login_attempts").insert({
      username: cleanUsername,
      success: true,
    })

    return new Response(JSON.stringify({
      success: true,
      bridged: true,
      email: effectiveAuthEmail,
      employee_id: appUser.employee_id || null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
