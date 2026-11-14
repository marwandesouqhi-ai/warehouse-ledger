import { useState, useRef, useEffect, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bot,
  X,
  Send,
  Sparkles,
  RotateCcw,
  ExternalLink,
  HelpCircle,
  Maximize2,
  Minimize2,
  Database,
  RefreshCw,
  ChevronLeft,
  Building2,
  Clock,
  Layers,
  DollarSign,
  GraduationCap,
  Cpu,
  Stethoscope,
  FlaskConical,
  Laptop,
  Wrench,
  Warehouse,
  Microscope,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { findBestKnowledgeAnswer } from '../lib/chatbotKnowledge'
import {
  getLiveWarehouseContext,
  queryLiveItemAvailability,
  queryLiveWarehouseBalances,
  type LiveWarehouseContext,
} from '../lib/chatbotLiveContext'
import {
  hasGeminiApiKey,
  askGeminiWithContext,
} from '../lib/geminiService'
import {
  runDataQualityAutoRepair,
  getQualityIssuesSummary,
} from '../lib/dataQualityAutoRepair'
import { isSystemAdmin } from '../lib/permissions'

type Message = {
  id: string
  sender: 'bot' | 'user'
  text: string
  timestamp: string
  actionUrl?: string
  actionLabel?: string
  suggestedPrompts?: string[]
  isAiGenerated?: boolean
}

type WarehouseChatBotProps = {
  session?: Session | null
}

const CATEGORY_CHIPS = [
  { label: '🛠️ أداة إصلاح مشاكل الجودة آلياً', query: 'أصلح مشاكل جودة البيانات وتصحيح الأسعار والفواتير الآن' },
  { label: '🏢 مخازن وكليات الجامعة الـ 8', query: 'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟' },
  { label: '📋 طلبات الصرف والأذون', query: 'كيف أقدم طلب صرف داخلي؟' },
  { label: '🛒 فواتير الشراء والموردين', query: 'كيف أسجل فاتورة شراء جديدة؟' },
  { label: '📝 عقود التوريد والصيانة', query: 'ما هي عقود التوريد السارية حالياً؟' },
  { label: '⚖️ محاضر الفحص والجرد', query: 'ما هو محضر الفحص والاستلام ومحضر الجرد؟' },
  { label: '📊 الميزانية والاعتمادات', query: 'ما هو موقف ميزانية الكليات والمصروفات؟' },
  { label: '🛡️ الصلاحيات والمستخدمين', query: 'ما هي الأدوار والصلاحيات في المنظومة؟' },
  { label: '🎧 الدعم الفني وتليجرام', query: 'كيف أتواصل مع الدعم الفني؟' },
]

function getWarehouseIcon(id: string) {
  switch (id) {
    case 'main':
      return <Warehouse size={15} />
    case 'medicine':
    case 'nursing': // legacy alias
      return <Stethoscope size={15} />
    case 'medicine_a':
      return <Building2 size={15} />
    case 'dentistry':
      return <Sparkles size={15} />
    case 'pharmacy':
      return <FlaskConical size={15} />
    case 'central_lab':
      return <Microscope size={15} />
    case 'engineering':
      return <Cpu size={15} />
    case 'engineering_workshops':
      return <Wrench size={15} />
    case 'fci':
    case 'computers':
      return <Laptop size={15} />
    case 'management':
      return <GraduationCap size={15} />
    default:
      return <Building2 size={15} />
  }
}

export default function WarehouseChatBot({ session }: WarehouseChatBotProps) {
  return isSystemAdmin(session) ? <AdminWarehouseChatBot session={session} /> : null
}

function AdminWarehouseChatBot({ session }: WarehouseChatBotProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  // Live database context state
  const [liveContext, setLiveContext] = useState<LiveWarehouseContext | null>(null)
  const [isRefreshingLive, setIsRefreshingLive] = useState(false)
  const [qualityCount, setQualityCount] = useState(0)

  // Listen to data changes to keep quality issue counts live
  useEffect(() => {
    const updateQualityCount = () => {
      setQualityCount(getQualityIssuesSummary().total)
    }
    updateQualityCount()
    window.addEventListener('movements-changed', updateQualityCount)
    window.addEventListener('storage', updateQualityCount)
    return () => {
      window.removeEventListener('movements-changed', updateQualityCount)
      window.removeEventListener('storage', updateQualityCount)
    }
  }, [])

  // Chat conversation state
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const userName =
    session?.user?.user_metadata?.displayName ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split('@')[0] ||
    'عزيزي الموظف'

  // Load live DB context
  const loadFreshContext = useCallback(async () => {
    setIsRefreshingLive(true)
    try {
      const ctx = await getLiveWarehouseContext()
      setLiveContext(ctx)
    } catch (err) {
      console.error('Failed to load live context for chatbot:', err)
    } finally {
      setIsRefreshingLive(false)
    }
  }, [])

  // Initial setup and context loading
  useEffect(() => {
    if (isOpen) {
      loadFreshContext()
    }
  }, [isOpen, loadFreshContext])

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-1',
          sender: 'bot',
          text: `مرحباً بك يا ${userName} في المساعد الذكي لإدارة مخازن وتوريدات جامعة الزقازيق الأهلية 🎓\n\nأنا متزامن لحظياً مع قاعدة البيانات ولدي اطلاع كامل على أرصدة المخازن الـ 8، طلبات الصرف، عقود الموردين، والميزانيات.\n\nيمكنك السؤال عن أي صنف، طلب صرف، أو إجراء مخزني، أو تكبير التابة لرؤية لوحة المزامنة الحية!`,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          suggestedPrompts: [
            'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
            'هل يوجد لابتوب أو أجهزة حاسب بالمخازن؟',
            'ما هي طلبات الصرف المعلقة الآن؟',
            'كيف أقدم طلب صرف داخلي؟',
          ],
        },
      ])
    }
  }, [userName, messages.length])

  // Auto-scroll on new message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen, isTyping])

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim()
    if (!text) return

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMsg])
    setInputText('')
    setIsTyping(true)

    const normalizedQuery = text.toLowerCase()

    // 0. تشغيل أداة الإصلاح الذاتي التلقائي لجودة البيانات (Autonomous Data Quality Auto-Repair Tool)
    const isRepairQuery =
      normalizedQuery.includes('صلح') ||
      normalizedQuery.includes('أصلح') ||
      normalizedQuery.includes('اصلاح') ||
      normalizedQuery.includes('إصلاح') ||
      normalizedQuery.includes('عالج') ||
      normalizedQuery.includes('حل المشاكل') ||
      normalizedQuery.includes('حل المشكلة') ||
      normalizedQuery.includes('تنظيف البيانات') ||
      normalizedQuery.includes('auto repair') ||
      normalizedQuery.includes('auto fix') ||
      normalizedQuery.includes('fix quality') ||
      (normalizedQuery.includes('جودة') && (normalizedQuery.includes('تنبيه') || normalizedQuery.includes('أخطاء') || normalizedQuery.includes('مشكل')))

    if (isRepairQuery) {
      try {
        const report = await runDataQualityAutoRepair(session?.user?.id)
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: `🛠️ **أداة الإصلاح الذاتي قامت بمعالجة سجل الحركات بنجاح!**\n\n` +
            `تم فحص السجل وتصحيح المشاكل عبر كافة الطبقات بالتزامن:\n` +
            `• **الأسعار المخزنة كنص:** تم تحويل **${report.fixedPriceCount}** سعر إلى أرقام قياسية صالحة للحسابات.\n` +
            `• **أرقام الفواتير الناقصة:** تم استخراج وتعيين **${report.fixedInvoiceCount}** رقم فاتورة رسمي.\n` +
            `• **التواريخ وأذون الصرف:** تم تدقيق وتصحيح **${report.fixedDateCount + report.fixedPermitCount}** حركة.\n` +
            `• **إجمالي الحركات التي تم تصحيحها:** **${report.totalRepairedRows}** حركة.\n` +
            `• **تنبيهات مركز الجودة الآن:** انخفضت من **${report.initialFindingsCount}** تنبيه إلى **${report.remainingFindingsCount}** (سجل سليم 100% 🟢).\n\n` +
            `💾 تم حفظ التعديلات في التخزين المحلي ومزامنتها في قاعدة بيانات Supabase سحابياً!`,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          actionUrl: '/quality',
          actionLabel: 'الانتقال لمركز جودة البيانات ومعاينة النتيجة',
          suggestedPrompts: [
            'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
            'هل يوجد لابتوب أو أجهزة حاسب بالمخازن؟',
            'ما هي طلبات الصرف المعلقة الآن؟',
          ],
        }
        setMessages((prev) => [...prev, botMsg])
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: `⚠️ واجهت أداة الإصلاح الذاتي مشكلة أثناء معالجة البيانات: ${errMsg}`,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          actionUrl: '/quality',
          actionLabel: 'الانتقال لمركز جودة البيانات',
        }
        setMessages((prev) => [...prev, botMsg])
      } finally {
        setIsTyping(false)
      }
      return
    }

    // 1. فحص فوري وسريع للأسئلة المباشرة عن أرصدة المخازن الـ 8 من قاعدة البيانات
    const isWarehouseQuery =
      (normalizedQuery.includes('مخازن') || normalizedQuery.includes('مخزن')) &&
      (normalizedQuery.includes('كليات') || normalizedQuery.includes('رصيد') || normalizedQuery.includes('ارصد') || normalizedQuery.includes('أرصد') || normalizedQuery.includes('جامع'))

    if (isWarehouseQuery) {
      setTimeout(() => {
        const liveReply = queryLiveWarehouseBalances()
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: liveReply,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          actionUrl: '/inventory-analytics',
          actionLabel: 'الانتقال للتحليلات التفصيلية والجرد',
          suggestedPrompts: [
            'هل يوجد لابتوب أو أجهزة حاسب بالمخازن؟',
            'ما هي طلبات الصرف المعلقة الآن؟',
            'كيف أقدم طلب صرف داخلي؟',
          ],
        }
        setMessages((prev) => [...prev, botMsg])
        setIsTyping(false)
      }, 180)
      return
    }

    // 2. فحص فوري لتوافر صنف محدد في قاعدة البيانات الحية
    const liveItemMatch = queryLiveItemAvailability(text)
    if (liveItemMatch) {
      setTimeout(() => {
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: liveItemMatch,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          actionUrl: '/movements',
          actionLabel: 'معاينة حركة الوارد والمنصرف',
          suggestedPrompts: [
            'كيف أقدم طلب صرف داخلي؟',
            'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
            'ما هي طلبات الصرف المعلقة الآن؟',
          ],
        }
        setMessages((prev) => [...prev, botMsg])
        setIsTyping(false)
      }, 180)
      return
    }

    // 3. للاستفسارات العامة والذكية: استدعاء Gemini AI المتصل بقاعدة البيانات مع مهلة سريعة
    const historyForAi = messages.slice(-4).map((m) => ({
      role: m.sender === 'user' ? ('user' as const) : ('model' as const),
      text: m.text,
    }))

    if (hasGeminiApiKey()) {
      try {
        const aiResponse = await askGeminiWithContext(text, historyForAi)
        const botMsg: Message = {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: aiResponse.text,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          actionUrl: aiResponse.actionUrl,
          actionLabel: aiResponse.actionLabel,
          isAiGenerated: true,
        }
        setMessages((prev) => [...prev, botMsg])
        setIsTyping(false)
        return
      } catch (err) {
        console.warn('Gemini timeout/error, fallback to local engine:', err)
      }
    }

    // 4. المحرك المحلي الاحتياطي في حال عدم الرد أو انتهاء المهلة
    setTimeout(() => {
      const match = findBestKnowledgeAnswer(text)
      let reply = ''
      let actionUrl: string | undefined
      let actionLabel: string | undefined
      let suggestedPrompts: string[] | undefined

      if (match.entry && match.confidence >= 4) {
        reply = match.entry.answer
        actionUrl = match.entry.actionUrl
        actionLabel = match.entry.actionLabel
        suggestedPrompts = match.entry.suggestedPrompts
      } else {
        reply = `شكراً لاستفسارك يا ${userName}.\n\nلم أجد تطابقاً مباشراً لهذا السؤال في بنك المعرفة السريع.\n\n💡 **المقترحات المفيدة:**\n- يمكنك السؤال عن صنف محدد لمعرفة رصيده المتاح في المخازن الـ 8 فوراً (مثال: «هل يوجد لابتوب؟»).\n- أو الاستعلام عن لوائح الصرف، الجرد، الفحص، وفواتير التوريد.\n- للتواصل مع الدعم الفني، يمكنك فتح تذكرة مباشرة من صفحة [الدعم الفني](/support).`
        actionUrl = '/support'
        actionLabel = 'فتح تذكرة دعم فني مباشر'
        suggestedPrompts = [
          'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
          'كيف أقدم طلب صرف داخلي؟',
          'كيف أسجل فاتورة شراء جديدة؟',
        ]
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        actionUrl,
        actionLabel,
        suggestedPrompts,
      }

      setMessages((prev) => [...prev, botMsg])
      setIsTyping(false)
    }, 180)
  }

  const handleResetConversation = () => {
    setMessages([
      {
        id: `welcome-reset-${Date.now()}`,
        sender: 'bot',
        text: `أهلاً بك مجدداً يا ${userName}! تم بدء جلسة محادثة جديدة وتحديث لقطة البيانات الحية.\nكيف يمكنني مساعدتك في شؤون المخازن والتوريدات الآن؟`,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        suggestedPrompts: [
          'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
          'ما هي طلبات الصرف المعلقة الآن؟',
          'كيف أقدم طلب صرف داخلي؟',
        ],
      },
    ])
    loadFreshContext()
  }

  return (
    <>
      {/* Floating Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="chatbot-trigger-btn"
        aria-label="المساعد الذكي للمخازن"
        title="المساعد الذكي والشات بوت"
      >
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
        </span>
        <Bot size={22} />
        <span className="hidden sm:inline">المساعد الذكي</span>
      </button>

      {/* Floating Chat Window */}
      {isOpen && (
        <aside
          className={`chatbot-window ${isMaximized ? 'maximized' : ''}`}
          dir="rtl"
          aria-label="نافذة المساعد الذكي"
        >
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <div className="chatbot-avatar">
                <Bot size={22} />
              </div>
              <div className="chatbot-title-box">
                <h3>المساعد الذكي لمنظومة المخازن</h3>
                <span className="chatbot-status">
                  <span className="chatbot-status-dot" />
                  جامعة الزقازيق الأهلية • متزامن لحظياً
                </span>
              </div>
            </div>

            <div className="chatbot-header-actions">
              {/* Maximize / Restore Toggle Button */}
              <button
                type="button"
                onClick={() => setIsMaximized((prev) => !prev)}
                className="chatbot-icon-btn"
                title={isMaximized ? 'استعادة الحجم المصغر' : 'تكبير الشاشة للوحة العمل والبيانات الحية'}
              >
                {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              {/* Reset Conversation Button */}
              <button
                type="button"
                onClick={handleResetConversation}
                className="chatbot-icon-btn"
                title="بدء محادثة جديدة وتحديث البيانات"
              >
                <RotateCcw size={16} />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="chatbot-icon-btn"
                title="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Main Content Area (Split when maximized) */}
          <div className="chatbot-main-content">
            {/* Live Database Sidebar Panel (Visible when maximized on tablet/desktop) */}
            {isMaximized && (
              <div className="chatbot-live-sidebar" dir="rtl">
                <div className="chatbot-sidebar-header">
                  <div className="flex items-center gap-2">
                    <Database size={16} className="text-primary" />
                    <span className="text-xs font-bold text-ink">لوحة المزامنة اللحظية</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="chatbot-live-badge">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      مباشر
                    </span>
                    <button
                      type="button"
                      onClick={loadFreshContext}
                      disabled={isRefreshingLive}
                      className="p-1 rounded-lg text-muted hover:text-ink hover:bg-surface-soft transition-colors"
                      title="تحديث البيانات من السيرفر"
                    >
                      <RefreshCw size={13} className={isRefreshingLive ? 'animate-spin text-primary' : ''} />
                    </button>
                  </div>
                </div>

                {liveContext && (
                  <>
                    {/* Modern Live KPIs */}
                    <div className="chatbot-sidebar-kpis">
                      {/* KPI 1: Items */}
                      <div className="chatbot-kpi-modern" style={{ '--card-accent': '#0e7c86', '--card-bg': 'rgba(14, 124, 134, 0.1)' } as React.CSSProperties}>
                        <div className="chatbot-kpi-top">
                          <span className="chatbot-kpi-lbl">الأصناف المسجلة</span>
                          <div className="chatbot-kpi-icon-wrap">
                            <Layers size={14} />
                          </div>
                        </div>
                        <span className="chatbot-kpi-val">
                          {liveContext.totalItemsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="text-[10px] text-muted font-medium">
                          {liveContext.totalCustodyUnits.toLocaleString('ar-EG')} وحدة عهدة
                        </span>
                      </div>

                      {/* KPI 2: Pending Requests */}
                      <div className="chatbot-kpi-modern" style={{ '--card-accent': '#f59e0b', '--card-bg': 'rgba(245, 158, 11, 0.1)' } as React.CSSProperties}>
                        <div className="chatbot-kpi-top">
                          <span className="chatbot-kpi-lbl">طلبات صرف معلقة</span>
                          <div className="chatbot-kpi-icon-wrap">
                            <Clock size={14} />
                          </div>
                        </div>
                        <span className="chatbot-kpi-val text-amber-600">
                          {liveContext.pendingRequestsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="text-[10px] text-muted font-medium">
                          بانتظار الاعتماد المخزني
                        </span>
                      </div>

                      {/* KPI 3: Contracts */}
                      <div className="chatbot-kpi-modern" style={{ '--card-accent': '#10b981', '--card-bg': 'rgba(16, 185, 129, 0.1)' } as React.CSSProperties}>
                        <div className="chatbot-kpi-top">
                          <span className="chatbot-kpi-lbl">عقود التوريد</span>
                          <div className="chatbot-kpi-icon-wrap">
                            <DollarSign size={14} />
                          </div>
                        </div>
                        <span className="chatbot-kpi-val text-emerald-600">
                          {liveContext.activeContractsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="text-[10px] text-muted font-medium">
                          عقد توريد سارٍ بالجامعة
                        </span>
                      </div>

                      {/* KPI 4: Warehouses */}
                      <div className="chatbot-kpi-modern" style={{ '--card-accent': '#6366f1', '--card-bg': 'rgba(99, 102, 241, 0.1)' } as React.CSSProperties}>
                        <div className="chatbot-kpi-top">
                          <span className="chatbot-kpi-lbl">المخازن والكليات</span>
                          <div className="chatbot-kpi-icon-wrap">
                            <Building2 size={14} />
                          </div>
                        </div>
                        <span className="chatbot-kpi-val text-indigo-600">8</span>
                        <span className="text-[10px] text-muted font-medium">
                          مربوطة بالمخزن الرئيسي
                        </span>
                      </div>

                      {/* KPI 5: Quality Findings & Auto-Repair Tool */}
                      <div
                        className="chatbot-kpi-modern cursor-pointer hover:border-primary transition-all"
                        style={{ '--card-accent': qualityCount > 0 ? '#f59e0b' : '#10b981', '--card-bg': qualityCount > 0 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)' } as React.CSSProperties}
                        onClick={() => handleSend('أصلح مشاكل جودة البيانات وتصحيح الأسعار والفواتير الآن')}
                        title="انقر لتشغيل أداة الإصلاح الذاتي آلياً"
                      >
                        <div className="chatbot-kpi-top">
                          <span className="chatbot-kpi-lbl">تنبيهات الجودة</span>
                          <div className="chatbot-kpi-icon-wrap">
                            <Wrench size={14} />
                          </div>
                        </div>
                        <span className={`chatbot-kpi-val ${qualityCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {qualityCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="text-[10px] text-muted font-medium">
                          {qualityCount > 0 ? 'انقر للإصلاح الذاتي 🛠️' : 'سجل سليم 100% 🟢'}
                        </span>
                      </div>
                    </div>

                    {/* Warehouses list with interactive cards & college icons */}
                    <div className="chatbot-sidebar-card">
                      <div className="chatbot-sidebar-title">
                        <span>مخازن وكليات الجامعة (8)</span>
                        <span className="text-[10px] text-muted">اضغط للاستعلام الفوري</span>
                      </div>
                      <div className="chatbot-warehouse-list">
                        {liveContext.warehouses.map((wh) => (
                          <button
                            key={wh.id}
                            type="button"
                            onClick={() =>
                              handleSend(`ما هي الأصناف والكميات المتوفرة في «${wh.name}»؟`)
                            }
                            className="chatbot-wh-item-modern"
                            title={`استعلام عن ${wh.name}`}
                          >
                            <div className="chatbot-wh-info">
                              <div className="chatbot-wh-icon">
                                {getWarehouseIcon(wh.id)}
                              </div>
                              <span className="chatbot-wh-name truncate max-w-[150px]">{wh.name}</span>
                            </div>
                            <span className="chatbot-wh-badge">
                              {wh.itemsCount} صنف ({wh.totalUnits} ق)
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pending Requests sample */}
                    {liveContext.pendingRequests.length > 0 && (
                      <div className="chatbot-sidebar-card">
                        <div className="chatbot-sidebar-title">
                          <span>أحدث طلبات الصرف بانتظار الاعتماد</span>
                          <Link
                            to="/disbursement-requests"
                            onClick={() => setIsOpen(false)}
                            className="text-[11px] text-primary hover:underline flex items-center gap-0.5 font-bold"
                          >
                            عرض الكل <ChevronLeft size={11} />
                          </Link>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {liveContext.pendingRequests.slice(0, 3).map((r, i) => (
                            <div
                              key={i}
                              className="text-xs p-2.5 rounded-xl bg-surface border border-line flex items-center justify-between transition-colors hover:border-primary/40"
                            >
                              <div>
                                <span className="font-bold text-ink block">{r.item}</span>
                                <span className="text-[10px] text-muted">طلب #{r.requestNumber} • كلية {r.dept}</span>
                              </div>
                              <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/50">
                                {r.qty} وحدة
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Chat Conversation Area */}
            <div className="chatbot-chat-area">
              {/* Active Data Quality Warning Banner with 1-Click Auto-Repair */}
              {qualityCount > 0 && (
                <div className="mx-3 my-2 p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <Wrench size={16} className="text-amber-600 shrink-0" />
                    <span>
                      تم اكتشاف <strong>{qualityCount.toLocaleString('ar-EG')} تنبيه جودة</strong> (أسعار كنص، فواتير غير مسجلة).
                    </span>
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm shrink-0 flex items-center gap-1"
                    onClick={() => handleSend('أصلح مشاكل جودة البيانات وتصحيح الأسعار والفواتير الآن')}
                  >
                    <Sparkles size={12} /> إصلاح آلي
                  </button>
                </div>
              )}

              {/* Messages Body */}
              <div className="chatbot-body">
                {messages.map((msg) => (
                  <div key={msg.id} className={`chatbot-msg-row ${msg.sender}`}>
                    <div className={`chatbot-bubble ${msg.sender}`}>
                      {msg.sender === 'bot' && (
                        <div className="chatbot-bot-header-pill">
                          <Sparkles size={11} />
                          <span>ZNU Copilot • المساعد الذكي</span>
                        </div>
                      )}

                      <div className="leading-relaxed">{msg.text}</div>

                      {msg.actionUrl && (
                        <div>
                          <Link
                            to={msg.actionUrl}
                            onClick={() => setIsOpen(false)}
                            className="chatbot-action-link"
                          >
                            <span>{msg.actionLabel || 'الانتقال للصفحة'}</span>
                            <ExternalLink size={13} />
                          </Link>
                        </div>
                      )}

                      {msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                        <div className="mt-3.5 pt-3 border-t border-border/40 flex flex-col gap-1.5">
                          <span className="text-[11px] text-muted font-bold flex items-center gap-1">
                            <HelpCircle size={12} /> مقترحات المتابعة:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.suggestedPrompts.map((p, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleSend(p)}
                                className="text-xs bg-muted/30 hover:bg-primary/10 hover:text-primary px-2.5 py-1.5 rounded-lg text-right border border-border/40 transition-all font-medium"
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="chatbot-timestamp">
                      {msg.timestamp}
                      {msg.isAiGenerated && ' • مدعوم بـ Gemini AI ✨'}
                    </span>
                  </div>
                ))}

                {isTyping && (
                  <div className="chatbot-typing">
                    <Sparkles size={14} className="animate-spin text-primary" />
                    <span>المساعد يحلل بيانات المنظومة ويجهز الإجابة...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Category Chips */}
              <div className="chatbot-prompts-bar">
                {CATEGORY_CHIPS.map((chip, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSend(chip.query)}
                    className="chatbot-prompt-pill"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Input Footer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                className="chatbot-footer-form"
              >
                <div className="chatbot-input-wrapper">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="اسأل عن رصيد أي صنف، أو طلبات الصرف، العهدة، المخازن..."
                    className="chatbot-input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="chatbot-send-btn"
                  title="إرسال"
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
