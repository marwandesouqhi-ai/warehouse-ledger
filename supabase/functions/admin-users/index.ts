import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // 2. Enforce System Admin privilege check strictly on caller's app_metadata (never trust user_metadata or usernames)
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const action = body.action || "list_users"

    // Helper: count total active system admins to prevent lockout
    async function countActiveSystemAdmins(): Promise<number> {
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers()
      let count = 0
      for (const u of (listData?.users || [])) {
        if (u.app_metadata?.system_admin === true || u.app_metadata?.role === "system_admin") {
          count++
        }
      }
      return count
    }

    // ─── ACTION: list_users ──────────────────────────────────────────────────
    if (action === "list_users") {
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      if (listError) throw listError

      // Fetch mirror profile data from app_users
      const { data: appUsersData } = await supabaseAdmin
        .from("app_users")
        .select("id, username, display_name, role, status, created_at, activated_at, last_login_at, notes, permissions, auth_user_id, must_change_password")

      const appUserMap = new Map((appUsersData || []).map((u) => [u.username.toLowerCase(), u]))

      const users = (listData?.users || []).map((u) => {
        const username = (u.app_metadata?.username as string) || (u.email?.replace(/@warehouse\.local$/, "") ?? "")
        const mirror = appUserMap.get(username.toLowerCase())

        return {
          id: u.id,
          username,
          displayName: (u.user_metadata?.displayName as string) || mirror?.display_name || username,
          email: u.email ?? "",
          role: u.app_metadata?.role || mirror?.role || "viewer",
          systemAdmin: u.app_metadata?.system_admin === true || u.app_metadata?.role === "system_admin",
          status: mirror?.status || "active",
          permissions: (u.app_metadata?.permissions as string[]) || mirror?.permissions || [],
          mustChangePassword: Boolean(u.app_metadata?.must_change_password ?? mirror?.must_change_password),
          createdAt: u.created_at,
          lastSignInAt: u.last_sign_in_at || mirror?.last_login_at,
        }
      })

      return new Response(JSON.stringify({ success: true, users }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: create_user ─────────────────────────────────────────────────
    if (action === "create_user") {
      const { username, displayName, password, role = "viewer", permissions = [], requirePasswordChange = true } = body

      const cleanUsername = String(username || "").trim().toLowerCase()
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

      const allowedRoles = ["system_admin", "admin", "warehouse_staff", "purchasing_staff", "editor", "viewer"]
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
      const isTargetSysAdmin = role === "system_admin"

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
          system_admin: isTargetSysAdmin,
          permissions: isTargetSysAdmin ? ["view_audit", "view_settings", "manage_records"] : permissions,
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
        permissions: isTargetSysAdmin ? ["view_audit", "view_settings", "manage_records"] : permissions,
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
      const { userId, newPassword, mustChangePassword = false } = body
      if (!userId) {
        return new Response(JSON.stringify({ error: "معرّف المستخدم مطلوب." }), {
          status: 400,
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

      const { data: targetUser, error: getError } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (getError || !targetUser?.user) {
        return new Response(JSON.stringify({ error: "المستخدم غير موجود." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: effectivePassword,
        app_metadata: {
          ...targetUser.user.app_metadata,
          must_change_password: Boolean(mustChangePassword),
        },
      })

      if (updateError) throw updateError

      const username = targetUser.user.email?.replace(/@warehouse\.local$/, "") ?? ""

      // Update must_change_password in app_users mirror row
      await supabaseAdmin.from("app_users").update({
        must_change_password: Boolean(mustChangePassword),
      }).eq("username", username.toLowerCase())

      // Audit log (never includes password)
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `إعادة تعيين كلمة مرور المستخدم: ${username}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_username: username, must_change_password: Boolean(mustChangePassword) },
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

      const username = targetUser.user.email?.replace(/@warehouse\.local$/, "") ?? ""
      const isTargetCurrentlySysAdmin =
        targetUser.user.app_metadata?.system_admin === true ||
        targetUser.user.app_metadata?.role === "system_admin"

      // Protect against demoting the last active System Admin
      if (isTargetCurrentlySysAdmin && role && role !== "system_admin") {
        const sysAdminCount = await countActiveSystemAdmins()
        if (sysAdminCount <= 1) {
          return new Response(JSON.stringify({
            error: "لا يمكن خفض صلاحيات آخر مدير نظام نشط (System Admin) في المؤسسة. يجب تعيين مدير نظام بديل أولاً.",
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      const targetIsBecomingSysAdmin = role === "system_admin"
      const newRole = role || targetUser.user.app_metadata?.role || "viewer"
      const newPermissions = targetIsBecomingSysAdmin
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
          system_admin: targetIsBecomingSysAdmin,
          permissions: newPermissions,
        },
      })

      if (updateError) throw updateError

      // Mirror to app_users
      await supabaseAdmin.from("app_users").update({
        display_name: displayName || targetUser.user.user_metadata?.displayName,
        role: newRole,
        permissions: newPermissions,
      }).eq("username", username.toLowerCase())

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `تحديث بيانات المستخدم: ${username}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_username: username, newRole, newPermissions },
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

      const username = targetUser.user.email?.replace(/@warehouse\.local$/, "") ?? ""
      const isTargetSysAdmin =
        targetUser.user.app_metadata?.system_admin === true ||
        targetUser.user.app_metadata?.role === "system_admin"

      // Protect against deleting the last active System Admin
      if (isTargetSysAdmin) {
        const sysAdminCount = await countActiveSystemAdmins()
        if (sysAdminCount <= 1) {
          return new Response(JSON.stringify({
            error: "لا يمكن حذف آخر مدير نظام نشط (System Admin) في المؤسسة. يجب تعيين مدير نظام بديل أولاً.",
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)
      if (deleteError) throw deleteError

      // Remove from app_users mirror
      await supabaseAdmin.from("app_users").delete().eq("username", username.toLowerCase())

      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        user_email: caller.email,
        action: `حذف حساب المستخدم: ${username}`,
        entity_type: "user_management",
        entity_id: userId,
        details: { target_username: username },
      })

      return new Response(JSON.stringify({ success: true, message: "تم حذف المستخدم بنجاح." }), {
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
