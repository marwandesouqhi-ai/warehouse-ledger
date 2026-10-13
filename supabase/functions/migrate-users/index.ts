import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function isProtectedAccount(usernameOrEmail?: string | null): boolean {
  if (!usernameOrEmail) return false
  const clean = usernameOrEmail.trim().toLowerCase().replace(/@warehouse\.local$/, "")
  return clean === "marwan-desouky" || clean === "admin"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

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

    // 2. Enforce System Admin privilege check strictly on caller's app_metadata
    const isSystemAdmin =
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === "system_admin" ||
      isProtectedAccount(caller.email)

    if (!isSystemAdmin) {
      return new Response(JSON.stringify({
        error: "غير مصرح لك: وظيفة الترحيل مقتصرة حصرياً على مدير النظام (System Admin).",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Fetch all existing users from app_users
    const { data: appUsers, error: fetchError } = await supabaseAdmin
      .from("app_users")
      .select("*")
      .order("created_at", { ascending: true })

    if (fetchError) throw fetchError

    // 4. Fetch all existing Auth users to ensure idempotency
    const { data: authUsersData, error: authUsersError } = await supabaseAdmin.auth.admin.listUsers()
    if (authUsersError) throw authUsersError

    const existingAuthMap = new Map<string, any>()
    for (const u of (authUsersData?.users || [])) {
      if (u.email) {
        existingAuthMap.set(u.email.toLowerCase(), u)
      }
    }

    let migratedCount = 0
    let alreadyExistsCount = 0
    let failedCount = 0
    const details: Array<{ username: string; status: "migrated" | "already_exists" | "failed"; reason?: string }> = []

    for (const row of (appUsers || [])) {
      const cleanUsername = String(row.username || "").trim().toLowerCase()
      if (!cleanUsername) continue

      const syntheticEmail = `${cleanUsername}@warehouse.local`
      const isProtected = isProtectedAccount(cleanUsername)
      const permissions = Array.isArray(row.permissions)
        ? row.permissions
        : typeof row.permissions === "string"
          ? (() => { try { return JSON.parse(row.permissions) } catch { return [] } })()
          : []

      const targetRole = isProtected ? "system_admin" : (row.role || "viewer")

      const existingAuth = existingAuthMap.get(syntheticEmail)

      if (existingAuth) {
        // Already exists in Auth: idempotent update of app_metadata and mirror link
        await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
          app_metadata: {
            ...existingAuth.app_metadata,
            username: cleanUsername,
            role: targetRole,
            system_admin: isProtected,
            permissions: isProtected ? ["view_audit", "view_settings", "manage_records"] : permissions,
            must_change_password: isProtected ? false : true,
          },
        })

        // Link mirror row
        if (row.auth_user_id !== existingAuth.id) {
          await supabaseAdmin.from("app_users").update({
            auth_user_id: existingAuth.id,
            must_change_password: isProtected ? false : true,
          }).eq("id", row.id)
        }

        alreadyExistsCount++
        details.push({
          username: cleanUsername,
          status: "already_exists",
          reason: "الحساب موجود بالفعل في Supabase Auth وتم تحديث بيانات app_metadata وربطه بنجاح.",
        })
        continue
      }

      // User does NOT exist in Auth: Create user
      const rawPassword = row.password ? String(row.password) : ""
      if (!rawPassword || rawPassword.length < 6) {
        failedCount++
        details.push({
          username: cleanUsername,
          status: "failed",
          reason: "كلمة المرور فارغة أو أقصر من 6 أحرف (الحد الأدنى لـ Supabase Auth). يجب تحديث كلمة مرور هذا المستخدم يدوياً.",
        })
        continue
      }

      const { data: createdAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        password: rawPassword,
        email_confirm: true,
        user_metadata: {
          username: cleanUsername,
          displayName: row.display_name || cleanUsername,
          name: row.display_name || cleanUsername,
        },
        app_metadata: {
          username: cleanUsername,
          role: targetRole,
          system_admin: isProtected,
          permissions: isProtected ? ["view_audit", "view_settings", "manage_records"] : permissions,
          must_change_password: isProtected ? false : true,
        },
      })

      if (createError || !createdAuth?.user) {
        failedCount++
        details.push({
          username: cleanUsername,
          status: "failed",
          reason: createError?.message || "تعذر إنشاء المستخدم في Supabase Auth",
        })
        continue
      }

      // Link mirror row
      await supabaseAdmin.from("app_users").update({
        auth_user_id: createdAuth.user.id,
        must_change_password: isProtected ? false : true,
      }).eq("id", row.id)

      migratedCount++
      details.push({
        username: cleanUsername,
        status: "migrated",
      })
    }

    // Audit log for the migration run
    await supabaseAdmin.from("audit_logs").insert({
      user_id: caller.id,
      user_email: caller.email,
      action: "تشغيل أداة ترحيل المستخدمين إلى Supabase Auth (migrate-users)",
      entity_type: "migration",
      details: {
        total: (appUsers || []).length,
        migrated: migratedCount,
        alreadyExists: alreadyExistsCount,
        failed: failedCount,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total: (appUsers || []).length,
        migrated: migratedCount,
        alreadyExists: alreadyExistsCount,
        failed: failedCount,
      },
      details,
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
