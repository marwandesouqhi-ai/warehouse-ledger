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
  Key,
  Database,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  ChevronLeft,
  Building2,
  Clock,
  Layers,
  DollarSign,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { findBestKnowledgeAnswer } from '../lib/chatbotKnowledge'
import {
  getLiveWarehouseContext,
  queryLiveItemAvailability,
  type LiveWarehouseContext,
} from '../lib/chatbotLiveContext'
import {
  hasGeminiApiKey,
  getGeminiApiKey,
  getGeminiKeySource,
  saveGeminiApiKeyLocal,
  clearGeminiApiKeyLocal,
  testGeminiConnection,
  askGeminiWithContext,
} from '../lib/geminiService'

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
  { label: '📋 طلبات الصرف والأذون', query: 'كيف أقدم طلب صرف داخلي؟' },
  { label: '🏢 مخازن وكليات الجامعة الـ 8', query: 'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟' },
  { label: '🛒 فواتير الشراء والموردين', query: 'كيف أسجل فاتورة شراء جديدة؟' },
  { label: '📝 عقود التوريد والصيانة', query: 'ما هي عقود التوريد السارية حالياً؟' },
  { label: '⚖️ محاضر الفحص والجرد', query: 'ما هو محضر الفحص والاستلام ومحضر الجرد؟' },
  { label: '📊 الميزانية والاعتمادات', query: 'ما هو موقف ميزانية الكليات والمصروفات؟' },
  { label: '🛡️ الصلاحيات والمستخدمين', query: 'ما هي الأدوار والصلاحيات في المنظومة؟' },
  { label: '🎧 الدعم الفني وتليجرام', query: 'كيف أتواصل مع الدعم الفني؟' },
]

