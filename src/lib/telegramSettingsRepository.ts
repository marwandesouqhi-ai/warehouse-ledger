/**
 * src/lib/telegramSettingsRepository.ts
 *
 * إدارة ومزامنة إعدادات بوت التيليجرام في قاعدة البيانات (Supabase) والتخزين المحلي.
 */

import { supabase } from './supabase'

export type TelegramBotSettings = {
  id: string
  is_enabled: boolean
  allow_registration: boolean
  welcome_message: string
  help_message: string
  support_contact_text: string
  admin_chat_id: string
  notify_admin_on_registration: boolean
  notify_admin_on_disbursement: boolean
  bot_status_notice: string
  bot_username: string
  updated_at?: string
  updated_by?: string
}

export const DEFAULT_TELEGRAM_BOT_SETTINGS: TelegramBotSettings = {
  id: 'default',
  is_enabled: true,
  allow_registration: true,
  welcome_message: `أهلًا بك في نظام تسجيل الموظفين الخاص بـ ZNU-Warehouse-Ledger 🎓

يمكنك تقديم طلب إنشاء حساب جديد من خلال البوت.

بعد تسجيل بياناتك والتحقق من بريدك الإلكتروني، سيتم إرسال طلبك للمراجعة والموافقة من الإدارة.

لن يتم منحك صلاحيات النظام حتى تتم الموافقة على حسابك.`,
  help_message: `📌 أوامر بوت مخازن وتوريدات جامعة الزقازيق الأهلية:

/start - بدء تقديم طلب تسجيل حساب جديد
/status - متابعة حالة طلب التسجيل الخاص بك
/help - عرض رسالة المساعدة وقنوات الدعم الفني`,
  support_contact_text: `الدعم الفني المباشر:
📞 هاتف / واتساب: 01011488621
✉️ بريد: marwandesowky2@gmail.com`,
  admin_chat_id: '',
  notify_admin_on_registration: true,
  notify_admin_on_disbursement: true,
  bot_status_notice: 'عذراً، البوت في فترة تحديث وصيانة مجدولة حالياً. يُرجى مراجعة إدارة مخازن جامعة الزقازيق الأهلية.',
  bot_username: 'ZnuWarehouseBot',
}

const STORAGE_KEY = 'znu_telegram_bot_settings'

/**
 * جلب أحدث إعدادات البوت من قاعدة البيانات
 */
export async function fetchTelegramBotSettings(): Promise<TelegramBotSettings> {
  // 1. محاولة الجلب من التخزين المحلي أولاً كـ Cache سريع
  let localData: TelegramBotSettings = DEFAULT_TELEGRAM_BOT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      localData = { ...DEFAULT_TELEGRAM_BOT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch {
    //
  }

  // 2. الجلب من Supabase إذا كان متوفراً
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('telegram_bot_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle()

      if (!error && data) {
        const merged = { ...DEFAULT_TELEGRAM_BOT_SETTINGS, ...data }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
        return merged
      }
    } catch (err) {
      console.warn('Could not fetch telegram bot settings from cloud, using cached:', err)
    }
  }

  return localData
}

/**
 * حفظ وتحديث إعدادات البوت في قاعدة البيانات فورياً
 */
export async function saveTelegramBotSettings(
  updates: Partial<TelegramBotSettings>,
  adminName?: string
): Promise<TelegramBotSettings> {
  const current = await fetchTelegramBotSettings()
  const payload: TelegramBotSettings = {
    ...current,
    ...updates,
    id: 'default',
    updated_at: new Date().toISOString(),
    updated_by: adminName || current.updated_by || 'مدير النظام',
  }

  // حفظ محلي أولاً لضمان عدم الضياع
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    //
  }

  // حفظ في Supabase ليظهر في البوت فوراً
  if (supabase) {
    try {
      const { error } = await supabase
        .from('telegram_bot_settings')
        .upsert(payload, { onConflict: 'id' })

      if (error) {
        console.error('Failed to save telegram bot settings to Supabase:', error)
      }
    } catch (err) {
      console.error('Error saving telegram bot settings:', err)
    }
  }

  return payload
}

