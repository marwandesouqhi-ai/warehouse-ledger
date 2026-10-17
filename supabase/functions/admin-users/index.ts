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

function generateSecureTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*"
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => chars[byte % chars.length]).join("")
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    const body = await req.json().catch(() => ({}))
    const authHeader = req.headers.get("Authorization")

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 1. Verify caller identity using JWT
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const action = body.action || "list_users"

    // ─── ACTION: bootstrap_system_admin (One-Time Verified Bootstrap) ─────────
    if (action === "bootstrap_system_admin") {
      const expectedEmail = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") || "marwandesouqhi@gmail.com").trim().toLowerCase()
      const expectedUsername = (Deno.env.get("BOOTSTRAP_ADMIN_USERNAME") || "marwan-desouky").trim()

      // 1. Authoritatively fetch caller from Auth admin API (never trust request body)
      const { data: authUserData, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(caller.id)
      const verifiedAuthUser = authUserData?.user

      const isEmailVerified = Boolean(verifiedAuthUser?.email_confirmed_at)
      const isEmailMatch = (verifiedAuthUser?.email || "").trim().toLowerCase() === expectedEmail

      if (authUserErr || !verifiedAuthUser || !isEmailVerified || !isEmailMatch) {
        // Record security denial in audit_logs
        await supabaseAdmin.from("audit_logs").insert({
          user_id: caller.id,
          user_email: verifiedAuthUser?.email || caller.email || "unknown",
          action: "محاولة تهيئة مدير نظام مرفوضة (Bootstrap Denied)",
          entity_type: "security_violation",
          entity_id: caller.id,
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

    // 2. Enforce System Admin privilege check strictly on caller's app_metadata for all other actions
    const isSystemAdmin =
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === "system_admin"

    if (!isSystemAdmin) {
      return new Response(JSON.stringify({
        error: "غير مصرح لك: إجراءات إدارة الحسابات مقتصرة حصرياً على مدير النظام (System Admin).",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const callerUsername = (caller.app_metadata?.username as string) || (caller.email?.replace(/@warehouse\.local$/, "") ?? "")
    const isCallerProtected = isProtectedUsername(callerUsername) || isProtectedUsername(caller.email)

    // ─── ACTION: list_users ──────────────────────────────────────────────────
    if (action === "list_users") {
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      if (listError) throw listError

      // Fetch mirror profile data from app_users
      const { data: appUsersData } = await supabaseAdmin
        .from("app_users")
        .select("id, username, display_name, role, status, created_at, activated_at, last_login_at, notes, permissions, auth_user_id, must_change_password, employee_id, email, department, telegram_user_id")

      const appUserMap = new Map((appUsersData || []).map((u) => [normalizeUsername(u.username), u]))

      const allUsers = (listData?.users || []).map((u) => {
        const username = (u.app_metadata?.username as string) || (u.email?.replace(/@warehouse\.local$/, "") ?? "")
        const mirror = appUserMap.get(normalizeUsername(username))

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
      const visibleUsers = allUsers.filter((u) => {
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

      const allowedRoles = ["admin", "warehouse_staff", "purchasing_staff", "editor", "viewer"]
      if (!allowedRoles.includes(role)) {
        return new Response(JSON.stringify({ error: "الدور المحدد غير صالح." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Generate strong temporary password if not provided
      let effectivePassword = password
      let isGeneratedPassword = false
      if (!effectivePassword || typeof effectivePassword !== "string" || effectivePassword.trim().length === 0) {
        effectivePassword = generateSecureTempPassword()
        isGeneratedPassword = true
      } else if (effectivePassword.length < 12) {
        return new Response(JSON.stringify({ error: "كلمة المرور يجب ألا تقل عن 12 حرفاً ورموزاً لضمان أمان النظام." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const syntheticEmail = `${cleanUsername}@warehouse.local`

      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        password: effectivePassword,
        email_confirm: true,
        user_metadata: {
          username: cleanUsername,
          displayName: displayName?.trim() || cleanUsername,
          name: displayName?.trim() || cleanUsername,
        },
        app_metadata: {
          username: cleanUsername,
          role,
          system_admin: false,
          permissions: permissions || [],
          must_change_password: Boolean(requirePasswordChange),
        },
      })

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Upsert mirror row in app_users WITHOUT plaintext password
      await supabaseAdmin.from("app_users").upsert({
        username: cleanUsername,
        display_name: displayName?.trim() || cleanUsername,
        role,
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
          temporaryPassword: isGeneratedPassword ? effectivePassword : null,
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

      // 3. Look up by synthetic email in Auth users list
      if (!targetAuthUser && targetUsername) {
        const syntheticEmail = `${targetUsername}@warehouse.local`
        const { data: authList } = await supabaseAdmin.auth.admin.listUsers()
        targetAuthUser = (authList?.users || []).find(
          (u) => normalizeUsername(u.email) === normalizeUsername(syntheticEmail)
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
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن إعادة تعيين كلمة مرور مدير النظام الرئيسي من لوحة الإدارة. يتم تغيير كلمة المرور حصرياً من قِبل صاحب الحساب من داخل جلسته الشخصية.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      let effectivePassword = newPassword
      let isGeneratedPassword = false
      if (!effectivePassword || typeof effectivePassword !== "string" || effectivePassword.trim().length === 0) {
        effectivePassword = generateSecureTempPassword()
        isGeneratedPassword = true
      } else if (effectivePassword.length < 12) {
        return new Response(JSON.stringify({ error: "كلمة المرور الجديدة يجب ألا تقل عن 12 حرفاً للأمان." }), {
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

      // Update app_users row with new password, auth_user_id, and must_change_password
      await supabaseAdmin.from("app_users").update({
        password: effectivePassword,
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
        temporaryPassword: isGeneratedPassword ? effectivePassword : null,
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

      const newRole = isTargetProtected ? "system_admin" : (role || targetUser.user.app_metadata?.role || "viewer")
      const newPermissions = isTargetProtected
        ? ["view_audit", "view_settings", "manage_records"]
        : (permissions ?? targetUser.user.app_metadata?.permissions ?? [])

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...targetUser.user.user_metadata,
          displayName: displayName || targetUser.user.user_metadata?.displayName,
        },
        app_metadata: {
          ...targetUser.user.app_metadata,
          role: newRole,
          system_admin: isTargetProtected,
          permissions: newPermissions,
        },
      })

      if (updateError) throw updateError

      // Mirror to app_users
      await supabaseAdmin.from("app_users").update({
        display_name: displayName || targetUser.user.user_metadata?.displayName,
        role: newRole,
        permissions: newPermissions,
      }).eq("username", targetUsername.toLowerCase())

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `تحديث بيانات المستخدم: ${targetUsername}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_username: targetUsername, newRole, newPermissions },
      })

      return new Response(JSON.stringify({ success: true, message: "تم تحديث المستخدم بنجاح." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: delete_user ─────────────────────────────────────────────────
    if (action === "delete_user") {
      const { userId } = body
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

      // Strictly forbid deleting marwan-desouky
      if (isTargetProtected) {
        return new Response(JSON.stringify({
          error: "غير مصرح: حساب مدير النظام الرئيسي (marwan-desouky) محمي بشكل دائم ولا يمكن حذفه نهائياً من النظام.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Strictly forbid deleting root admin
      if (targetUsername.toLowerCase() === "admin") {
        return new Response(JSON.stringify({
          error: "غير مصرح: حساب المشرف الرئيسي (admin) محمي من الحذف.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (deleteError) throw deleteError

      // Remove from app_users mirror
      await supabaseAdmin.from("app_users").delete().eq("username", targetUsername.toLowerCase())

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `حذف حساب المستخدم: ${targetUsername}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_username: targetUsername },
      })

      return new Response(JSON.stringify({ success: true, message: "تم حذف المستخدم بنجاح." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: list_registration_requests ──────────────────────────────────
    if (action === "list_registration_requests") {
      const { data: requests, error: reqErr } = await supabaseAdmin
        .from("registration_requests")
        .select("*")
        .order("created_at", { ascending: false })

      if (reqErr) throw reqErr

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

      if (regReq.approval_status === "approved") {
        return new Response(JSON.stringify({
          error: `تم اعتماد هذا الطلب مسبقاً بالرقم الوظيفي: ${regReq.employee_id}`,
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

      const roleToAssign = approvedRole || regReq.requested_role

      if (roleToAssign === "system_admin") {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن منح دور مدير النظام الرئيسي من خلال طلبات تسجيل الموظفين.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Execute SQL RPC approve_employee_registration
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc("approve_employee_registration", {
        p_request_id: requestId,
        p_approved_role: roleToAssign,
        p_reviewer_id: caller.id,
      })

      if (rpcErr) {
        throw rpcErr
      }

      const allocatedEmployeeId = rpcRes?.employee_id

      // Provision or link user in Supabase Auth with real email
      let authUserId: string | null = null
      const { data: authList } = await supabaseAdmin.auth.admin.listUsers()
      const existingAuth = (authList?.users || []).find(
        (u) => normalizeUsername(u.email) === normalizeUsername(regReq.email)
      )

      if (existingAuth) {
        authUserId = existingAuth.id
        await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
          app_metadata: {
            ...existingAuth.app_metadata,
            role: roleToAssign,
            employee_id: allocatedEmployeeId,
            department: regReq.requested_department,
            status: "active",
          },
        })
      } else {
        const tempPassword = generateSecureTempPassword()
        const { data: newAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
          email: regReq.email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            name: regReq.full_name,
            displayName: regReq.full_name,
            employee_id: allocatedEmployeeId,
          },
          app_metadata: {
            role: roleToAssign,
            employee_id: allocatedEmployeeId,
            department: regReq.requested_department,
            system_admin: false,
            status: "active",
            must_change_password: true,
          },
        })

        if (!createAuthErr && newAuth?.user) {
          authUserId = newAuth.user.id
        }
      }

      if (authUserId) {
        await supabaseAdmin
          .from("app_users")
          .update({ auth_user_id: authUserId })
          .eq("employee_id", allocatedEmployeeId)
      }

      // Notify Telegram user if configured
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")
      if (botToken && regReq.telegram_user_id) {
        const notifyUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
        const notifyMsg = `تهانينا! تمت الموافقة على طلب اعتماد حسابك.\n\nالرقم الوظيفي: <b>${allocatedEmployeeId}</b>\nالدور: ${roleToAssign}\nالقسم: ${regReq.requested_department}\n\nيمكنك الآن تسجيل الدخول إلى النظام باستخدام الرقم الوظيفي أو بريدك الإلكتروني.`
        try {
          await fetch(notifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: regReq.telegram_user_id,
              text: notifyMsg,
              parse_mode: "HTML",
            }),
          })
        } catch {
          // ignore notification failure
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "تم اعتماد الموظف وتخصيص الرقم الوظيفي بنجاح.",
        employeeId: allocatedEmployeeId,
        role: roleToAssign,
      }), {
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
              text: `تم مراجعة طلب التسجيل ولم تتم الموافقة عليه.\nالسبب: ${rejectionReason || "لم يتم تحديد سبب"}`,
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
      const { userId, status } = body
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

      // Check if target is protected system admin
      const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(userId)
      const targetUsername = targetUser?.user?.email?.replace(/@warehouse\.local$/, "") || ""
      const isTargetProtected = isProtectedUsername(targetUsername) || isProtectedUsername(targetUser?.user?.email)

      if (isTargetProtected && status === "suspended") {
        return new Response(JSON.stringify({
          error: "غير مصرح: لا يمكن تعليق أو تعطيل حساب مدير النظام الرئيسي.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (targetUser?.user) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: {
            ...targetUser.user.app_metadata,
            status,
          },
        })
      }

      // Mirror to app_users
      await supabaseAdmin
        .from("app_users")
        .update({ status })
        .or(`auth_user_id.eq.${userId},id.eq.${userId}`)

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `تعديل حالة حساب المستخدم إلى (${status}): ${targetUsername || userId}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_id: userId, status },
      })

      return new Response(JSON.stringify({
        success: true,
        message: `تم تحديث حالة الحساب إلى ${status === "suspended" ? "معلّق" : "نشط"} بنجاح.`,
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
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
