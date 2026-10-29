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
        'أفهم استفسارك جيداً. يمكنك مراجعة لوحة التحكم الرئيسية أو التقارير الرسمية لمزيد من التفاصيل، أو التواصل مع فريق الدعم الفني مباشرة.'
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
    }, 700)
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
        className="fixed bottom-6 left-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-full shadow-2xl bg-gradient-to-r from-teal-700 to-teal-900 text-white hover:scale-105 active:scale-95 transition-all border-2 border-white/20"
        aria-label="المساعد الذكي للمخازن"
        title="المساعد الذكي والشات بوت"
      >
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
        </span>
        <Bot size={22} className="animate-pulse" />
        <span className="font-bold text-sm hidden sm:inline">المساعد الذكي</span>
      </button>

      {/* Floating Chat Window */}
      {isOpen && (
        <div
          className="fixed bottom-20 left-4 sm:left-6 z-50 w-[94vw] sm:w-[400px] h-[550px] max-h-[85vh] bg-card rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200"
          dir="rtl"
        >
          {/* Chat Header */}
          <div className="bg-gradient-to-r from-teal-800 to-teal-950 text-white p-4 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
                <Bot size={22} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base leading-tight">المساعد الذكي للمنظومة</h3>
                <span className="text-xs text-emerald-300 flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> متصل وجاهز للمساعدة
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
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
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="إعادة ضبط المحادثة"
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="تصغير"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-muted/10 text-sm">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl p-3 shadow-sm leading-relaxed whitespace-pre-line ${
                    msg.sender === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-xs'
                      : 'bg-card border border-border text-foreground rounded-bl-xs'
                  }`}
                >
                  {msg.text}

                  {msg.actionUrl && (
                    <div className="mt-2.5 pt-2 border-t border-border/50">
                      <Link
                        to={msg.actionUrl}
                        onClick={() => setIsOpen(false)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline bg-primary/10 px-2.5 py-1 rounded"
                      >
                        <span>{msg.actionLabel || 'الانتقال'}</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted mt-1 px-1">{msg.timestamp}</span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 text-muted text-xs p-2 bg-card rounded-xl border border-border w-fit">
                <Sparkles size={14} className="animate-spin text-primary" />
                <span>المساعد يكتب الآن...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions */}
          <div className="p-2 border-t border-border bg-card/80 overflow-x-auto whitespace-nowrap flex gap-1.5 text-xs scrollbar-none">
            {quickPrompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(prompt)}
                className="px-2.5 py-1 rounded-full bg-muted hover:bg-primary/10 hover:text-primary border border-border transition-all shrink-0 text-right"
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
            className="p-3 bg-card border-t border-border flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="اكتب سؤالك أو استفسارك هنا..."
              className="flex-1 p-2.5 text-sm bg-muted/40 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-2.5 bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity"
              title="إرسال"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