export default function WarehouseChatBot({ session }: WarehouseChatBotProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // API Key settings state
  const [keyInput, setKeyInput] = useState('')
  const [showKeyText, setShowKeyText] = useState(false)
  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error'
    message: string
  }>({ status: 'idle', message: '' })

  // Live database context state
  const [liveContext, setLiveContext] = useState<LiveWarehouseContext | null>(null)
  const [isRefreshingLive, setIsRefreshingLive] = useState(false)

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
      const isGeminiActive = hasGeminiApiKey()
      setMessages([
        {
          id: 'welcome-1',
          sender: 'bot',
          text: `مرحباً بك يا ${userName} في المساعد الذكي لإدارة مخازن وتوريدات جامعة الزقازيق الأهلية 🎓\n\nأنا متزامن لحظياً مع قاعدة البيانات ولدي اطلاع كامل على أرصدة المخازن الـ 8، طلبات الصرف، عقود الموردين، والميزانيات.${isGeminiActive ? '\n\n✨ **نموذج Gemini AI مفعل ومتصل بالسياق الحي للمنظومة.**' : ''}\n\nيمكنك السؤال عن أي صنف، طلب صرف، أو إجراء مخزني، أو تكبير التابة لرؤية لوحة المزامنة الحية!`,
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

  // Key source info
  const keySource = getGeminiKeySource()
  const isKeyActive = hasGeminiApiKey()

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

    // Build history for Gemini
    const historyForAi = messages.slice(-4).map((m) => ({
      role: m.sender === 'user' ? ('user' as const) : ('model' as const),
      text: m.text,
    }))

    // Try Gemini if key is available
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
        console.warn('Gemini request failed, falling back to local database engine:', err)
      }
    }

    // Local smart engine with live DB querying
    setTimeout(() => {
      // 1. Direct item availability check in live database
      const liveItemMatch = queryLiveItemAvailability(text)

      let reply = ''
      let actionUrl: string | undefined
      let actionLabel: string | undefined
      let suggestedPrompts: string[] | undefined

      if (liveItemMatch) {
        reply = liveItemMatch
        actionUrl = '/movements'
        actionLabel = 'معاينة حركة الوارد والمنصرف'
        suggestedPrompts = [
          'كيف أقدم طلب صرف داخلي؟',
          'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
          'ما هي طلبات الصرف المعلقة الآن؟',
        ]
      } else {
        // 2. Knowledge base matching
        const match = findBestKnowledgeAnswer(text)
        if (match.entry && match.confidence >= 4) {
          reply = match.entry.answer
          actionUrl = match.entry.actionUrl
          actionLabel = match.entry.actionLabel
          suggestedPrompts = match.entry.suggestedPrompts
        } else {
          reply = `شكراً لاستفسارك يا ${userName}.\n\nلم أجد تطابقاً مباشراً لهذا السؤال في بنك المعرفة السريع.\n\n💡 **المقترحات المفيدة:**\n- يمكنك السؤال عن صنف محدد لمعرفة رصيده المتاح في المخازن الـ 8 فوراً (مثال: «هل يوجد لابتوب؟»).\n- أو الاستعلام عن لوائح الصرف، الجرد، الفحص، وفواتير التوريد.\n- للتواصل المباشر مع الدعم الفني: هاتف/واتساب \`01011488621\` أو إيميل \`marwandesowky2@gmail.com\`.`
          actionUrl = '/support'
          actionLabel = 'فتح تذكرة دعم فني مباشر'
          suggestedPrompts = [
            'ما هي مخازن وكليات الجامعة وأرصدتها الحالية؟',
            'كيف أقدم طلب صرف داخلي؟',
            'كيف أسجل فاتورة شراء جديدة؟',
          ]
        }
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
    }, 400)
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

  const handleSaveLocalKey = () => {
    if (!keyInput.trim()) return
    saveGeminiApiKeyLocal(keyInput.trim())
    setKeyInput('')
    setTestState({
      status: 'success',
      message: 'تم حفظ مفتاح Gemini API في التخزين المحلي لمتصفحك بنجاح! 🟢',
    })
  }

  const handleClearLocalKey = () => {
    clearGeminiApiKeyLocal()
    setKeyInput('')
    setTestState({
      status: 'idle',
      message: 'تم مسح المفتاح المحلي.',
    })
  }

  const handleTestKey = async () => {
    const keyToTest = keyInput.trim() || getGeminiApiKey() || undefined
    setTestState({ status: 'testing', message: 'جاري التحقق من صحة المفتاح مع سيرفرات Google...' })
    const res = await testGeminiConnection(keyToTest)
    if (res.success) {
      setTestState({ status: 'success', message: res.message })
    } else {
      setTestState({ status: 'error', message: res.message })
    }
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
                  {isKeyActive ? 'متصل بـ Gemini AI وقاعدة البيانات' : 'متصل بقاعدة البيانات (محلي)'}
                </span>
              </div>
            </div>

            <div className="chatbot-header-actions">
              {/* Gemini API Key Settings Button */}
              <button
                type="button"
                onClick={() => setShowSettings((prev) => !prev)}
                className={`chatbot-icon-btn ${showSettings ? 'active' : ''}`}
                title="إعدادات مفتاح Gemini API والسيكريتس"
              >
                <Key size={15} />
                {isKeyActive && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>

              {/* Maximize / Restore Toggle Button */}
              <button
                type="button"
                onClick={() => setIsMaximized((prev) => !prev)}
                className="chatbot-icon-btn"
                title={isMaximized ? 'استعادة الحجم المصغر' : 'تكبير النافذة لمشاهدة البيانات الحية'}
              >
                {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>

              {/* Reset Conversation Button */}
              <button
                type="button"
                onClick={handleResetConversation}
                className="chatbot-icon-btn"
                title="بدء محادثة جديدة وتحديث البيانات"
              >
                <RotateCcw size={15} />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  setShowSettings(false)
                }}
                className="chatbot-icon-btn"
                title="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Settings Overlay for Gemini API Key */}
          {showSettings && (
            <div className="chatbot-settings-overlay">
              <div className="chatbot-settings-card">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={20} className="text-primary" />
                    <h4 className="m-0 text-sm font-bold">إعدادات الربط مع Google Gemini AI</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="p-1 text-muted hover:text-ink rounded-lg"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-2.5 text-xs">
                  {/* Status Box */}
                  <div className="p-2.5 rounded-xl border border-line bg-surface-soft flex items-center justify-between">
                    <span className="font-semibold text-muted">حالة المفتاح الحالية:</span>
                    {keySource === 'env' && (
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 size={14} /> مفعل من ملف السيكريتس (.env.local)
                      </span>
                    )}
                    {keySource === 'local' && (
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 size={14} /> محفوظ محلياً في متصفحك
                      </span>
                    )}
                    {keySource === 'none' && (
                      <span className="text-amber-600 font-semibold flex items-center gap-1">
                        <AlertCircle size={14} /> غير مضبوط (يعمل المحرك المحلي)
                      </span>
                    )}
                  </div>

                  <p className="text-muted leading-relaxed m-0">
                    يمكنك إدخال مفتاح <strong>Google Gemini API</strong> هنا لحفظه بأمان في التخزين المحلي لمتصفحك، أو وضعه في ملف <code className="bg-surface px-1.5 py-0.5 rounded border border-line">.env.local</code> باسم <code className="bg-surface px-1.5 py-0.5 rounded border border-line">VITE_GEMINI_API_KEY</code> ولن يتم كشفه في Git أبداً.
                  </p>

                  <div className="flex flex-col gap-1.5 mt-1">
                    <label className="font-bold text-ink flex items-center gap-1">
                      <Key size={13} /> إدخال مفتاح API:
                    </label>
                    <div className="relative">
                      <input
                        type={showKeyText ? 'text' : 'password'}
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={
                          isKeyActive ? '••••••••••••••••••••••••••••••••' : 'AIzaSy...'
                        }
                        className="w-full pl-10 pr-3 py-2 text-xs bg-surface-soft border border-line rounded-xl outline-none focus:border-accent text-ink"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeyText((p) => !p)}
                        className="absolute left-2.5 top-2.5 text-muted hover:text-ink"
                        title={showKeyText ? 'إخفاء' : 'إظهار'}
                      >
                        {showKeyText ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {testState.message && (
                    <div
                      className={`p-2 rounded-lg text-xs flex items-center gap-1.5 ${
                        testState.status === 'success'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : testState.status === 'error'
                          ? 'bg-rose-50 text-rose-800 border border-rose-200'
                          : 'bg-blue-50 text-blue-800 border border-blue-200'
                      }`}
                    >
                      {testState.status === 'success' && <CheckCircle2 size={14} />}
                      {testState.status === 'error' && <AlertCircle size={14} />}
                      {testState.status === 'testing' && <RefreshCw size={14} className="animate-spin" />}
                      <span>{testState.message}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line">
                    <button
                      type="button"
                      onClick={handleSaveLocalKey}
                      disabled={!keyInput.trim()}
                      className="primary-btn small flex-1 flex items-center justify-center gap-1.5"
                    >
                      حفظ المفتاح محلياً
                    </button>
                    <button
                      type="button"
                      onClick={handleTestKey}
                      disabled={testState.status === 'testing' || (!keyInput.trim() && !isKeyActive)}
                      className="secondary-btn small flex items-center gap-1"
                    >
                      <RefreshCw size={13} className={testState.status === 'testing' ? 'animate-spin' : ''} />
                      اختبار الاتصال
                    </button>
                    {keySource === 'local' && (
                      <button
                        type="button"
                        onClick={handleClearLocalKey}
                        className="text-xs text-rose-600 hover:text-rose-700 px-2 py-1"
                      >
                        مسح
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area (Split when maximized) */}
          <div className="chatbot-main-content">
            {/* Live Database Sidebar Panel (Visible when maximized on tablet/desktop) */}
            {isMaximized && (
              <div className="chatbot-live-sidebar" dir="rtl">
                <div className="flex items-center justify-between pb-2 border-b border-line">
                  <div className="flex items-center gap-2">
                    <Database size={16} className="text-primary" />
                    <span className="text-xs font-bold text-ink">مزامنة قاعدة البيانات الحية</span>
                  </div>
                  <button
                    type="button"
                    onClick={loadFreshContext}
                    disabled={isRefreshingLive}
                    className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-soft transition-colors"
                    title="تحديث البيانات من السيرفر"
                  >
                    <RefreshCw size={13} className={isRefreshingLive ? 'animate-spin text-primary' : ''} />
                  </button>
                </div>

                {liveContext && (
                  <>
                    {/* Live KPIs */}
                    <div className="chatbot-sidebar-kpis">
                      <div className="chatbot-sidebar-kpi">
                        <span className="chatbot-sidebar-kpi-val flex items-center gap-1">
                          <Layers size={14} className="text-primary" />
                          {liveContext.totalItemsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="chatbot-sidebar-kpi-lbl">صنف مسجل بالمنظومة</span>
                      </div>

                      <div className="chatbot-sidebar-kpi">
                        <span className="chatbot-sidebar-kpi-val flex items-center gap-1">
                          <Clock size={14} className="text-amber-500" />
                          {liveContext.pendingRequestsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="chatbot-sidebar-kpi-lbl">طلب صرف معلق</span>
                      </div>

                      <div className="chatbot-sidebar-kpi">
                        <span className="chatbot-sidebar-kpi-val flex items-center gap-1">
                          <DollarSign size={14} className="text-emerald-600" />
                          {liveContext.activeContractsCount.toLocaleString('ar-EG')}
                        </span>
                        <span className="chatbot-sidebar-kpi-lbl">عقد توريد سارٍ</span>
                      </div>

                      <div className="chatbot-sidebar-kpi">
                        <span className="chatbot-sidebar-kpi-val flex items-center gap-1">
                          <Building2 size={14} className="text-indigo-500" />
                          8
                        </span>
                        <span className="chatbot-sidebar-kpi-lbl">مخازن وكليات مربوطة</span>
                      </div>
                    </div>

                    {/* Warehouses list */}
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
                            className="chatbot-warehouse-item"
                          >
                            <span className="font-semibold text-xs truncate max-w-[170px]">{wh.name}</span>
                            <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-bold">
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
                            className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                          >
                            عرض الكل <ChevronLeft size={11} />
                          </Link>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {liveContext.pendingRequests.slice(0, 3).map((r, i) => (
                            <div
                              key={i}
                              className="text-xs p-2 rounded-lg bg-surface border border-line flex items-center justify-between"
                            >
                              <div>
                                <span className="font-bold text-ink">{r.item}</span>
                                <span className="text-[10px] text-muted block">كلية {r.dept}</span>
                              </div>
                              <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
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
              {/* Messages Body */}
              <div className="chatbot-body">
                {messages.map((msg) => (
                  <div key={msg.id} className={`chatbot-msg-row ${msg.sender}`}>
                    <div className={`chatbot-bubble ${msg.sender}`}>
                      {msg.text}

                      {msg.actionUrl && (
                        <div>
                          <Link
                            to={msg.actionUrl}
                            onClick={() => setIsOpen(false)}
                            className="chatbot-action-link"
                          >
                            <span>{msg.actionLabel || 'الانتقال للصفحة'}</span>
                            <ExternalLink size={12} />
                          </Link>
                        </div>
                      )}

                      {msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-col gap-1.5">
                          <span className="text-[11px] text-muted font-bold flex items-center gap-1">
                            <HelpCircle size={11} /> أسئلة مقترحة:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.suggestedPrompts.map((p, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleSend(p)}
                                className="text-xs bg-muted/30 hover:bg-primary/10 hover:text-primary px-2 py-1 rounded-md text-right border border-border/40 transition-colors"
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
                      {msg.isAiGenerated && ' • بواسطة Gemini AI ✨'}
                    </span>
                  </div>
                ))}

                {isTyping && (
                  <div className="chatbot-typing">
                    <Sparkles size={14} className="animate-spin text-primary" />
                    <span>
                      {isKeyActive
                        ? 'Gemini يحلل بيانات المنظومة الحية ويجهز الإجابة...'
                        : 'المساعد يحلل استفسارك ويجهز الإجابة...'}
                    </span>
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
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="اسأل عن رصيد أي صنف، أو طلبات الصرف، العهدة، المخازن..."
                  className="chatbot-input"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="chatbot-send-btn"
                  title="إرسال"
                >
                  <Send size={16} />
                </button>
              </form>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
