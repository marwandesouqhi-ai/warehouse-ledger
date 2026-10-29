import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Bot,
  Code2,
  Database,
  Key,
  ShieldAlert,
  Play,
  RotateCw,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  FileCode,
  Terminal,
  Activity,
  Layers,
  Wrench,
  BookOpen,
} from 'lucide-react'
import { isSystemAdmin } from '../lib/permissions'
import {
  getGeminiApiKey,
  saveGeminiApiKeyLocal,
  clearGeminiApiKeyLocal,
  testGeminiConnection,
  CANDIDATE_MODELS,
  askGeminiWithContext,
} from '../lib/geminiService'
import { getLiveWarehouseContext } from '../lib/chatbotLiveContext'
import { runDataQualityAutoRepair, getQualityIssuesSummary } from '../lib/dataQualityAutoRepair'
import { supabase } from '../lib/supabase'
import { logAuditEvent } from '../lib/auditLogger'

type ChatbotAdminPageProps = {
  session?: Session | null
}

export default function ChatbotAdminPage({ session }: ChatbotAdminPageProps) {
  const isAdmin = isSystemAdmin(session)

  // Tabs
  const [activeTab, setActiveTab] = useState<'api_settings' | 'architecture' | 'code_sandbox' | 'diagnostics'>('code_sandbox')

  // API Key State
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [isTestingKey, setIsTestingKey] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [selectedModel, setSelectedModel] = useState(CANDIDATE_MODELS[0])
  const [temperature, setTemperature] = useState(0.2)
  const [customDirectives, setCustomDirectives] = useState(
    localStorage.getItem('znu_chatbot_custom_developer_directives') ||
    'أنت محرر أكواد ومبرمج خبير (Senior Full-Stack Developer & DBA) لمنظومة Warehouse Ledger. نفّذ دائماً التعديلات بالتزامن في الفرونت والباك إند وقاعدة البيانات. لا تقم أبداً بعمل نشر على Vercel.'
  )
  const [saveDirectivesNotice, setSaveDirectivesNotice] = useState('')

  // Code & SQL Sandbox State
  const [developerPrompt, setDeveloperPrompt] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  // Diagnostics State
  const [tableStats, setTableStats] = useState<Record<string, number>>({})
  const [loadingStats, setLoadingStats] = useState(false)
  const [repairRunning, setRepairRunning] = useState(false)
  const [repairResult, setRepairResult] = useState<{ repairedCount: number; message: string } | null>(null)
  const [liveContextPayload, setLiveContextPayload] = useState<string>('')

  useEffect(() => {
    const existingKey = getGeminiApiKey()
    if (existingKey) {
      setApiKeyInput(existingKey)
    }
    void loadDatabaseStats()
  }, [])

  async function loadDatabaseStats() {
    setLoadingStats(true)
    try {
      if (supabase) {
        const { data } = await supabase.rpc('get_system_backup_stats')
        if (data && typeof data === 'object') {
          setTableStats(data as Record<string, number>)
        }
      }
      const ctx = await getLiveWarehouseContext()
      setLiveContextPayload(JSON.stringify(ctx, null, 2))
    } catch {
      // ignore
    } finally {
      setLoadingStats(false)
    }
  }

  async function handleTestConnection() {
    setIsTestingKey(true)
    setTestResult(null)
    try {
      const res = await testGeminiConnection(apiKeyInput)
      setTestResult(res)
      if (res.success && apiKeyInput) {
        saveGeminiApiKeyLocal(apiKeyInput)
      }
    } finally {
      setIsTestingKey(false)
    }
  }

  function handleSaveApiKey() {
    if (!apiKeyInput.trim()) {
      clearGeminiApiKeyLocal()
      setTestResult({ success: false, message: 'تم مسح المفتاح المحلي.' })
    } else {
      saveGeminiApiKeyLocal(apiKeyInput)
      setTestResult({ success: true, message: 'تم حفظ مفتاح API بنجاح في المتصفح.' })
    }
  }

  function handleSaveDirectives() {
    localStorage.setItem('znu_chatbot_custom_developer_directives', customDirectives)
    setSaveDirectivesNotice('تم حفظ تعليمات المبرمج الذكي بنجاح!')
    setTimeout(() => setSaveDirectivesNotice(''), 4000)
  }

  async function handleGenerateCode() {
    if (!developerPrompt.trim()) return
    setIsGenerating(true)
    setGeneratedCode('')

    const promptText = `بصفتك مبرمج ومطور خبير في منظومة Warehouse Ledger، قم بإنشاء الكود اللازم لتنفيذ الطلب التالي بدقة:
الطلب: "${developerPrompt.trim()}"

شروط ومواصفات الإخراج البرمجي:
1. اذكر التعديلات عبر الطبقات الثلاث بالتزامن:
   - Frontend (React 18 / TypeScript / Tailwind)
   - Backend (Supabase RPC أو Edge Functions)
   - Database (PostgreSQL Migration مع RLS Policies و Indexes)
2. اكتب الكود نظيفاً وكاملاً مع أسماء الجداول الحقيقية للمنظومة.
3. التزم بعدم عمل ديبلوى على Vercel نهائياً والحفاظ على حسابات النظام المشرف.`

    try {
      const response = await askGeminiWithContext(promptText)
      setGeneratedCode(response.text)

      void logAuditEvent({
        action: `توليد كود برمجي عبر محرر الشات بوت: ${developerPrompt.slice(0, 50)}...`,
        entity_type: 'chatbot_developer',
        details: { prompt: developerPrompt },
        user: session?.user,
      })
    } catch (err) {
      setGeneratedCode(`خطأ أثناء توليد الكود: ${err instanceof Error ? err.message : 'تعذر الاتصال بالنموذج'}`)
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleRunSelfRepair() {
    setRepairRunning(true)
    setRepairResult(null)
    try {
      const res = await runDataQualityAutoRepair(session?.user?.id)
      setRepairResult({ repairedCount: res.totalRepairedRows, message: res.message })
      await loadDatabaseStats()
    } finally {
      setRepairRunning(false)
    }
  }

  function copyCodeToClipboard() {
    if (!generatedCode) return
    void navigator.clipboard.writeText(generatedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (!isAdmin) {
    return (
      <section className="page-stack">
        <div className="card-surface p-12 text-center text-muted max-w-lg mx-auto">
          <ShieldAlert size={48} className="text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-bold text-ink mb-2">منطقة مخصصة لمدير النظام فقط</h2>
          <p className="text-xs text-muted mb-4">
            صفحة إدارة وتوجيه المساعد الذكي كمحرر أكواد ومبرمج مقتصرة حصرياً على مدير النظام (System Admin).
          </p>
        </div>
      </section>
    )
  }

  const qualitySummary = getQualityIssuesSummary()

  return (
    <section className="page-stack">
      {/* Header */}
      <header className="page-intro">
        <div className="page-intro-icon">
          <Bot size={24} />
        </div>
        <div>
          <p className="eyebrow">الإدارة والأمان • الذكاء الاصطناعي</p>
          <h2>إدارة وتوجيه المساعد الذكي (AI Developer & Code Editor)</h2>
          <p>توجيه المساعد كمحرر أكواد ومبرمج خبير، إدارة مفاتيح ونماذج Gemini، فحص معمارية الجداول، وتوليد الأكواد والهجرات</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b gap-2 pb-2 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab('code_sandbox')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'code_sandbox' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted hover:text-foreground'
          }`}
        >
          <Code2 size={16} /> منصة البرمجة وتوليد الأكواد
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('architecture')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'architecture' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted hover:text-foreground'
          }`}
        >
          <Layers size={16} /> معمارية المنظومة والجداول (Architecture)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('diagnostics')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'diagnostics' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted hover:text-foreground'
          }`}
        >
          <Wrench size={16} /> الإصلاح الذاتي والتشخيص (Self-Repair)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('api_settings')}
          className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 ${
            activeTab === 'api_settings' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted hover:text-foreground'
          }`}
        >
          <Sliders size={16} /> إعدادات نماذج Gemini ومفتاح API
        </button>
      </div>

      {/* TAB 1: CODE & SQL SANDBOX */}
      {activeTab === 'code_sandbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="card-surface p-5 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-semibold text-sm flex items-center gap-2">
                  <Terminal size={17} className="text-primary" />
                  محرر أوامر التطوير البرمجي
                </span>
                <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">
                  Full-Stack AI DBA
                </span>
              </div>

              <label className="flex flex-col gap-1 text-xs font-semibold">
                ما التعديل أو الميزة المطلوب برمجتها وتوليد أكوادها؟
                <textarea
                  rows={4}
                  value={developerPrompt}
                  onChange={(e) => setDeveloperPrompt(e.target.value)}
                  placeholder="مثال: إنشاء جدول جديد لتصاريح زيارة المخزن مع عمود اسم الزائر والجهة، وسياسات RLS، ودالة RPC لإغلاق التصريح..."
                  className="p-3 border rounded text-xs leading-relaxed bg-background font-mono"
                />
              </label>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleGenerateCode}
                  disabled={isGenerating || !developerPrompt.trim()}
                  className="primary-btn w-full inline-flex items-center justify-center gap-2 py-2 text-xs font-bold"
                >
                  {isGenerating ? (
                    <>
                      <RotateCw size={15} className="animate-spin" /> جارٍ التحليل البرمجي وتوليد الكود...
                    </>
                  ) : (
                    <>
                      <Play size={15} /> توليد وتجهيز الكود (Frontend & DB)
                    </>
                  )}
                </button>
              </div>

              {/* Suggestions */}
              <div className="border-t pt-3">
                <span className="text-[11px] text-muted block mb-2 font-semibold">قوالب تطوير سريعة:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'إضافة حقل رقم السجل التجاري لجدول الموردين',
                    'إنشاء دالة لحساب متوسط فترة التوريد لكل مورد',
                    'كود التحقق من انتهاء صلاحية العقد قبل إذن الصرف',
                    'إضافة جدول لتسجيل الصيانة الدورية للأجهزة',
                  ].map((sugg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDeveloperPrompt(sugg)}
                      className="text-[10px] bg-muted/40 hover:bg-muted p-1.5 rounded transition-colors text-right"
                    >
                      {sugg}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Directives */}
            <div className="card-surface p-5 space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <BookOpen size={15} className="text-primary" />
                  التعليمات البرمجية الدائمة للمساعد الذكي
                </span>
                <button
                  type="button"
                  onClick={handleSaveDirectives}
                  className="secondary-btn text-[11px] py-1 px-2.5"
                >
                  حفظ التعليمات
                </button>
              </div>
              <textarea
                rows={3}
                value={customDirectives}
                onChange={(e) => setCustomDirectives(e.target.value)}
                className="w-full p-2 border rounded text-xs bg-background leading-normal font-sans"
              />
              {saveDirectivesNotice && (
                <span className="text-[11px] text-emerald-600 block">{saveDirectivesNotice}</span>
              )}
            </div>
          </div>

          {/* Generated Code Area */}
          <div className="lg:col-span-7">
            <div className="card-surface p-5 flex flex-col h-full min-h-[520px]">
              <div className="flex items-center justify-between border-b pb-3 mb-3">
                <span className="font-semibold text-sm flex items-center gap-2">
                  <FileCode size={17} className="text-emerald-500" />
                  مخرجات الأكواد والهجرة البرمجية (Live Output)
                </span>
                {generatedCode && (
                  <button
                    type="button"
                    onClick={copyCodeToClipboard}
                    className="secondary-btn text-xs py-1 px-2.5 inline-flex items-center gap-1"
                  >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    <span>{copied ? 'تم النسخ!' : 'نسخ الكود'}</span>
                  </button>
                )}
              </div>

              {isGenerating ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted p-12">
                  <RotateCw size={36} className="animate-spin text-primary mb-3" />
                  <p className="text-xs font-semibold text-ink">جارٍ صياغة الكود والهجرة عبر Gemini AI...</p>
                  <span className="text-[11px] text-muted mt-1">
                    يتم تحليل هيكل الجداول وسياسات الأمان وتطبيق التزامن الثلاثي
                  </span>
                </div>
              ) : generatedCode ? (
                <div className="flex-1 overflow-auto bg-black/90 text-emerald-400 p-4 rounded-lg font-mono text-xs leading-relaxed whitespace-pre-wrap selection:bg-emerald-800">
                  {generatedCode}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted p-12 text-center">
                  <Code2 size={48} className="opacity-30 mb-2" />
                  <h4 className="text-sm font-semibold text-ink">بانتظار طلبك البرمجي</h4>
                  <p className="text-xs text-muted max-w-sm mt-1">
                    اكتب في المحرر ما ترغب في تعديله أو إنشائه في قاعدة البيانات أو الباك إند واضغط "توليد الكود".
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM ARCHITECTURE & SCHEMA MAP */}
      {activeTab === 'architecture' && (
        <div className="card-surface p-6 space-y-6">
          <div className="border-b pb-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Database size={18} className="text-primary" />
              خريطة معمارية النظام وقواعد البيانات (16 جدول سحابي وموديول متكامل)
            </h3>
            <p className="text-xs text-muted mt-1">
              هذه هي خريطة الكود والمخطط الهيكلي لقاعدة البيانات المتاح للمساعد الذكي عند برمجته وتعديله لأي جزء بالمنظومة:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                name: 'supplier_contracts',
                title: 'عقود الموردين والمرفقات',
                cols: 'id, contract_number, supplier_name, contract_title, contract_type, start_date, end_date, contract_value, currency, attachments (JSONB), status, auto_renewal',
                rls: 'Active RLS (All authenticated)',
              },
              {
                name: 'disbursement_requests',
                title: 'طلبات الصرف الداخلي',
                cols: 'id, request_number, requester_name, requester_department, item_name, quantity_requested, unit, purpose, priority, status, approved_by, issued_at',
                rls: 'Active RLS',
              },
              {
                name: 'budget_plans',
                title: 'الميزانية والتخطيط المالي',
                cols: 'id, fiscal_year, department, category, allocated_amount, spent_amount, remaining_amount, notes, status',
                rls: 'Active RLS',
              },
              {
                name: 'financial_reports',
                title: 'التقارير المالية الدورية',
                cols: 'id, report_number, report_title, report_type, period_from, period_to, total_purchases, total_disbursements, budget_allocated, status',
                rls: 'Active RLS',
              },
              {
                name: 'asset_movement_log',
                title: 'سجل تتبع حركة الأصول',
                cols: 'id, asset_code, asset_name, from_location, to_location, movement_type, quantity, condition_before, condition_after, performed_by',
                rls: 'Active RLS',
              },
              {
                name: 'support_tickets',
                title: 'تذاكر الدعم الفني',
                cols: 'id, ticket_number, employee_name, department, category, priority, subject, description, status, attachment_url, admin_notes',
                rls: 'Active RLS',
              },
              {
                name: 'technical_inspections',
                title: 'محاضر الفحص والاستلام',
                cols: 'id, inspection_number, supplier, po_number, invoice_number, warehouse_name, decision, total_accepted_value, items (JSONB)',
                rls: 'Active RLS',
              },
              {
                name: 'inventory_settlements',
                title: 'محاضر التسوية الجردية',
                cols: 'id, settlement_number, warehouse_name, settlement_date, committee_head, total_matched, total_deficit, total_surplus, items (JSONB)',
                rls: 'Active RLS',
              },
              {
                name: 'ledger_movements / movements',
                title: 'حركات المخزن وفواتير الشراء',
                cols: 'id, item_name, type, qty, ptext, noinv, dmov, from_party, to_party, balance_after',
                rls: 'Active RLS',
              },
              {
                name: 'custody',
                title: 'أصناف العهدة والمخزون',
                cols: 'id, name, code, category, warehouse_name, quantity, unit, price, status, room_no',
                rls: 'Active RLS',
              },
              {
                name: 'app_users',
                title: 'المستخدمون والصلاحيات',
                cols: 'id, username, email, full_name, role, status, permissions (JSONB), is_activated',
                rls: 'Protected System Admin',
              },
              {
                name: 'audit_logs',
                title: 'سجل العمليات والتدقيق',
                cols: 'id, user_id, user_email, action, entity_type, entity_id, details (JSONB), ip_address, created_at',
                rls: 'System Admin Only',
              },
              {
                name: 'telegram_bot_settings',
                title: 'إعدادات بوت التيليجرام',
                cols: 'id, is_enabled, allow_registration, welcome_message, help_message, admin_chat_id, notify_admin_on_registration',
                rls: 'Active RLS',
              },
              {
                name: 'notifications',
                title: 'نظام الإشعارات',
                cols: 'id, user_id, title, body, type, is_read, action_url, related_id',
                rls: 'Active RLS',
              },
              {
                name: 'suppliers',
                title: 'الموردون المعتمدون',
                cols: 'id, name, phone, email, tax_number, address, rating, status',
                rls: 'Active RLS',
              },
              {
                name: 'settings',
                title: 'إعدادات المؤسسة والشعار',
                cols: 'id, organization, department, currency, logo_url, custom_fields (JSONB)',
                rls: 'Active RLS',
              },
            ].map((tbl, idx) => (
              <div key={idx} className="p-3 border rounded-lg bg-background space-y-1.5 text-xs shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-primary">{tbl.name}</span>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{tbl.rls}</span>
                </div>
                <div className="font-semibold text-ink text-[11px]">{tbl.title}</div>
                <p className="text-[10px] text-muted leading-relaxed font-mono break-words">{tbl.cols}</p>
              </div>
            ))}
          </div>

          <div className="p-4 bg-muted/20 border rounded-lg text-xs space-y-2">
            <h4 className="font-bold text-ink">قواعد الأمان والمعمارية الإلزامية للمساعد الذكي:</h4>
            <ul className="list-disc list-inside space-y-1 text-muted text-[11px]">
              <li><strong>التزامن الإلزامي:</strong> كل تعديل يجب أن ينعكس في الفرونت إند والباك إند وقاعدة البيانات.</li>
              <li><strong>الحساب المشرف المحمي:</strong> حساب مدير النظام (marwan-desouky) محمي بقفل أمان صلب يمنع الحذف أو خفض الصلاحية.</li>
              <li><strong>ممنوع النشر على Vercel:</strong> المنظومة تعمل حصرياً على بيئة التطوير واستضافة العميل ولا يتم تفعيل أي أمر أو سكربت نشر على فيرسل.</li>
            </ul>
          </div>
        </div>
      )}

      {/* TAB 3: SELF-REPAIR & DIAGNOSTICS */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card-surface p-5 space-y-2">
              <span className="text-xs text-muted block">فحص جودة البيانات الحالي:</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-ink">{qualitySummary.total}</span>
                <span className="text-xs text-muted">تنبيه وملاحظة مسجلة</span>
              </div>
              <div className="text-[11px] text-muted flex gap-2">
                <span className="text-amber-500 font-semibold">{qualitySummary.warnings} تحذير</span>
                <span>•</span>
                <span className="text-red-500 font-semibold">{qualitySummary.errors} خطأ</span>
                <span>•</span>
                <span>{qualitySummary.notes} ملاحظة</span>
              </div>
              <button
                type="button"
                onClick={handleRunSelfRepair}
                disabled={repairRunning}
                className="primary-btn w-full text-xs py-2 mt-2 inline-flex items-center justify-center gap-1.5"
              >
                <Wrench size={14} className={repairRunning ? 'animate-spin' : ''} />
                <span>{repairRunning ? 'جارٍ الإصلاح الذاتي...' : 'تشغيل أداة الإصلاح الذاتي آلياً'}</span>
              </button>
              {repairResult && (
                <div className="text-[11px] text-emerald-600 bg-emerald-500/10 p-2 rounded mt-2">
                  ✓ {repairResult.message} (تمت معالجة {repairResult.repairedCount} حركة)
                </div>
              )}
            </div>

            <div className="card-surface p-5 space-y-2">
              <span className="text-xs text-muted block">إحصائيات الجداول السحابية (Supabase):</span>
              <div className="flex items-center justify-between">
                <strong className="text-base text-ink">
                  {loadingStats ? 'جارٍ الفحص...' : `${Object.keys(tableStats).length} جدول متزامن`}
                </strong>
                <button
                  type="button"
                  onClick={loadDatabaseStats}
                  disabled={loadingStats}
                  className="secondary-btn text-xs py-1 px-2"
                >
                  <RotateCw size={13} className={loadingStats ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] font-mono text-muted">
                {Object.entries(tableStats).map(([tbl, cnt]) => (
                  <div key={tbl} className="flex justify-between border-b pb-0.5">
                    <span>{tbl}:</span>
                    <strong className="text-foreground">{String(cnt)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-surface p-5 space-y-2">
              <span className="text-xs text-muted block">حالة الاتصال والبيئة:</span>
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-500">
                <CheckCircle2 size={16} />
                <span>قاعدة بيانات Supabase نشطة ومحمية</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                يتم تمرير لقطة حية (Live Snapshot) تلقائياً للمساعد الذكي عند كل استعلام مع كاش ذكي 60 ثانية لتسريع الإجابة.
              </p>
            </div>
          </div>

          {/* Live Context JSON */}
          <div className="card-surface p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <Activity size={15} className="text-primary" />
                اللقطة الحية المباشرة المرسلة للذكاء الاصطناعي (Live Context Payload)
              </span>
              <span className="text-[10px] text-muted">متزامنة مع حركات المخزن وعقود التوريد</span>
            </div>
            <pre className="max-h-60 overflow-auto bg-black/90 text-emerald-400 p-3 rounded font-mono text-[11px] leading-relaxed">
              {liveContextPayload || 'جارٍ جلب اللقطة الحية...'}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 4: API & MODEL SETTINGS */}
      {activeTab === 'api_settings' && (
        <div className="card-surface p-6 space-y-6 max-w-3xl">
          <div className="border-b pb-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Key size={18} className="text-primary" />
              إعدادات الاتصال بـ Google Gemini API
            </h3>
            <p className="text-xs text-muted mt-1">
              يستخدم النظام مفتاح API للربط مع أحدث نماذج Gemini الذكية. يتم حفظ المفتاح بأمان في المتصفح دون مشاركته.
            </p>
          </div>

          <div className="space-y-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              مفتاح Gemini API Key
              <div className="flex gap-2">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 p-2 border rounded text-xs font-mono bg-background"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="secondary-btn text-xs py-1 px-3"
                >
                  {showKey ? 'إخفاء' : 'إظهار'}
                </button>
              </div>
            </label>

            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="primary-btn text-xs py-2 px-4"
              >
                حفظ المفتاح
              </button>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingKey}
                className="secondary-btn text-xs py-2 px-4 inline-flex items-center gap-1.5"
              >
                <Activity size={14} className={isTestingKey ? 'animate-spin' : ''} />
                <span>{isTestingKey ? 'جارٍ فحص الاتصال...' : 'اختبار سرعة الاتصال بالنموذج'}</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded text-xs flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                }`}
              >
                {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                النموذج الافتراضي النشط
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="p-2 border rounded bg-background text-xs"
                >
                  {CANDIDATE_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold">
                درجة الإبداعية البرمجية (Temperature): {temperature}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="mt-2"
                />
                <span className="text-[10px] text-muted">
                  0.0 = صارم ودقيق للأكواد وSQL • 0.7 = إبداعي للشروحات والحلول
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
