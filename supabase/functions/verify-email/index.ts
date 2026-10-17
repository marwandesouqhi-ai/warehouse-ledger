import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token.trim())
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    // Security Restriction: verify-email is an internal server-side function only.
    // Public web verification is strictly disabled per Part 1.4.
    const authHeader = req.headers.get("Authorization") || ""
    const expectedAuth = `Bearer ${supabaseServiceKey}`
    if (!supabaseServiceKey || authHeader !== expectedAuth) {
      return new Response(JSON.stringify({ error: "Unauthorized: Internal function only." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = await req.json().catch(() => ({}))
    const email = body.email ? String(body.email).trim().toLowerCase() : ""
    const requestId = body.requestId ? String(body.requestId).trim() : ""
    const token = body.token ? String(body.token).trim() : ""

    if ((!email && !requestId) || !token) {
      return new Response(JSON.stringify({ error: "البريد الإلكتروني ورمز التحقق مطلوبان." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    let query = supabaseAdmin
      .from("registration_requests")
      .select("*")
      .eq("approval_status", "pending")

    if (requestId) {
      query = query.eq("id", requestId)
    } else {
      query = query.ilike("email", email)
    }

    const { data: request, error: fetchErr } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchErr || !request) {
      return new Response(JSON.stringify({ error: "لم يتم العثور على طلب تسجيل معلق لهذا الحساب." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (request.verification_status === "verified") {
      return new Response(JSON.stringify({
        success: true,
        message: "تم التحقق من البريد الإلكتروني مسبقاً والطلب قيد المراجعة.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check maximum failed attempts
    if (request.verification_attempts >= 5) {
      return new Response(JSON.stringify({
        error: "تم تجاوز الحد الأقصى للمحاولات الخاطئة. يرجى تقديم طلب تسجيل جديد.",
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check expiration (10 minutes)
    if (request.verification_token_expires_at && new Date(request.verification_token_expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({
        error: "انتهت صلاحية رمز التحقق (صلاحية الرمز 10 دقائق). يرجى طلب رمز جديد.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Compare token hash
    const inputHash = await hashToken(token)
    if (inputHash !== request.verification_token_hash) {
      await supabaseAdmin
        .from("registration_requests")
        .update({ verification_attempts: request.verification_attempts + 1 })
        .eq("id", request.id)

      return new Response(JSON.stringify({
        error: `رمز التحقق غير صحيح. تبقى لك ${4 - request.verification_attempts} محاولات.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Mark as verified
    const { error: updateErr } = await supabaseAdmin
      .from("registration_requests")
      .update({
        verification_status: "verified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)

    if (updateErr) throw updateErr

    // Audit log
    await supabaseAdmin.from("audit_logs").insert({
      user_id: request.telegram_user_id ? String(request.telegram_user_id) : "registration-challenge",
      user_email: request.email,
      action: `اكتمال التحقق من البريد الإلكتروني لطلب التسجيل: ${request.email}`,
      entity_type: "registration_verification",
      entity_id: request.id,
      details: { requestId: request.id, email: request.email },
    })

    return new Response(JSON.stringify({
      success: true,
      message: "تم التحقق من البريد الإلكتروني بنجاح! تم تحويل طلبك للإدارة للمراجعة والاعتماد.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Error"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
