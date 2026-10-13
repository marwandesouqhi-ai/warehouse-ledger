import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Strictly verify System Admin permissions (protected in app_metadata and email only)
    const isCallerAdmin = user.email === "marwandesouqhi@gmail.com" ||
      user.app_metadata?.system_admin === true ||
      user.app_metadata?.role === "admin"

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
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      if (listError) throw listError
      const users = (listData?.users || []).map((u) => ({
        id: u.id,
        email: u.email ?? "",
        role: u.app_metadata?.role || (u.email === "marwandesouqhi@gmail.com" ? "admin" : "viewer"),
        system_admin: u.email === "marwandesouqhi@gmail.com" || u.app_metadata?.system_admin === true,
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
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers()
      if (listError) throw listError
      const targetUser = listData?.users?.find((u) => u.email?.toLowerCase() === trimmedEmail)
      if (!targetUser) {
        return new Response(JSON.stringify({
          error: `لم يتم العثور على مستخدم مسجل بالبريد: ${trimmedEmail}`,
        }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (newPassword) {
        if (typeof newPassword !== "string" || newPassword.length < 6) {
          return new Response(JSON.stringify({ error: "كلمة المرور يجب أن لا تقل عن 6 أحرف" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUser.id,
          { password: newPassword }
        )
        if (updateError) throw updateError
      }

      let recoveryLink: string | null = null
      try {
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: trimmedEmail,
          options: {
            redirectTo: siteUrl ? `${siteUrl}/#type=recovery` : undefined,
          },
        })
        recoveryLink = linkData?.properties?.action_link ?? null
      } catch (err) {
        console.warn("generate recovery link warning:", err)
      }

      // Record in audit_logs
      await supabaseAdmin.from("audit_logs").insert({
        user_id: user.id,
        user_email: user.email,
        action: `إعادة تعيين كلمة مرور للمستخدم: ${trimmedEmail}`,
        entity_type: "user_management",
        entity_id: targetUser.id,
        details: {
          target_email: trimmedEmail,
          password_updated_directly: Boolean(newPassword),
          has_recovery_link: Boolean(recoveryLink),
        },
        ip_address: ip,
        user_agent: userAgent,
      })

      return new Response(JSON.stringify({
        success: true,
        message: newPassword
          ? `تم تحديث وحفظ كلمة المرور بنجاح للمستخدم (${trimmedEmail})`
          : `تم توليد رابط إعادة التعيين بنجاح للمستخدم (${trimmedEmail})`,
        recoveryLink,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 3. Action: Invite new user (default)
    const { email, role = "viewer" } = body
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "البريد الإلكتروني غير صالح" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const trimmedEmail = email.trim().toLowerCase()
    const allowedRoles = ["viewer", "editor", "admin"]
    const safeRole = allowedRoles.includes(role) ? role : "viewer"

    let emailSent = false
    let inviteLink: string | null = null
    let userId: string | null = null
    let responseMessage = ""

    // Try sending official email invite first
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      trimmedEmail,
      {
        data: { role: safeRole, invited_by: user.id },
        redirectTo: siteUrl ? `${siteUrl}/#type=invite` : undefined,
      }
    )

    if (!inviteError && inviteData?.user) {
      emailSent = true
      userId = inviteData.user.id
      responseMessage = `تم إرسال إيميل الدعوة بنجاح إلى ${trimmedEmail}`
    } else {
      console.log("inviteUserByEmail failed with:", inviteError?.message, "Falling back to generateLink...")

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "invite",
        email: trimmedEmail,
        options: {
          redirectTo: siteUrl ? `${siteUrl}/#type=invite` : undefined,
          data: { role: safeRole, invited_by: user.id },
        },
      })

      if (linkError) {
        return new Response(JSON.stringify({ error: linkError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      inviteLink = linkData.properties?.action_link ?? null
      userId = linkData.user?.id ?? null
      responseMessage = `تم إنشاء دعوة المستخدم بنجاح! نظراً لحد رسائل Supabase المجانية، يمكنك نسخ الرابط المباشر للدعوة أدناه وإرساله للمستخدم.`
    }

    // Record invitation in user_invitations table
    await supabaseAdmin.from("user_invitations").insert({
      email: trimmedEmail,
      role: safeRole,
      invited_by: user.id,
      invited_by_email: user.email,
      status: "pending",
    })

    // Record in audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      user_id: user.id,
      user_email: user.email,
      action: "دعوة مستخدم جديد من النظام",
      entity_type: "invitation",
      entity_id: userId || "",
      details: {
        invited_email: trimmedEmail,
        role: safeRole,
        email_sent: emailSent,
        has_direct_link: Boolean(inviteLink),
      },
      ip_address: ip,
      user_agent: userAgent,
    })

    return new Response(JSON.stringify({
      success: true,
      emailSent,
      inviteLink,
      emailErrorDetail: inviteError ? inviteError.message : null,
      message: responseMessage,
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
