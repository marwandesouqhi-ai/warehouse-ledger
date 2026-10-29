import { useState, useRef, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bot,
  X,
  Send,
  Sparkles,
  RotateCcw,
  ExternalLink,
  HelpCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { findBestKnowledgeAnswer } from '../lib/chatbotKnowledge'

type Message = {
  id: string
  sender: 'bot' | 'user'
  text: string
  timestamp: string
  actionUrl?: string
  actionLabel?: string
  suggestedPrompts?: string[]
}

type WarehouseChatBotProps = {
  session?: Session | null
}

const CATEGORY_CHIPS = [
  { label: '📋 طلبات الصرف والأذون', query: 'كيف أقدم طلب صرف داخلي؟' },
  { label: '🏢 مخازن وكليات الجامعة الـ 8', query: 'ما هي مخازن وكليات الجامعة؟' },
  { label: '🛒 فواتير الشراء والموردين', query: 'كيف أسجل فاتورة شراء جديدة؟' },
  { label: '📝 عقود التوريد والصيانة', query: 'كيف تدار عقود الموردين؟' },
  { label: '⚖️ محاضر الفحص والجرد', query: 'ما هو محضر الفحص والاستلام ومحضر الجرد؟' },
  { label: '📊 التحليلات والميزانية', query: 'كيف أتابع تحليلات المخزون والميزانية؟' },
  { label: '🛡️ الصلاحيات والمستخدمين', query: 'ما هي الأدوار والصلاحيات في المنظومة؟' },
  { label: '🎧 الدعم الفني وتليجرام', query: 'كيف أتواصل مع الدعم الفني؟' },
]

export default function WarehouseChatBot({ session }: WarehouseChatBotProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const userName =
    session?.user?.user_metadata?.displayName ||
    session?.user?.user_metadata?.name ||
    session?.user?.email?.split('@')[0] ||
    'عزيزي الموظف'

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-1',
          sender: 'bot',
          text: `مرحباً بك يا ${userName} في المساعد الذكي لإدارة مخازن وتوريدات جامعة الزقازيق الأهلية 🎓\n\nأنا مدرب بالكامل على كافة لوائح وإجراءات المخازن، دورة طلبات الصرف، محاضر الفحص والجرد، فواتير الشراء، عقود الموردين، والميزانيات.\n\nاختر أحد الموضوعات السريعة بالأسفل أو اكتب سؤالك مباشرة!`,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
          suggestedPrompts: [
            'كيف أقدم طلب صرف داخلي؟',
            'ما هي مخازن وكليات الجامعة؟',
            'كيف يتم عمل تسوية جردية سنوية؟',
            'أرقام التواصل مع الدعم الفني',
          ],
        },
      ])
    }
  }, [userName])

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen, isTyping])

  const handleSend = (textToSend?: string) => {
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
        reply = `شكراً لسؤالك. لم أجد تطابقاً مباشراً في بنك المعرفة لهذا الاستفسار المحدد.\n\n💡 **يمكنك اختيار أحد الموضوعات الأكثر شيوعاً:**\n- إجراءات طلبات الصرف والأذون المخزنية.\n- محاضر الفحص الفني والاستلام أو الجرد السنوي.\n- تسجيل فواتير الشراء وعقود الموردين.\n- أو التواصل المباشر مع الدعم الفني: هاتف/واتساب \`01011488621\` أو إيميل \`marwandesowky2@gmail.com\`.`
        actionUrl = '/support'
        actionLabel = 'فتح تذكرة دعم فني مباشر'
        suggestedPrompts = [
          'كيف أقدم طلب صرف داخلي؟',
          'ما هي مخازن وكليات الجامعة؟',
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
    }, 450)
  }

  const handleResetConversation = () => {
    setMessages([
      {
        id: `welcome-reset-${Date.now()}`,
        sender: 'bot',
        text: `أهلاً بك مجدداً يا ${userName}! تم بدء جلسة محادثة جديدة.\nكيف يمكنني مساعدتك في شؤون المخازن والتوريدات اليوم؟`,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        suggestedPrompts: [
          'كيف أقدم طلب صرف داخلي؟',
          'ما هي مخازن وكليات الجامعة؟',
          'كيف يتم عمل تسوية جردية سنوية؟',
        ],
      },
    ])
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

      {/* Floating Chat Window with Solid Opaque Background */}
      {isOpen && (
        <aside
          className="chatbot-window"
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
                <h3>المساعد الذكي للمنظومة</h3>
                <span className="chatbot-status">
                  <span className="chatbot-status-dot" /> خبير المخازن والتوريدات جاهز
                </span>
              </div>
            </div>

            <div className="chatbot-header-actions">
              <button
                type="button"
                onClick={handleResetConversation}
                className="chatbot-icon-btn"
                title="بدء محادثة جديدة"
              >
                <RotateCcw size={15} />
              </button>
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

          {/* Messages Body */}
          <div className="chatbot-body">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chatbot-msg-row ${msg.sender}`}
              >
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
                <span className="chatbot-timestamp">{msg.timestamp}</span>
              </div>
            ))}

            {isTyping && (
              <div className="chatbot-typing">
                <Sparkles size={14} className="animate-spin text-primary" />
                <span>المساعد يحلل استفسارك ويجهز الإجابة...</span>
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
              placeholder="اسأل عن الصرف، الجرد، الفحص، العهدة، العقود..."
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
        </aside>
      )}
    </>
  )
}
