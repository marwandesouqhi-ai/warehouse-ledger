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
    "admin",
    "root",
    "system",
    "support",
    "marwan-desouky",
    "marwan-desouky@warehouse.local",
    "marwandesouqhi@gmail.com",
  ]
  for (const r of reserved) {
    if (clean === normalizeUsername(r)) return true
  }
  if (clean.endsWith("@warehouse.local")) {
    const prefix = clean.replace(/@warehouse\.local$/, "")
    if (prefix === "marwan-desouky" || prefix === "admin") return true
  }
  return false
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
    const action = body.action || "complete_activation"

    // 1. Authenticate caller from session JWT if provided
    let caller: any = null
    const authHeader = req.headers.get("Authorization")
    if (authHeader) {
      try {
        const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } },
        })
        const { data: { user } } = await supabaseCaller.auth.getUser()
        if (user) caller = user
      } catch {
        // ignore
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // For complete_activation, caller authentication is strictly required
    if (action === "complete_activation" && !caller) {
      return new Response(JSON.stringify({ error: "جلسة المستخدم غير صالحة أو منتهية. يرجى إعادة فتح رابط الدعوة." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: get_profile ─────────────────────────────────────────────────
    if (action === "get_profile") {
      const rawEmail = (caller?.email || body.email || "")
      const emailToLookup = rawEmail.split("#")[0].split("?")[0].trim().toLowerCase()
      if (!emailToLookup && !caller?.id) {
        return new Response(JSON.stringify({ error: "جلسة المستخدم غير صالحة أو منتهية. يرجى إعادة فتح رابط الدعوة." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      let userRow: any = null

      if (caller?.id) {
        const { data: dbUser } = await supabaseAdmin
          .from("app_users")
          .select("id, display_name, email, employee_id, department, role, status")
          .eq("auth_user_id", caller.id)
          .maybeSingle()
        if (dbUser) userRow = dbUser
      }

      if (!userRow && emailToLookup) {
        const { data: dbUser } = await supabaseAdmin
          .from("app_users")
          .select("id, display_name, email, employee_id, department, role, status")
          .ilike("email", emailToLookup)
          .maybeSingle()
        if (dbUser) userRow = dbUser
      }

      if (!userRow && emailToLookup) {
        const { data: regRow } = await supabaseAdmin
          .from("registration_requests")
          .select("*")
          .ilike("email", emailToLookup)
          .eq("approval_status", "approved")
          .maybeSingle()

        if (regRow) {
          userRow = {
            id: `usr-${(regRow.employee_id || "new").toLowerCase()}`,
            display_name: regRow.full_name,
            email: regRow.email,
            employee_id: regRow.employee_id,
            department: regRow.requested_department,
            role: regRow.approved_role || regRow.requested_role,
            status: "pending_activation",
          }
        }
      }

      if (!userRow) {
        return new Response(JSON.stringify({ error: "لم يتم العثور على سجل وظيفي مرتبط بجلسة الدعوة." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      return new Response(JSON.stringify({
        success: true,
        profile: {
          fullName: userRow.display_name || caller?.user_metadata?.displayName || caller?.user_metadata?.name || "",
          email: userRow.email || caller?.email || emailToLookup,
          employeeId: userRow.employee_id || (caller?.app_metadata?.employee_id as string) || "",
          department: userRow.department || (caller?.app_metadata?.department as string) || "",
          role: userRow.role || (caller?.app_metadata?.role as string) || "",
          status: userRow.status || (caller?.app_metadata?.status as string) || "pending_activation",
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ─── ACTION: complete_activation ─────────────────────────────────────────
    if (action === "complete_activation") {
      const rawUsername = body.username
      if (!rawUsername || typeof rawUsername !== "string") {
        return new Response(JSON.stringify({ error: "اسم المستخدم مطلوب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const cleanUsername = normalizeUsername(rawUsername)

      // Rule 1: Length between 3 and 30
      if (cleanUsername.length < 3 || cleanUsername.length > 30) {
        return new Response(JSON.stringify({ error: "اسم المستخدم يجب أن يتكون من 3 إلى 30 حرفاً." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rule 2: Allowed characters: lowercase letters, digits, ., _, -
      if (!/^[a-z0-9._-]+$/.test(cleanUsername)) {
        return new Response(JSON.stringify({ error: "اسم المستخدم يمكن أن يحتوي فقط على أحرف إنجليزية صغيرة وأرقام والنقطة والشرطة (- _ .)." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rule 3: Must start with letter or digit
      if (!/^[a-z0-9]/.test(cleanUsername)) {
        return new Response(JSON.stringify({ error: "اسم المستخدم يجب أن يبدأ بحرف إنجليزي أو رقم." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rule 4: Not an email
      if (cleanUsername.includes("@")) {
        return new Response(JSON.stringify({ error: "اسم المستخدم يجب ألا يكون بريداً إلكترونياً." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rule 5: Not an employee code pattern
      if (/^(wh|pur|sys|emp|adm)-/i.test(cleanUsername) || /^[a-z]{2,3}-[a-z]{3}-\d{4,6}$/i.test(cleanUsername)) {
        return new Response(JSON.stringify({ error: "اسم المستخدم لا يمكن أن يطابق نمط الأكواد الوظيفية." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Rule 6: Reserved check
      if (isProtectedUsername(cleanUsername)) {
        return new Response(JSON.stringify({ error: "اسم المستخدم محجوز لنظام إدارة الخادم ولا يمكن استخدامه." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Look up app_users row for caller, fallback to approved registration_requests
      let { data: userRow } = await supabaseAdmin
        .from("app_users")
        .select("*")
        .or(`auth_user_id.eq.${caller.id},email.eq.${caller.email}`)
        .maybeSingle()

      if (!userRow) {
        const { data: regRow } = await supabaseAdmin
          .from("registration_requests")
          .select("*")
          .eq("email", caller.email)
          .eq("approval_status", "approved")
          .maybeSingle()

        if (regRow) {
          const { data: insertedUser } = await supabaseAdmin
            .from("app_users")
            .upsert({
              id: `usr-${(regRow.employee_id || "new").toLowerCase()}`,
              username: cleanUsername,
              display_name: regRow.full_name,
              role: regRow.approved_role || regRow.requested_role,
              department: regRow.requested_department,
              status: "pending_activation",
              email: regRow.email,
              employee_id: regRow.employee_id,
              telegram_user_id: regRow.telegram_user_id,
              auth_user_id: caller.id,
              notes: "تم التفعيل من طلب التسجيل المعتمد",
            })
            .select()
            .maybeSingle()

          userRow = insertedUser || {
            id: `usr-${(regRow.employee_id || "new").toLowerCase()}`,
            username: cleanUsername,
            display_name: regRow.full_name,
            role: regRow.approved_role || regRow.requested_role,
            department: regRow.requested_department,
            status: "pending_activation",
            email: regRow.email,
            employee_id: regRow.employee_id,
            telegram_user_id: regRow.telegram_user_id,
          }
        }
      }

      if (!userRow) {
        return new Response(JSON.stringify({ error: "لم يتم العثور على سجل وظيفي معتمد لهذا الحساب." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Strict single-use enforcement: if account is already active, reject re-activation
      if (userRow.status === "active") {
        return new Response(JSON.stringify({
          error: "رابط التفعيل صالح للاستخدام لمرة واحدة فقط، وقد تم تفعيل هذا الحساب بالفعل مسبقاً. يُرجى تسجيل الدخول مباشرة.",
          code: "ACTIVATION_LINK_ALREADY_USED",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (userRow.status !== "pending_activation") {
        return new Response(JSON.stringify({
          error: `حالة الحساب غير مؤهلة للتفعيل (${userRow.status}). يرجى التواصل مع الإدارة.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Check if username is already taken by another user
      const { data: usernameConflict } = await supabaseAdmin
        .from("app_users")
        .select("id")
        .ilike("username", cleanUsername)
        .neq("id", userRow.id)
        .maybeSingle()

      if (usernameConflict) {
        return new Response(JSON.stringify({ error: `اسم المستخدم "${cleanUsername}" مستخدم بالفعل، يرجى اختيار اسم آخر.` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Verify that caller really has password set in Supabase Auth
      const { data: hasPwd, error: pwdCheckErr } = await supabaseAdmin.rpc("verify_auth_user_has_password", {
        p_auth_user_id: caller.id,
      })

      if (!pwdCheckErr && hasPwd === false) {
        return new Response(JSON.stringify({ error: "يجب تعيين كلمة المرور أولاً قبل إتمام تفعيل الحساب." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Execute DB atomic completion procedure
      const { data: actRes, error: actErr } = await supabaseAdmin.rpc("complete_employee_activation", {
        p_auth_user_id: caller.id,
        p_chosen_username: cleanUsername,
      })

      if (actErr) {
        const errMsg = actErr.message || ""
        // If it's a domain/validation error from the DB procedure, return it directly to client
        if (
          errMsg.includes("صالح للاستخدام") ||
          errMsg.includes("مفعل") ||
          errMsg.includes("مستخدم بالفعل") ||
          errMsg.includes("غير مؤهلة للتفعيل") ||
          errMsg.includes("تعيين كلمة المرور")
        ) {
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }

        // Fallback only if RPC function does not exist in legacy DB
        if (errMsg.includes("function") && errMsg.includes("does not exist")) {
          await supabaseAdmin
            .from("app_users")
            .update({
              username: cleanUsername,
              status: "active",
              activated_at: new Date().toISOString(),
              must_change_password: false,
              auth_user_id: caller.id,
              notes: "تم تفعيل الحساب بنجاح بواسطة الموظف",
            })
            .eq("id", userRow.id)

          await supabaseAdmin
            .from("registration_requests")
            .update({
              invitation_status: "accepted",
              updated_at: new Date().toISOString(),
            })
            .or(`employee_id.eq.${userRow.employee_id},email.eq.${userRow.email}`)
        } else {
          return new Response(JSON.stringify({ error: errMsg || "فشل إتمام تفعيل الحساب في قاعدة البيانات." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      // Synchronize server-managed Auth app_metadata and user_metadata
      await supabaseAdmin.auth.admin.updateUserById(caller.id, {
        app_metadata: {
          ...caller.app_metadata,
          username: cleanUsername,
          role: userRow.role,
          employee_id: userRow.employee_id,
          department: userRow.department,
          status: "active",
          system_admin: false,
          must_change_password: false,
        },
        user_metadata: {
          ...caller.user_metadata,
          username: cleanUsername,
        },
      })

      // Send confirmation to Telegram if registered
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")
      if (botToken && userRow.telegram_user_id) {
        const notifyUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
        const notifyMsg = `تهانينا! تم تفعيل حسابك بنجاح.\n\nاسم المستخدم: <b>${cleanUsername}</b>\nالرقم الوظيفي: <b>${userRow.employee_id}</b>\nالقسم: ${userRow.department || "المخازن"}\n\nيمكنك الآن تسجيل الدخول إلى النظام باستخدام اسم المستخدم أو الرقم الوظيفي وكلمة المرور الخاصة بك.`
        try {
          await fetch(notifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userRow.telegram_user_id,
              text: notifyMsg,
              parse_mode: "HTML",
            }),
          })
        } catch {
          // non-blocking
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: "تم تفعيل حسابك بنجاح!",
        username: cleanUsername,
        employeeId: userRow.employee_id,
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
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء تفعيل الحساب."
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
