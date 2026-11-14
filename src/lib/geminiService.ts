/**
 * src/lib/geminiService.ts
 *
 * Secure client wrapper for the server-side `gemini-chat` Edge Function.
 * API keys are NEVER stored in the browser or bundled via `VITE_*` variables.
 */

import { queryLiveItemAvailability } from './chatbotLiveContext'
import { supabase } from './supabase'

export const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
]

export function getGeminiApiKey(): string | null {
  return null
}

export function getGeminiKeySource(): 'env' | 'local' | 'none' {
  return 'none'
}

export function saveGeminiApiKeyLocal(_key: string): void {
  // Client-side API key storage is permanently disabled for security; manage GEMINI_API_KEY in Supabase Secrets.
  try {
    localStorage.removeItem('znu_gemini_api_key_secure')
  } catch {
    // ignore
  }
}

export function clearGeminiApiKeyLocal(): void {
  try {
    localStorage.removeItem('znu_gemini_api_key_secure')
  } catch {
    // ignore
  }
}

export function hasGeminiApiKey(): boolean {
  return Boolean(supabase)
}

export async function testGeminiConnection(_keyToTest?: string): Promise<{ success: boolean; message: string }> {
  if (!supabase) {
    return { success: false, message: 'عميل الخادم السحابي غير مهيأ.' }
  }

  try {
    const { data, error } = await supabase.functions.invoke('gemini-chat', {
      body: {
        message: 'قل كلمة "مرحباً" فقط للتأكد من الاتصال.',
        history: [],
      },
    })

    if (error) {
      return { success: false, message: 'تعذر التحقق من خدمة المساعد الذكي على الخادم.' }
    }

    if (data && typeof data.text === 'string' && data.text.trim().length > 0) {
      return { success: true, message: 'خدمة المساعد الذكي (الخادم الآمن gemini-chat) تعمل بنجاح.' }
    }

    return { success: false, message: 'لم يرد المساعد الذكي باستجابة صالحة.' }
  } catch {
    return { success: false, message: 'تعذر الوصول إلى خدمة المساعد الذكي عبر الخادم.' }
  }
}

export async function askGeminiWithContext(
  userQuestion: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = []
): Promise<{ text: string; actionUrl?: string; actionLabel?: string }> {
  if (!supabase) {
    throw new Error('NO_API_KEY')
  }

  const itemLookup = queryLiveItemAvailability(userQuestion)
  let messageToSend = userQuestion
  if (itemLookup) {
    messageToSend = `${userQuestion}\n\n[بيانات متاحة من الجلسة الحالية حول الصنف المطلوب:\n${itemLookup}]`
  }

  const boundedHistory = history
    .slice(-8)
    .map((h) => ({ role: h.role, text: String(h.text || '').slice(0, 2000) }))

  const { data, error } = await supabase.functions.invoke('gemini-chat', {
    body: {
      message: messageToSend,
      history: boundedHistory,
    },
  })

  if (error) {
    throw new Error('تعذر الحصول على إجابة من المساعد الذكي في الوقت الحالي.')
  }

  const replyText =
    data && typeof data.text === 'string' && data.text.trim().length > 0
      ? data.text.trim()
      : 'عذراً، لم أتمكن من صياغة إجابة مناسبة حالياً.'

  return { text: replyText }
}
