import { useState, useRef, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bot,
  X,
  Send,
  Sparkles,
  RotateCcw,
  ExternalLink,
} from 'lucide-react'
import { Link } from 'react-router-dom'

type Message = {
  id: string
  sender: 'bot' | 'user'
  text: string
  timestamp: string
  actionUrl?: string
  actionLabel?: string
}

type WarehouseChatBotProps = {
  session?: Session | null
}

const KNOWLEDGE_RESPONSES: Record<string, string> = {
  'طلب صرف':
    'لتقديم طلب صرف داخلي جديد:\n1. توجه إلى صفحة "طلبات الصرف الداخلي" من القائمة الجانبية.\n2. اضغط على زر "طلب صرف جديد".\n3. حدد كليتك أو قسمك واسم الصنف والكمية والغرض.\n4. بعد الإرسال، يُراجع أمين المخزن الطلب ويعتمده لتوليد إذن الصرف الرسمي.',
  'فحص واستلام':
    'محضر الفحص والاستلام الفني:\nيتم إصداره لتوثيق فحص التوريدات الجديدة والتأكد من مطابقتها للمواصفات الفنية قبل إدخالها المستودع. يمكنك فتحه وتعبئته من صفحة "التقارير الرسمية" أو فواتير الشراء وطباعته معتمد بخاتم الجامعة.',
  'المخازن':
    'تضم جامعة الزقازيق الأهلية 8 مخازن رئيسية وفرعية:\n1. المخزن الرئيسي (قسم الوارد)\n2. كلية الهندسة\n3. كلية الطب البشري\n4. كلية الصيدلة\n5. كلية طب الأسنان\n6. كلية الحاسبات والذكاء الاصطناعي\n7. كلية العلوم\n8. كلية التمريض.\nتُدار كافة العهد والأرصدة عبر صفحة "عهدة المخازن".',
  'تليجرام':
    'يمكنك التواصل مع بوت تليجرام للمنظومة واستلام إشعارات التوريد والصرف الفورية عبر الرابط المباشر. كما يمكنك فتح تذكرة دعم فني من صفحة "الدعم الفني".',
  'جرد':
    'لتسوية الجرد السنوي والمطابقة:\nادخل على "التقارير الرسمية" ثم اختر "محضر التسوية الجردية والمطابقة الفعلية"، حدد المخزن، وقارن الرصيد الفعلي بالدفتري لحساب أي عجز أو فائض تلقائياً وطباعة المحضر المعتمد.',
  'عقود':
    'موديول "إدارة العقود" في قسم المشتريات يتيح لك متابعة عقود التوريد وتواريخ انتهائها ومبالغها، مع تنبيهات تلقائية قبل 30 يوماً من انتهاء العقد.',
  'ميزانية':
    'موديول "الميزانية والتخطيط" يتيح متابعة المخصص المالي لكل كلية وقسم، ونسبة المنصرف الفعلي، والفائض المتبقي المتاح للتوريدات الجديدة.',
}

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
          text: `مرحباً بك يا ${userName} في المساعد الذكي لإدارة مخازن جامعة الزقازيق الأهلية 🎓\nأنا هنا لمساعدتك في الاستفسار عن الأرصدة، طلبات الصرف، العقود، أو خطوات الفحص والجرد. كيف يمكنني خدمتك اليوم؟`,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
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
      let reply =
        'أفهم استفسارك جيداً. يمكنك مراجعة لوحة التحكم الرئيسية أو التقارير الرسمية لمزيد من التفاصيل، أو فتح تذكرة من صفحة الدعم الفني.'
      let actionUrl: string | undefined
      let actionLabel: string | undefined

      const lower = text.toLowerCase()

      if (lower.includes('صرف') || lower.includes('طلب')) {
        reply = KNOWLEDGE_RESPONSES['طلب صرف']
        actionUrl = '/requests'
        actionLabel = 'الانتقال إلى طلبات الصرف الداخلي'
      } else if (lower.includes('فحص') || lower.includes('استلام') || lower.includes('معاينة')) {
        reply = KNOWLEDGE_RESPONSES['فحص واستلام']
        actionUrl = '/reports'
        actionLabel = 'الانتقال إلى التقارير الرسمية'
      } else if (lower.includes('مخزن') || lower.includes('كليات') || lower.includes('عهدة')) {
        reply = KNOWLEDGE_RESPONSES['المخازن']
        actionUrl = '/custody'
        actionLabel = 'الانتقال إلى عهدة المخازن'
      } else if (lower.includes('تليجرام') || lower.includes('دعم') || lower.includes('تذكرة')) {
        reply = KNOWLEDGE_RESPONSES['تليجرام']
        actionUrl = '/support'
        actionLabel = 'فتح تذكرة دعم فني'
      } else if (lower.includes('جرد') || lower.includes('تسوية') || lower.includes('عجز')) {
        reply = KNOWLEDGE_RESPONSES['جرد']
        actionUrl = '/reports'
        actionLabel = 'الانتقال إلى كشوف الجرد'
      } else if (lower.includes('عقد') || lower.includes('عقود') || lower.includes('مورد')) {
        reply = KNOWLEDGE_RESPONSES['عقود']
        actionUrl = '/purchases/contracts'
        actionLabel = 'الانتقال إلى عقود الموردين'
      } else if (lower.includes('ميزانية') || lower.includes('موازنة') || lower.includes('تخطيط')) {
        reply = KNOWLEDGE_RESPONSES['ميزانية']
        actionUrl = '/budget'
        actionLabel = 'الانتقال إلى الميزانية والتخطيط'
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: reply,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
        actionUrl,
        actionLabel,
      }

      setMessages((prev) => [...prev, botMsg])
      setIsTyping(false)
    }, 600)
  }

  const quickPrompts = [
    'كيف أقدم طلب صرف داخلي؟',
    'ما هي مخازن وكليات الجامعة؟',
    'كيف يتم استخراج محضر الفحص؟',
    'كيف أتابع عقود الموردين والميزانية؟',
    'تواصل مع الدعم وبوت تليجرام',
  ]

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
                  <span className="chatbot-status-dot" /> متصل وجاهز للمساعدة
                </span>
              </div>
            </div>

            <div className="chatbot-header-actions">
              <button
                type="button"
                onClick={() =>
                  setMessages([
                    {
                      id: 'welcome-reset',
                      sender: 'bot',
                      text: `أهلاً بك مجدداً يا ${userName}! تم بدء جلسة محادثة جديدة. كيف يمكنني خدمتك؟`,
                      timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
                    },
                  ])
                }
                className="chatbot-icon-btn"
                title="إعادة ضبط المحادثة"
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
                        <span>{msg.actionLabel || 'الانتقال'}</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  )}
                </div>
                <span className="chatbot-timestamp">{msg.timestamp}</span>
              </div>
            ))}

            {isTyping && (
              <div className="chatbot-typing">
                <Sparkles size={14} className="animate-spin text-primary" />
                <span>المساعد يكتب الآن...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions pills */}
          <div className="chatbot-prompts-bar">
            {quickPrompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(prompt)}
                className="chatbot-prompt-pill"
              >
                {prompt}
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
              placeholder="اكتب سؤالك أو استفسارك هنا..."
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
