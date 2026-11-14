import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

async function hashTokenWithPepper(token: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder()
  const input = `${pepper}:${token.trim()}`
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: jsonHeaders,
    })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const otpPepper = (Deno.env.get("OTP_PEPPER") ?? "").trim()

    // Security Restriction: verify-email is an internal server-side function only.
    const authHeader = (req.headers.get("Authorization") || "").trim()
    const expectedAuth = `Bearer ${supabaseServiceKey}`
    if (!supabaseServiceKey || !otpPepper || !timingSafeEqual(authHeader, expectedAuth)) {
      return new Response(JSON.stringify({ error: "Unauthorized: Internal function only." }), {
        status: 401,
        headers: jsonHeaders,
      })
    }

    const body = await req.json().catch(() => ({}))
    const email = body.email ? String(body.email).trim().toLowerCase() : ""
    const requestId = body.requestId ? String(body.requestId).trim() : ""
    const token = body.token ? String(body.token).trim() : ""

    if ((!email && !requestId) || !/^\d{6}$/.test(token)) {
      return new Response(JSON.stringify({ error: "البريد الإلكتروني ورمز التحقق الصالح مطلوبان." }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    let query = supabaseAdmin
      .from("registration_requests")
      .select("id, email, telegram_user_id, verification_status, approval_status")
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
        headers: jsonHeaders,
      })
    }

    if (request.verification_status === "verified") {
      return new Response(JSON.stringify({
        success: true,
        message: "تم التحقق من البريد الإلكتروني مسبقاً والطلب قيد المراجعة.",
      }), {
        status: 200,
        headers: jsonHeaders,
      })
    }

    // Atomic attempt increment & expiry enforcement via DB RPC
    const { data: attemptRows, error: rpcErr } = await supabaseAdmin.rpc("record_verification_attempt", {
      p_request_id: request.id,
      p_telegram_user_id: request.telegram_user_id,
    })

    if (rpcErr || !attemptRows || attemptRows.length === 0) {
      return new Response(JSON.stringify({
        error: "تعذر التحقق: تم تجاوز الحد الأقصى للمحاولات أو انتهت صلاحية الرمز.",
      }), {
        status: 429,
        headers: jsonHeaders,
      })
    }

    const attemptResult = attemptRows[0]
    const storedHash = String(attemptResult.token_hash || "")
    const currentAttempts = Number(attemptResult.attempts || 1)

    const inputHash = await hashTokenWithPepper(token, otpPepper)
    if (!storedHash || !timingSafeEqual(inputHash, storedHash)) {
      return new Response(JSON.stringify({
        error: `رمز التحقق غير صحيح. تبقى لك ${Math.max(0, 5 - currentAttempts)} محاولات.`,
      }), {
        status: 400,
        headers: jsonHeaders,
      })
    }

    // Mark as verified and clear token hash atomically
    await supabaseAdmin.rpc("mark_verification_verified", {
      p_request_id: request.id,
      p_telegram_user_id: request.telegram_user_id,
    })

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
      headers: jsonHeaders,
    })
  } catch (err: unknown) {
    console.error("verify-email error:", err instanceof Error ? err.message : "Internal Error")
    return new Response(JSON.stringify({ error: "حدث خطأ غير متوقع." }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
