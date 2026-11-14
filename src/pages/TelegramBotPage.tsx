import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Send,
  Bot,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  MessageSquare,
  Bell,
  HelpCircle,
  Copy,
  Info,
  Check,
} from 'lucide-react'
import {
  fetchTelegramBotSettings,
  saveTelegramBotSettings,
  DEFAULT_TELEGRAM_BOT_SETTINGS,
  type TelegramBotSettings,
} from '../lib/telegramSettingsRepository'
import type { LocalUserSession } from '../lib/localUsers'

type TelegramBotPageProps = {
  session?: Session | LocalUserSession | null
}

export default function TelegramBotPage({ session }: TelegramBotPageProps) {
  const [settings, setSettings] = useState<TelegramBotSettings>(DEFAULT_TELEGRAM_BOT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [showChatIdGuide, setShowChatIdGuide] = useState(false)

  // Get current admin name
  const adminName =
    (session && typeof session === 'object' && 'user' in session && (
      session.user?.user_metadata?.displayName ||
      session.user?.user_metadata?.name ||
      session.user?.user_metadata?.username ||
      session.user?.email?.split('@')[0]
    )) || 'مدير النظام'

  const [previewTime] = useState(() =>
    new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  )

  // Load settings on mount
  useEffect(() => {
    let mounted = true
    async function load() {
      setIsLoading(true)
      try {
        const data = await fetchTelegramBotSettings()
        if (mounted) setSettings(data)
      } catch (err) {
        console.error('Failed to load telegram bot settings:', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setIsSaving(true)
    setSaveSuccess(false)
    try {
      const updated = await saveTelegramBotSettings(settings, adminName)
      setSettings(updated)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetDefaults = () => {
    if (window.confirm('هل أنت متأكد من رغبتك في استعادة النصوص والرسائل الافتراضية للبوت؟')) {
      setSettings((prev) => ({
        ...prev,
        welcome_message: DEFAULT_TELEGRAM_BOT_SETTINGS.welcome_message,
        help_message: DEFAULT_TELEGRAM_BOT_SETTINGS.help_message,
        support_contact_text: DEFAULT_TELEGRAM_BOT_SETTINGS.support_contact_text,
        bot_status_notice: DEFAULT_TELEGRAM_BOT_SETTINGS.bot_status_notice,
      }))
    }
  }

  const botUrl = `https://t.me/${settings.bot_username || 'ZnuWarehouseBot'}`

  const copyBotLink = () => {
    navigator.clipboard.writeText(botUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Send size={22} className="translate-x-[-1px] translate-y-[-1px]" />
            </div>
            <div>
              <h1 className="text-xl font-black text-ink m-0">إدارة بوت تيليجرام التفاعلي</h1>
              <p className="text-xs text-muted mt-0.5 m-0">
                التحكم المباشر في رسائل الترحيب، تسجيل الموظفين، وإشعارات المشرفين الفورية
              </p>
            </div>
          </div>
        </div>

        {/* Quick Bot Link & Status Pill */}
        <div className="flex items-center gap-2.5">
          <span
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border ${
              settings.is_enabled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                settings.is_enabled ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            {settings.is_enabled ? 'البوت نشط ويعمل' : 'وضع الصيانة مؤقتاً'}
          </span>

          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-btn small flex items-center gap-1.5"
            title="فتح البوت في تطبيق تيليجرام"
          >
            <span>@{settings.bot_username || 'ZnuWarehouseBot'}</span>
            <ExternalLink size={13} />
          </a>

          <button
            type="button"
            onClick={copyBotLink}
            className="secondary-btn small"
            title="نسخ رابط البوت"
          >
            {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Success Notification Alert */}
      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>تم حفظ التعديلات بنجاح! التغييرات منعكسة الآن أوتوماتيكياً في محادثات تليجرام 🟢</span>
          </div>
          <span className="text-[11px] text-emerald-700 font-medium">محدث بقاعدة البيانات</span>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-muted text-sm">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full mb-2" />
          <p>جاري تحميل إعدادات بوت التيليجرام من قاعدة البيانات...</p>
        </div>
      ) : (
        <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Controls Column (7 Columns) */}
          <div className="lg:col-span-7 space-y-5">
            {/* 1. General Status Card */}
            <div className="card-surface p-5 space-y-4">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2 pb-2 border-b border-line">
                <Bot size={17} className="text-primary" />
                الحالة العامة والتحكم بالتشغيل
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Switch 1: Bot Enabled */}
                <label className="flex items-center justify-between p-3 rounded-xl border border-line bg-surface-soft cursor-pointer hover:border-primary/40 transition-colors">
                  <div>
                    <span className="text-xs font-bold text-ink block">تشغيل البوت العام</span>
                    <span className="text-[11px] text-muted">استقبال الرسائل وتفاعل الموظفين</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.is_enabled}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, is_enabled: e.target.checked }))
                    }
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                </label>

                {/* Switch 2: Allow Registration */}
                <label className="flex items-center justify-between p-3 rounded-xl border border-line bg-surface-soft cursor-pointer hover:border-primary/40 transition-colors">
                  <div>
                    <span className="text-xs font-bold text-ink block">استقبال طلبات التسجيل</span>
                    <span className="text-[11px] text-muted">السماح للموظفين بطلب حساب جديد</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.allow_registration}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, allow_registration: e.target.checked }))
                    }
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                </label>
              </div>

              {/* Bot Username input */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-ink block">
                  معرّف البوت في تيليجرام (Username بدون @):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted font-mono">@</span>
                  <input
                    type="text"
                    value={settings.bot_username}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, bot_username: e.target.value.trim() }))
                    }
                    placeholder="ZnuWarehouseBot"
                    className="w-full text-xs p-2.5 pl-7 border border-line rounded-xl bg-surface-soft outline-none focus:border-primary font-mono text-left"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>

            {/* 2. Welcome Message Card */}
            <div className="card-surface p-5 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2 m-0">
                  <MessageSquare size={17} className="text-primary" />
                  رسالة الترحيب الرئيسية (/start)
                </h3>
                <span className="text-[11px] text-muted font-mono">
                  {settings.welcome_message.length} حرف
                </span>
              </div>

              <p className="text-xs text-muted m-0">
                هذه الرسالة تظهر للموظف فور فتح البوت والضغط على زر <code>/start</code>.
              </p>

              <textarea
                rows={6}
                value={settings.welcome_message}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, welcome_message: e.target.value }))
                }
                className="w-full text-xs p-3 border border-line rounded-xl bg-surface-soft outline-none focus:border-primary leading-relaxed text-ink resize-y font-sans"
                placeholder="اكتب رسالة الترحيب وشروط التسجيل هنا..."
                required
              />
            </div>

            {/* 3. Help & Support Card */}
            <div className="card-surface p-5 space-y-4">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2 pb-2 border-b border-line">
                <HelpCircle size={17} className="text-primary" />
                رسالة المساعدة وبيانات الدعم الفني (/help)
              </h3>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink block">
                  نص المساعدة وقائمة الأوامر (/help):
                </label>
                <textarea
                  rows={4}
                  value={settings.help_message}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, help_message: e.target.value }))
                  }
                  className="w-full text-xs p-3 border border-line rounded-xl bg-surface-soft outline-none focus:border-primary leading-relaxed text-ink resize-y font-sans"
                  placeholder="أوامر البوت والتعليمات الإرشادية..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink block">
                  أرقام ووسائل الدعم الفني المعروضة:
                </label>
                <textarea
                  rows={3}
                  value={settings.support_contact_text}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, support_contact_text: e.target.value }))
                  }
                  className="w-full text-xs p-3 border border-line rounded-xl bg-surface-soft outline-none focus:border-primary leading-relaxed text-ink resize-y font-sans"
                  placeholder="الهاتف، الواتساب، البريد..."
                />
              </div>
            </div>

            {/* 4. Admin Notifications Card */}
            <div className="card-surface p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h3 className="text-sm font-bold text-ink flex items-center gap-2 m-0">
                  <Bell size={17} className="text-amber-500" />
                  إشعارات المشرفين اللحظية (Admin Notifications)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowChatIdGuide((prev) => !prev)}
                  className="text-xs text-primary hover:underline flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-md hover:bg-primary/10 transition-colors"
                  aria-expanded={showChatIdGuide}
                >
                  <Info size={14} aria-hidden="true" />
                  <span>كيف أحصل على معرف تليجرام؟</span>
                </button>
              </div>

              {/* Chat ID Guide Box */}
              {showChatIdGuide && (
                <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs space-y-1.5">
                  <p className="font-bold m-0">💡 كيفية معرفة الـ Chat ID الخاص بك على تليجرام:</p>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-blue-800 m-0 pr-1">
                    <li>افتح تطبيق تليجرام وابحث عن بوت مجاني مثل <code>@userinfobot</code> أو <code>@GetMyChatID_Bot</code>.</li>
                    <li>اضغط <strong>Start</strong> سيرسل لك رقم معرفك فوراً (مثل: <code>123456789</code>).</li>
                    <li>انسخ الرقم وضعه في الحقل أدناه لتصلك إشعارات فورية بكل طلب تسجيل جديد!</li>
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-ink block">
                  معرّف محادثة المشرف (Admin Chat ID):
                </label>
                <input
                  type="text"
                  value={settings.admin_chat_id}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, admin_chat_id: e.target.value.trim() }))
                  }
                  placeholder="مثال: 987654321"
                  className="w-full text-xs p-2.5 border border-line rounded-xl bg-surface-soft outline-none focus:border-primary font-mono text-left"
                  dir="ltr"
                />
                <span className="text-[11px] text-muted block">
                  سيقوم البوت بإرسال تنبيه فوري إلى هذا الحساب فور قيام أي موظف بتقديم طلب تسجيل جديد.
                </span>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-xs font-medium text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.notify_admin_on_registration}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        notify_admin_on_registration: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>إرسال إشعار فوري عند تقديم طلب تسجيل موظف جديد</span>
                </label>
              </div>
            </div>

            {/* 5. Maintenance Message (if disabled) */}
            {!settings.is_enabled && (
              <div className="card-surface p-5 space-y-2.5 border-rose-200 bg-rose-50/30">
                <h3 className="text-sm font-bold text-rose-800 flex items-center gap-2">
                  <AlertTriangle size={17} className="text-rose-600" />
                  رسالة التنبيه للموظفين عند إيقاف البوت مؤقتاً
                </h3>
                <textarea
                  rows={2}
                  value={settings.bot_status_notice}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, bot_status_notice: e.target.value }))
                  }
                  className="w-full text-xs p-2.5 border border-rose-200 rounded-xl bg-surface outline-none focus:border-rose-400 text-ink"
                />
              </div>
            )}

            {/* Form Action Buttons */}
            <div className="flex items-center justify-between gap-3 pt-3">
              <button
                type="submit"
                disabled={isSaving}
                className="primary-btn flex items-center gap-2 shadow-md"
              >
                {isSaving ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>جاري الحفظ والتطبيق الفوري...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>حفظ التعديلات وتطبيقها فوراً على البوت</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetDefaults}
                className="secondary-btn text-xs flex items-center gap-1.5"
              >
                <RotateCcw size={13} />
                <span>استعادة الافتراضي</span>
              </button>
            </div>
          </div>

          {/* Live Telegram Preview Simulator (5 Columns) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="sticky top-6">
              <div className="card-surface p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-line">
                  <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    معاينة حية كما تظهر في تطبيق تيليجرام
                  </span>
                  <span className="text-[10px] text-muted font-mono">Live Simulator</span>
                </div>

                {/* Simulated Smartphone Shell */}
                <div
                  className="rounded-3xl border-4 border-slate-700 bg-[#0f172a] shadow-2xl overflow-hidden max-w-sm mx-auto"
                  dir="rtl"
                >
                  {/* Phone Header bar */}
                  <div className="bg-[#1e293b] px-4 py-3 flex items-center justify-between text-white border-b border-slate-700/60">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-white font-bold text-xs shadow">
                        ZNU
                      </div>
                      <div>
                        <div className="text-xs font-bold leading-tight flex items-center gap-1">
                          <span>ZNU Warehouse Bot</span>
                          <span className="text-[9px] bg-sky-500/30 text-sky-300 px-1 rounded">bot</span>
                        </div>
                        <div className="text-[10px] text-sky-400">
                          {settings.is_enabled ? 'متصل الآن' : 'غير متصل (صيانة)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Chat Content Screen with Telegram wallpaper texture */}
                  <div className="p-3.5 space-y-3 min-h-[380px] max-h-[460px] overflow-y-auto bg-[#0b141a] text-slate-100 flex flex-col justify-end text-xs font-sans">
                    {/* User Command bubble */}
                    <div className="self-end max-w-[70%] bg-[#005c4b] text-white p-2.5 rounded-2xl rounded-bl-sm shadow text-xs">
                      <p className="m-0 font-mono">/start</p>
                      <span className="text-[9px] text-emerald-200 block text-left mt-0.5">
                        {previewTime}
                      </span>
                    </div>

                    {/* Bot Reply bubble */}
                    <div className="self-start max-w-[85%] bg-[#202c33] text-slate-100 p-3 rounded-2xl rounded-br-sm shadow space-y-2 border border-slate-700/40">
                      {settings.is_enabled ? (
                        <>
                          <div className="whitespace-pre-line text-[11.5px] leading-relaxed text-slate-200">
                            {settings.welcome_message}
                          </div>

                          {!settings.allow_registration && (
                            <div className="p-2 rounded-lg bg-amber-900/40 border border-amber-600/40 text-[10px] text-amber-200">
                              ⚠️ تنويه: باب التسجيل الإلكتروني مغلق مؤقتاً بناءً على تعليمات الإدارة.
                            </div>
                          )}

                          <span className="text-[9px] text-slate-400 block text-left">
                            {previewTime}
                          </span>

                          {/* Telegram Inline Button */}
                          {settings.allow_registration && (
                            <div className="pt-1">
                              <div className="w-full py-2 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-center text-xs shadow cursor-pointer transition-colors">
                                بدء التسجيل 📝
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-amber-300 text-xs leading-relaxed">
                          {settings.bot_status_notice}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Phone Footer */}
                  <div className="p-2.5 bg-[#1e293b] text-center text-[10px] text-slate-400 border-t border-slate-700/60">
                    يتم تحديث هذه الرسالة فوراً داخل تطبيق تليجرام عند الضغط على حفظ
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

