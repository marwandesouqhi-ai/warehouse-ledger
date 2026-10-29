-- ==============================================================================
-- Migration: Create Telegram Bot Dynamic Settings Table
-- Description: Allows administrators to customize Telegram bot welcome messages,
--              status, admin notifications, and support contacts dynamically from the UI.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_bot_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    allow_registration BOOLEAN NOT NULL DEFAULT true,
    welcome_message TEXT NOT NULL DEFAULT 'أهلًا بك في نظام تسجيل الموظفين الخاص بـ ZNU-Warehouse-Ledger 🎓

يمكنك تقديم طلب إنشاء حساب جديد من خلال البوت.

بعد تسجيل بياناتك والتحقق من بريدك الإلكتروني، سيتم إرسال طلبك للمراجعة والموافقة من الإدارة.

لن يتم منحك صلاحيات النظام حتى تتم الموافقة على حسابك.',
    help_message TEXT NOT NULL DEFAULT '📌 أوامر بوت مخازن وتوريدات جامعة الزقازيق الأهلية:

/start - بدء تقديم طلب تسجيل حساب جديد
/status - متابعة حالة طلب التسجيل الخاص بك
/help - عرض رسالة المساعدة وقنوات الدعم الفني',
    support_contact_text TEXT NOT NULL DEFAULT 'الدعم الفني المباشر:
📞 هاتف / واتساب: 01011488621
✉️ بريد: marwandesowky2@gmail.com',
    admin_chat_id TEXT NOT NULL DEFAULT '',
    notify_admin_on_registration BOOLEAN NOT NULL DEFAULT true,
    notify_admin_on_disbursement BOOLEAN NOT NULL DEFAULT true,
    bot_status_notice TEXT NOT NULL DEFAULT 'عذراً، البوت في فترة تحديث وصيانة مجدولة حالياً. يُرجى مراجعة إدارة مخازن جامعة الزقازيق الأهلية.',
    bot_username TEXT NOT NULL DEFAULT 'ZnuWarehouseBot',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT DEFAULT ''
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.telegram_bot_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read bot settings (including Edge Function / anon)
DROP POLICY IF EXISTS "Allow read telegram bot settings for all" ON public.telegram_bot_settings;
CREATE POLICY "Allow read telegram bot settings for all"
    ON public.telegram_bot_settings FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

-- Allow authenticated users / admins to insert and update settings
DROP POLICY IF EXISTS "Allow write telegram bot settings for authenticated" ON public.telegram_bot_settings;
CREATE POLICY "Allow write telegram bot settings for authenticated"
    ON public.telegram_bot_settings FOR ALL
    TO authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- Grant privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_bot_settings TO anon, authenticated, service_role;

-- Seed default initial row if not exists
INSERT INTO public.telegram_bot_settings (id, is_enabled, allow_registration, updated_at)
VALUES ('default', true, true, NOW())
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

