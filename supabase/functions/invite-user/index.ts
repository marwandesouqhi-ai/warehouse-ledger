import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      return new Response(JSON.stringify({
        error: "غير مصرح لك: فقط مدير النظام (System Admin) يملك صلاحية دعوة المستخدمين وإدارة الحسابات",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const rawForwarded = req.headers.get("x-forwarded-for") || ""
    const ip = rawForwarded.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown"
    const userAgent = req.headers.get("user-agent") || ""

    let siteUrl: string | undefined = undefined
    const rawOrigin = req.headers.get("origin") || req.headers.get("referer") || ""
    if (rawOrigin) {
      try {
        const parsed = new URL(rawOrigin)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          siteUrl = `${parsed.protocol}//${parsed.host}`
        }
      } catch {
        siteUrl = undefined
      }
    }

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
        .select("auth_user_id")
        .ilike("email", trimmedEmail)
        .maybeSingle()

      const targetUserId = dbUser?.auth_user_id
      if (!targetUserId) {
        return new Response(JSON.stringify({
          error: `لم يتم العثور على مستخدم مسجل بالبريد: ${trimmedEmail}`,
        }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (newPassword) {
        if (typeof newPassword !== "string" || newPassword.length < 12) {
          return new Response(JSON.stringify({ error: "كلمة المرور يجب أن لا تقل عن 12 حرفاً ورموزاً لضمان أمان الحساب." }), {
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
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
