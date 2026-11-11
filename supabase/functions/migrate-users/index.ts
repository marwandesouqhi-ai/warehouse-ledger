import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function getReqIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}

async function logUnauthorizedMigrateAttempt(
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
        action: `محاولة وصول غير مصرح إلى وظيفة migrate-users (${reason})`,
        event_type: "unauthorized_api_access",
        entity_type: "edge_function",
        entity_id: "migrate-users",
        table_name: "edge_function:migrate-users",
        ip: reqIp,
        ip_address: reqIp,
        user_agent: req.headers.get("user-agent") || "",
        severity: "warning",
        details: { function: "migrate-users", reason },
      }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(1500) : undefined,
    }).catch(() => undefined)
  } catch {
    // non-blocking
  }
}

serve(async (req: Request) => {
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
      await logUnauthorizedMigrateAttempt(supabaseUrl, supabaseServiceKey, req, "missing_auth_header")
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
      await logUnauthorizedMigrateAttempt(supabaseUrl, supabaseServiceKey, req, "invalid_jwt")
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 2. Enforce System Admin privilege check strictly on caller's app_metadata
    const isSystemAdmin =
      caller.app_metadata?.system_admin === true ||
      caller.app_metadata?.role === "system_admin"

    if (!isSystemAdmin) {
      await logUnauthorizedMigrateAttempt(supabaseUrl, supabaseServiceKey, req, "forbidden_non_system_admin", caller)
      return new Response(JSON.stringify({
        error: "غير مصرح لك: وظيفة الترحيل مقتصرة حصرياً على مدير النظام (System Admin).",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const isDryRun = body.dry_run !== false // Defaults to true (safe dry run) unless explicitly set to false
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Fetch all existing users from app_users
    const { data: appUsers, error: fetchError } = await supabaseAdmin
      .from("app_users")
      .select("*")
      .order("created_at", { ascending: true })

    if (fetchError) throw fetchError

    // 4. Fetch existing Auth users using paginated lookup to ensure idempotency
    const { data: authUsersData, error: authUsersError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 })
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
    const details: Array<{ username: string; status: "migrated" | "already_exists" | "failed" | "dry_run_ready"; reason?: string }> = []

    function isProtectedUsername(u: string): boolean {
      const clean = u.trim().toLowerCase()
      return clean === "marwan-desouky" || clean === "marwan-desouky@warehouse.local" || clean === "marwandesouqhi@gmail.com"
    }

    for (const row of (appUsers || [])) {
      const cleanUsername = String(row.username || "").trim().toLowerCase()
      if (!cleanUsername) continue

      // Skip fixed protected System Admin marwan-desouky (managed and bootstrapped independently)
      if (isProtectedUsername(cleanUsername)) {
        alreadyExistsCount++
        details.push({
          username: cleanUsername,
          status: "already_exists",
          reason: "تم تخطي حساب مدير النظام الرئيسي المحمي (يتم تجهيزه يدوياً وإدارته بشكل مستقل).",
        })
        continue
      }

      const syntheticEmail = `${cleanUsername}@warehouse.local`
      const permissions = Array.isArray(row.permissions)
        ? row.permissions
        : typeof row.permissions === "string"
          ? (() => { try { return JSON.parse(row.permissions) } catch { return [] } })()
          : []

      const targetRole = row.role || "viewer"
      const isTargetSysAdmin = targetRole === "system_admin"

      const existingAuth = existingAuthMap.get(syntheticEmail)

      if (existingAuth) {
        if (!isDryRun) {
          // Idempotent update of app_metadata and mirror link
          await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
            app_metadata: {
              ...existingAuth.app_metadata,
              username: cleanUsername,
              role: targetRole,
              system_admin: isTargetSysAdmin,
              permissions: isTargetSysAdmin ? ["view_audit", "view_settings", "manage_records"] : permissions,
              must_change_password: existingAuth.app_metadata?.must_change_password ?? true,
            },
          })

          // Link mirror row
          if (row.auth_user_id !== existingAuth.id) {
            await supabaseAdmin.from("app_users").update({
              auth_user_id: existingAuth.id,
              must_change_password: existingAuth.app_metadata?.must_change_password ?? true,
            }).eq("id", row.id)
          }
        }

        alreadyExistsCount++
        details.push({
          username: cleanUsername,
          status: "already_exists",
          reason: isDryRun
            ? "الحساب موجود بالفعل في Supabase Auth؛ سيتم ربطه وتحديث بياناته دون تكرار."
            : "الحساب موجود بالفعل في Supabase Auth وتم تحديث بيانات app_metadata وربطه بنجاح.",
        })
        continue
      }

      // User does NOT exist in Auth: Check password validity
      const rawPassword = row.password ? String(row.password) : ""
      if (!rawPassword || rawPassword.length < 6) {
        failedCount++
        details.push({
          username: cleanUsername,
          status: "failed",
          reason: "كلمة المرور غير متوفرة أو أقصر من 6 أحرف. سيتطلب هذا الحساب تعيين كلمة مرور مؤقتة عبر مدير النظام.",
        })
        continue
      }

      if (isDryRun) {
        migratedCount++
        details.push({
          username: cleanUsername,
          status: "dry_run_ready",
          reason: "جاهز للترحيل بنجاح إلى Supabase Auth مع فرض تغيير كلمة المرور في أول تسجيل دخول.",
        })
        continue
      }

      // Execute actual migration
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
          system_admin: isTargetSysAdmin,
          permissions: isTargetSysAdmin ? ["view_audit", "view_settings", "manage_records"] : permissions,
          must_change_password: true, // Enforce password change upon migration
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
        must_change_password: true,
      }).eq("id", row.id)

      migratedCount++
      details.push({
        username: cleanUsername,
        status: "migrated",
        reason: "تم الترحيل بنجاح وإنشاء الهوية في Supabase Auth وربطها.",
      })
    }

    // Audit log for the migration run (never log passwords!)
    await supabaseAdmin.from("audit_logs").insert({
      user_id: caller.id,
      user_email: caller.email,
      action: isDryRun
        ? "تشغيل تجربة جافة لترحيل المستخدمين (migrate-users: dry-run)"
        : "تنفيذ ترحيل المستخدمين الفعلي إلى Supabase Auth (migrate-users: execute)",
      entity_type: "migration",
      details: {
        dry_run: isDryRun,
        total: (appUsers || []).length,
        migrated_or_ready: migratedCount,
        already_exists: alreadyExistsCount,
        failed: failedCount,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      dryRun: isDryRun,
      summary: {
        total: (appUsers || []).length,
        readyOrMigrated: migratedCount,
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
