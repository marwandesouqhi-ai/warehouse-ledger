import { prepareAccessContext, getAccessSession } from './lib/accessContext'
import { useEffect, useMemo, useState, lazy, Suspense, type FormEvent } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  Bell,
  FileText,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  Headphones,
  History,
  Info,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Package,
  PackagePlus,
  Pencil,
  Percent,
  Plus,
  Receipt,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  UsersRound,
  Warehouse,
  X,
} from 'lucide-react'


import { deriveMovement, deriveSummary } from './lib/derive'
import { fixtureMovements, type FixtureMovement } from './lib/fixture'
import { movementFingerprint } from './lib/importRows'
import { AccessibleDialog } from './components/AccessibleDialog'
import { createWarehouseIssue, fetchMovements, saveMovements, updateMovement } from './lib/movementsRepository'
import { summarizeQuality } from './lib/quality'
import { loadAppSettings, saveAppSettingsToCloud, settingsStorageKey, logoBackupStorageKey, resolveSettingsWithCloud, fetchAppSettingsFromCloud, getSystemDisplayName, type AppSettings, type PersistenceOutcome } from './lib/settings'
import { supabase } from './lib/supabase'
import {
  can,
  canCreatePurchase,
  canCreateDisbursement,
  isSystemAdmin as permsIsSystemAdmin,
  getEffectiveRole,
  canViewPage,
  canAccessRoute,
  getDashboardScope,
  userMustChangePassword,
  ROLE_LABELS,
} from './lib/permissions'
import { fetchAuditLogs, logAuditEvent, type AuditLogEntry } from './lib/auditLogger'
import {
  loadCustodyItems,
  saveCustodyItems,
  fetchCustodyItemsFromCloud,
  syncInwardMovementToCustody,
  syncOutwardMovementToCustody,
  reconcileMovementEdit,
  fixtureCustodyItems,
  WAREHOUSES,
} from './lib/custody'
import {
  getLocalSession,
  clearLocalSession,
  syncUsersWithCloud,
} from './lib/localUsers'
import { startAutoBackupWatcher } from './lib/autoBackupEngine'
import { usePwaInstall } from './lib/pwa'
import AuthPage from './pages/AuthPage'
import { extractAuthTokensFromUrl } from './lib/authSessionUtils'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PageLoadingFallback } from './components/PageLoadingFallback'

// Requirement #10: Lazy-load route pages with loading and error boundaries
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'))
const CustodyPage = lazy(() => import('./pages/CustodyPage'))
const ImportPage = lazy(() => import('./pages/ImportPage'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'))
const SuppliersPage = lazy(() => import('./pages/procurement/SuppliersPage'))
const QuotesPage = lazy(() => import('./pages/procurement/QuotesPage'))
const QualityPage = lazy(() => import('./pages/QualityPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SupportPage = lazy(() => import('./pages/SupportPage'))
const DisbursementRequestsPage = lazy(() => import('./pages/DisbursementRequestsPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const InventoryAnalyticsPage = lazy(() => import('./pages/InventoryAnalyticsPage'))
const ContractsPage = lazy(() => import('./pages/ContractsPage'))
const AssetHistoryPage = lazy(() => import('./pages/AssetHistoryPage'))
const FinancialReportsPage = lazy(() => import('./pages/FinancialReportsPage'))
const BudgetPage = lazy(() => import('./pages/BudgetPage'))
const TelegramBotPage = lazy(() => import('./pages/TelegramBotPage'))
const ChatbotAdminPage = lazy(() => import('./pages/ChatbotAdminPage'))
import WarehouseChatBot from './components/WarehouseChatBot'
import { CustodyAnalyticsDashboard } from './components/CustodyAnalyticsDashboard'
import { ProcurementAnalyticsDashboard } from './components/ProcurementAnalyticsDashboard'
import NotFoundPage from './pages/NotFoundPage'
import { getSavedTheme, applyTheme } from './lib/theme'
import { getCairoDateString } from './lib/dateUtils'
import type { CustodyItem } from './lib/custody'
import { matchesSearch } from './lib/searchUtils'
import { purgeLocalDemoData } from './lib/purgeDemoData'
import { formatCurrency } from './lib/currency'
import { getRouteMetadata } from './lib/routeMetadata'
import './App.css'

const storageKey = 'warehouse-ledger-movements'

function normalizeMovementPrice(m: FixtureMovement): FixtureMovement {
  let price = m.price
  if (typeof price === 'string' && price.trim() !== '') {
    const normalized = price.trim().replace(/,/g, '.')
    const n = Number(normalized)
    if (!isNaN(n)) price = n
  }
  return { ...m, price }
}

function loadMovements(): FixtureMovement[] {
  try {
    const savedMovements = localStorage.getItem(storageKey)
    if (savedMovements) {
      const parsed = JSON.parse(savedMovements) as unknown
      if (Array.isArray(parsed)) {
        return (parsed as FixtureMovement[]).map(normalizeMovementPrice)
      }
    }
  } catch {
    // Fall back to the original data if the saved browser data is unreadable.
  }

  return fixtureMovements.map(normalizeMovementPrice)
}

function sanitizeExcelCell<T>(value: T): T {
  if (typeof value === 'string' && /^[=+@-]/i.test(value.trim())) {
    return `'${value}` as unknown as T
  }
  return value
}

async function exportMovements(movements: FixtureMovement[]) {
  const XLSX = await import('xlsx')
  const rows = movements.map((m, index) => {
    const derived = deriveMovement(m, index)
    const qtyIn = Number(derived.qty_in) || 0
    const qtyOut = Number(derived.qty_out) || 0
    const remUnits = Math.max(0, qtyIn - qtyOut)

    return {
      'التاريخ': sanitizeExcelCell(m.date || '—'),
      'رقم الفاتورة': sanitizeExcelCell(m.inv || '—'),
      'المورد': sanitizeExcelCell(m.from || '—'),
      'المستلم': sanitizeExcelCell(m.to || '—'),
      'رقم الإذن': sanitizeExcelCell(m.permit || '—'),
      'تاريخ الصرف': sanitizeExcelCell(m.issue || '—'),
      'الصنف': sanitizeExcelCell(m.item),
      'سعر الوحدة': derived.unit_price ?? m.price,
      'كمية الوارد': qtyIn,
      'كمية المنصرف': qtyOut,
      'الرصيد المتبقي': remUnits,
      'إجمالي قيمة الوارد': derived.total ?? 0,
      'قيمة المنصرف': derived.issued_value ?? 0,
      'القيمة المتبقية': derived.remaining_value ?? 0,
      'حالة الصرف': derived.status === 'full' ? 'مكتمل' : derived.status === 'part' ? 'جزئي' : derived.status === 'over' ? 'تجاوز' : 'معلق',
      'ملاحظات': sanitizeExcelCell(m.notes || ''),
    }
  })
  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'سجل حركات المخزن')
  XLSX.writeFile(workbook, `سجل-حركات-المخزن-${getCairoDateString()}.xlsx`)
}

const qualityRules = [
  { rule: 'future', level: 'warn', text: 'تواريخ واردة لاحقة' },
  { rule: 'order', level: 'warn', text: 'ترتيب غير منطقي' },
  { rule: 'noqty', level: 'warn', text: 'تاريخ صرف بلا كمية' },
  { rule: 'noto', level: 'warn', text: 'بدون مستلم أو إذن' },
  { rule: 'over', level: 'warn', text: 'صرف يتجاوز الوارد' },
  { rule: 'baddate', level: 'warn', text: 'تاريخ غير صالح' },
  { rule: 'nonum', level: 'warn', text: 'قيمة رقمية غير صالحة' },
  { rule: 'ptext', level: 'info', text: 'سعر محفوظ كنص' },
  { rule: 'noinv', level: 'info', text: 'بدون رقم فاتورة' },
]

function RestrictedScreen({ title, subtitle, message }: { title: string; subtitle: string; message: string }) {
  return (
    <section className="page-stack">
      <header className="page-intro">
        <div className="page-intro-icon modal-icon-danger">
          <ShieldAlert size={22} />
        </div>
        <div>
          <p className="eyebrow text-bad">صلاحية مقيدة</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>

      <div className="card-surface restricted-screen-card">
        <div className="modal-title-icon modal-icon-danger restricted-icon-box">
          <ShieldAlert size={32} />
        </div>
        <h3 className="text-lg mb-2">صلاحية حسابك للعرض والقراءة فقط</h3>
        <p className="text-muted font-sm leading-normal mb-4">
          {message}
        </p>
        <NavLink to="/" className="primary-btn inline-flex items-center gap-1">
          العودة إلى لوحة التحكم الرئيسية
        </NavLink>
      </div>
    </section>
  )
}

function App() {
  const location = useLocation()
  const shouldReduceMotion = useReducedMotion()
  const [darkMode, setDarkMode] = useState(() => getSavedTheme() === 'dark')
  const [session, setSession] = useState<Session | null>(() => {
    const local = getLocalSession()
    prepareAccessContext(local)
    return local as unknown as Session | null
  })
  const [movements, setMovements] = useState<FixtureMovement[]>(() => loadMovements())
  const [authLoading, setAuthLoading] = useState(() => !getLocalSession() && Boolean(supabase))
  const [isSettingPassword, setIsSettingPassword] = useState(() => {
    if (typeof window === 'undefined') return false
    const hash = window.location.hash || ''
    if (hash.includes('error=')) return false
    return hash.includes('type=recovery')
  })
  const [isInviteFlow, setIsInviteFlow] = useState(() => {
    if (typeof window === 'undefined') return false
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    if (hash.includes('error=')) return false
    return hash.includes('type=invite') || search.includes('type=invite')
  })
  const [syncStatus, setSyncStatus] = useState<'local' | 'loading' | 'synced' | 'error'>(supabase ? 'loading' : 'local')
  const [syncError, setSyncError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1025px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileMenuOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  const [settings, setSettings] = useState<AppSettings>(loadAppSettings)
  const [failedLogoSource, setFailedLogoSource] = useState('')
  const logoSource = settings.logoDataUrl || settings.logoUrl || ''

  useEffect(() => {
    setFailedLogoSource('')
    if (logoSource) {
      try {
        let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']")
        if (!link) {
          link = document.createElement('link')
          link.rel = 'shortcut icon'
          document.head.appendChild(link)
        }
        link.href = logoSource
      } catch {
        // ignore
      }
    }
  }, [logoSource])

  useEffect(() => {
    let active = true
    void fetchAppSettingsFromCloud().then((cloudSettings) => {
      if (active && cloudSettings) {
        setSettings((current) => resolveSettingsWithCloud(current, cloudSettings))
      }
    })

    function handleSettingsSync() {
      setSettings(loadAppSettings())
    }
    function handleLedgerSync() {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            setMovements(parsed as FixtureMovement[])
          }
        }
      } catch {
        // ignore
      }
    }
    function handleMovementsSync() {
      setMovements(loadMovements())
    }
    function handleCustodySync() {
      setCustodyItems(loadCustodyItems())
    }
    window.addEventListener('settings-changed', handleSettingsSync)
    window.addEventListener('storage', handleSettingsSync)
    window.addEventListener('warehouse-ledger-updated', handleLedgerSync)
    window.addEventListener('movements-changed', handleMovementsSync)
    window.addEventListener('custody-changed', handleCustodySync)
    window.addEventListener('custody-items-changed', handleCustodySync)
    return () => {
      active = false
      window.removeEventListener('settings-changed', handleSettingsSync)
      window.removeEventListener('storage', handleSettingsSync)
      window.removeEventListener('warehouse-ledger-updated', handleLedgerSync)
      window.removeEventListener('movements-changed', handleMovementsSync)
      window.removeEventListener('custody-changed', handleCustodySync)
      window.removeEventListener('custody-items-changed', handleCustodySync)
    }
  }, [])
  
  // Dashboard Interactive States
  const [chartMetric, setChartMetric] = useState<'value' | 'qty'>('value')
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState<'all' | 'full' | 'part' | 'pending'>('all')
  const [auditEvents, setAuditEvents] = useState<AuditLogEntry[]>([])
  const { isInstalled, promptInstall } = usePwaInstall()

  // Custody and Dashboard Analytics State
  const [custodyItems, setCustodyItems] = useState<CustodyItem[]>([])
  const dashboardScope = getDashboardScope(session)
  function updateAccessSession(next: Session | null) {
    if (prepareAccessContext(next)) {
      setMovements([])
      setCustodyItems([])
    }
    setSession(next)
  }
  const [dashboardAnalyticsTab, setDashboardAnalyticsTab] = useState<'all' | 'procurement' | 'movements' | 'custody'>(
    dashboardScope === 'purchases_only' ? 'procurement' : 'all'
  )

  useEffect(() => {
    if (dashboardScope === 'purchases_only') {
      setDashboardAnalyticsTab('procurement')
    } else if (dashboardScope === 'warehouse_only' && dashboardAnalyticsTab === 'procurement') {
      setDashboardAnalyticsTab('movements')
    }
  }, [dashboardScope])

  useEffect(() => {
    function handleCustodySync() {
      setCustodyItems(loadCustodyItems())
    }
    window.addEventListener('custody-changed', handleCustodySync)
    window.addEventListener('storage', handleCustodySync)

    // Ensure Main Warehouse contains the purchase items if currently missing
    setCustodyItems((current) => {
      if (!permsIsSystemAdmin(getAccessSession())) return current
      const hasMain = current.some((i) => i.warehouseId === 'main')
      if (!hasMain && fixtureCustodyItems.length > 0) {
        const merged = [...fixtureCustodyItems.map((i) => ({ ...i })), ...current]
        saveCustodyItems(merged)
        return merged
      }
      return current
    })

    return () => {
      window.removeEventListener('custody-changed', handleCustodySync)
      window.removeEventListener('storage', handleCustodySync)
    }
  }, [])

  // Edit & Delete Interactive States
  const [editingMovement, setEditingMovement] = useState<FixtureMovement | null>(null)
  const [deletingMovement, setDeletingMovement] = useState<FixtureMovement | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Requirement #11: Memoize summary and quality calculations
  const summary = useMemo(() => deriveSummary(movements as Array<Record<string, unknown>>), [movements])
  const netStockUnits = useMemo(() => Math.max(0, summary.qty_in - summary.qty_out), [summary.qty_in, summary.qty_out])
  const turnoverRateNum = useMemo(() => (summary.qty_in > 0 ? (summary.qty_out / summary.qty_in) * 100 : 0), [summary.qty_in, summary.qty_out])
  const turnoverRate = useMemo(() => turnoverRateNum.toFixed(1), [turnoverRateNum])
  const issuedValuePctNum = useMemo(() => (summary.total_value > 0 ? (summary.issued_value / summary.total_value) * 100 : 0), [summary.total_value, summary.issued_value])
  const issuedPercentage = useMemo(() => `${issuedValuePctNum.toFixed(1)}%`, [issuedValuePctNum])
  const remainingValuePctNum = useMemo(() => (summary.total_value > 0 ? (summary.remaining_value / summary.total_value) * 100 : 0), [summary.total_value, summary.remaining_value])
  const remainingValuePercentage = useMemo(() => `${remainingValuePctNum.toFixed(1)}%`, [remainingValuePctNum])
  const avgUnitCost = useMemo(() => (summary.qty_in > 0 ? summary.total_value / summary.qty_in : 0), [summary.total_value, summary.qty_in])
  const completedMovements = summary.status_counts.full ?? 0
  const partialMovements = summary.status_counts.part ?? 0
  const pendingMovements = summary.status_counts.pending ?? 0
  const fulfillmentRatio = useMemo(() => (movements.length > 0 ? Math.round((completedMovements / movements.length) * 100) : 0), [movements.length, completedMovements])

  const qualitySummary = useMemo(() => summarizeQuality(movements as Array<Record<string, unknown>>), [movements])
  const totalQualityIssues = useMemo(() => Object.values(qualitySummary).reduce((a, b) => a + b, 0), [qualitySummary])
  const qualityHealthScore = useMemo(() => (movements.length > 0
    ? Math.max(0, Math.min(100, Math.round(100 - (totalQualityIssues / movements.length) * 20)))
    : 100), [movements.length, totalQualityIssues])

  const effectiveRole = getEffectiveRole(session)
  const isSystemAdmin = permsIsSystemAdmin(session)
  const canManageRecords = can(session, 'manage_records')
  const canEdit = canCreateDisbursement(session) || canCreatePurchase(session)
  const activeUserDisplayName = (
    session?.user?.user_metadata?.displayName ||
    session?.user?.user_metadata?.name ||
    session?.user?.email ||
    'مستخدم'
  )

  const navSections = useMemo(() => {
    const sections: Array<{
      id: string
      title: string
      items: Array<{ to: string; label: string; mark: string; icon: typeof LayoutDashboard }>
    }> = []

    const scope = getDashboardScope(session)

    if (scope === 'purchases_only') {
      // ── قسم المشتريات مخصص لموظفي ومشرفي المشتريات فقط ──
      const procurementItems = [
        { to: '/', label: 'الرئيسية (لوحة المشتريات)', mark: '', icon: LayoutDashboard },
        { to: '/purchases', label: 'فواتير وتوريدات الشراء', mark: '', icon: ShoppingCart },
        { to: '/purchases/suppliers', label: 'إدارة الموردين والشركات', mark: '', icon: Building2 },
        { to: '/purchases/quotes', label: 'عروض الأسعار وأوامر الشراء', mark: '', icon: FileSpreadsheet },
        { to: '/purchases/contracts', label: 'عقود الموردين', mark: '', icon: FileText },
        { to: '/reports', label: 'تقارير المشتريات والتوريد', mark: '', icon: FileSpreadsheet },
        { to: '/imports', label: 'استيراد فواتير Excel', mark: '', icon: Upload },
      ]
      sections.push({ id: 'procurement', title: 'إدارة المشتريات والتوريدات', items: procurementItems })
    } else if (scope === 'warehouse_only') {
      // ── قسم المخازن مخصص لموظفي ومشرفي المخازن فقط ──
      const warehouseItems = [
        { to: '/', label: 'الرئيسية (لوحة المخازن)', mark: '', icon: LayoutDashboard },
      ]
      if (canViewPage(session, 'requests')) {
        warehouseItems.push({ to: '/requests', label: 'طلبات الصرف الداخلي', mark: '', icon: ClipboardList })
      }
      if (canViewPage(session, 'custody')) {
        warehouseItems.push({ to: '/custody', label: 'عهدة المخازن وأصول الكليات', mark: '', icon: Building2 })
      }
      if (canViewPage(session, 'asset_history')) {
        warehouseItems.push({ to: '/asset-history', label: 'سجل حركة الأصول', mark: '', icon: History })
      }
      if (canViewPage(session, 'analytics')) {
        warehouseItems.push({ to: '/analytics', label: 'تحليلات المخزون والدوران', mark: '', icon: BarChart3 })
      }
      if (canViewPage(session, 'quality')) {
        warehouseItems.push({ to: '/quality', label: 'فحص الجودة', mark: totalQualityIssues > 0 ? `${totalQualityIssues}` : '', icon: ShieldAlert })
      }
      if (canViewPage(session, 'reports')) {
        warehouseItems.push({ to: '/reports', label: 'تقارير العهدة والمخزون', mark: '', icon: FileSpreadsheet })
      }
      if (canViewPage(session, 'imports')) {
        warehouseItems.push({ to: '/imports', label: 'استيراد بيانات المخزن', mark: '', icon: Upload })
      }
      sections.push({ id: 'warehouse', title: 'إدارة المخزن والتشغيل', items: warehouseItems })
    } else {
      // ── لوحة القيادة الموحدة والشاملة للإدارة والسيستم أدمن ──
      const overviewItems = [
        { to: '/', label: 'الرئيسية (المنظومة الموحدة)', mark: '', icon: LayoutDashboard },
      ]
      sections.push({ id: 'overview', title: 'القيادة الاستراتيجية', items: overviewItems })

      const warehouseItems = []
      if (canViewPage(session, 'requests')) {
        warehouseItems.push({ to: '/requests', label: 'طلبات الصرف الداخلي', mark: '', icon: ClipboardList })
      }
      if (canViewPage(session, 'custody')) {
        warehouseItems.push({ to: '/custody', label: 'عهدة المخازن وأصول الكليات', mark: '', icon: Building2 })
      }
      if (canViewPage(session, 'asset_history')) {
        warehouseItems.push({ to: '/asset-history', label: 'سجل حركة الأصول', mark: '', icon: History })
      }
      if (canViewPage(session, 'quality')) {
        warehouseItems.push({ to: '/quality', label: 'فحص جودة المخزون', mark: totalQualityIssues > 0 ? `${totalQualityIssues}` : '', icon: ShieldAlert })
      }
      if (warehouseItems.length > 0) {
        sections.push({ id: 'warehouse', title: 'إدارة المخازن والتشغيل', items: warehouseItems })
      }

      const procurementItems = []
      if (canViewPage(session, 'purchases')) {
        procurementItems.push({ to: '/purchases', label: 'فواتير وتوريدات الشراء', mark: '', icon: ShoppingCart })
        procurementItems.push({ to: '/purchases/suppliers', label: 'إدارة الموردين والشركات', mark: '', icon: Building2 })
        procurementItems.push({ to: '/purchases/quotes', label: 'عروض الأسعار وأوامر الشراء', mark: '', icon: FileSpreadsheet })
        procurementItems.push({ to: '/purchases/contracts', label: 'عقود الموردين', mark: '', icon: FileText })
      }
      if (procurementItems.length > 0) {
        sections.push({ id: 'procurement', title: 'المشتريات والتوريدات', items: procurementItems })
      }

      const analyticsItems = []
      if (canViewPage(session, 'analytics')) {
        analyticsItems.push({ to: '/analytics', label: 'تحليلات المخزون والدوران', mark: '', icon: BarChart3 })
      }
      if (canViewPage(session, 'financial_reports')) {
        analyticsItems.push({ to: '/financial-reports', label: 'التقارير المالية الدورية', mark: '', icon: FileSpreadsheet })
      }
      if (canViewPage(session, 'budget')) {
        analyticsItems.push({ to: '/budget', label: 'الميزانية والتخطيط', mark: '', icon: CircleDollarSign })
      }
      if (canViewPage(session, 'reports')) {
        analyticsItems.push({ to: '/reports', label: 'التقارير الشاملة', mark: '', icon: FileSpreadsheet })
      }
      if (canViewPage(session, 'imports')) {
        analyticsItems.push({ to: '/imports', label: 'استيراد Excel', mark: '', icon: Upload })
      }
      if (analyticsItems.length > 0) {
        sections.push({ id: 'analytics_and_finance', title: 'التحليلات والموازنة', items: analyticsItems })
      }

      const adminItems = []
      if (canViewPage(session, 'audit')) {
        adminItems.push({ to: '/audit', label: 'سجل العمليات والتدقيق', mark: '', icon: History })
      }
      if (canViewPage(session, 'users')) {
        adminItems.push({ to: '/users', label: 'المستخدمون والصلاحيات', mark: '', icon: UsersRound })
      }
      if (canViewPage(session, 'telegram_bot')) {
        adminItems.push({ to: '/telegram-bot', label: 'إدارة بوت تيليجرام', mark: '', icon: Send })
      }
      if (canViewPage(session, 'chatbot_admin')) {
        adminItems.push({ to: '/chatbot-admin', label: 'إدارة وتوجيه المساعد الذكي', mark: 'AI', icon: Bot })
      }
      if (canViewPage(session, 'settings')) {
        adminItems.push({ to: '/settings', label: 'إعدادات المؤسسة', mark: '', icon: Settings2 })
      }
      if (adminItems.length > 0) {
        sections.push({ id: 'admin', title: 'الإدارة والأمان', items: adminItems })
      }
    }

    const supportItems = [
      { to: '/notifications', label: 'نظام الإشعارات', mark: '', icon: Bell },
      { to: '/support', label: 'الدعم الفني', mark: '', icon: Headphones },
    ]
    sections.push({ id: 'support', title: 'المساعدة والدعم', items: supportItems })

    return sections
  }, [totalQualityIssues, session])

  const stockStatusConfig = useMemo(() => {
    if (movements.length === 0) {
      return { text: 'حالة المخزون: لا توجد حركات مسجلة', tone: 'neutral' }
    }
    if (summary.pending_rows > 0 && netStockUnits === 0) {
      return { text: 'حالة المخزون: تنبيه نفاد الرصيد المتاح', tone: 'danger' }
    }
    if (totalQualityIssues > 0) {
      return { text: `حالة المخزون: يتطلب فحص جودة البيانات (${totalQualityIssues} ملاحظة)`, tone: 'warn' }
    }
    return { text: 'حالة المخزون: عمليات منتظمة ورصيد متاح', tone: 'success' }
  }, [movements.length, summary.pending_rows, netStockUnits, totalQualityIssues])

  const navigate = useNavigate()
  const qualityCards = useMemo(() => {
    return qualityRules
      .map(({ rule, level, text }) => ({ rule, level, text, count: qualitySummary[rule] ?? 0 }))
      .filter(({ count }) => count > 0)
      .slice(0, 5)
  }, [qualitySummary])

  const kpis = useMemo(() => [
    {
      id: 'in_value',
      label: 'قيمة الوارد الإجمالية',
      value: formatCurrency(summary.total_value, settings.currency),
      badge: 'إجمالي التوريد',
      sub: `متوسط سعر الصنف: ${formatCurrency(avgUnitCost, settings.currency)}`,
      tone: 'emerald',
      icon: CircleDollarSign,
    },
    {
      id: 'rem_value',
      label: 'الرصيد المتبقي الفعلي',
      value: formatCurrency(summary.remaining_value, settings.currency),
      badge: `${remainingValuePercentage} متاح`,
      sub: `${summary.pending_rows} بند قيد الصرف على الرف`,
      tone: 'cyan',
      icon: CheckCircle2,
    },
    {
      id: 'out_value',
      label: 'إجمالي المنصرف المالي',
      value: formatCurrency(summary.issued_value, settings.currency),
      badge: `${issuedPercentage} استهلاك`,
      sub: `تم صرف ${summary.qty_out.toLocaleString('ar-EG')} وحدة للمستلمين`,
      tone: 'amber',
      icon: ArrowDownToLine,
    },
    {
      id: 'net_units',
      label: 'صافي رصيد الوحدات بالمخزن',
      value: `${netStockUnits.toLocaleString('ar-EG')} وحدة`,
      badge: 'مخزون متاح فوراً',
      sub: `من أصل ${summary.qty_in.toLocaleString('ar-EG')} وحدة واردة`,
      tone: 'blue',
      icon: Boxes,
    },
    {
      id: 'movements_count',
      label: 'إجمالي حركات السجل',
      value: `${movements.length.toLocaleString('ar-EG')} حركة`,
      badge: `${fulfillmentRatio}% مكتمل`,
      sub: `${completedMovements} مكتمل كلياً • ${partialMovements} جزئي`,
      tone: 'indigo',
      icon: TrendingUp,
    },
    {
      id: 'distinct_items',
      label: 'الأصناف المسجلة النشطة',
      value: `${summary.distinct_items.toLocaleString('ar-EG')} صنف`,
      badge: 'تنوع الأصناف',
      sub: `${settings.organization} • ${settings.department}`,
      tone: 'purple',
      icon: Package,
    },
  ], [summary, settings.currency, settings.organization, settings.department, avgUnitCost, remainingValuePercentage, issuedPercentage, netStockUnits, movements.length, fulfillmentRatio, completedMovements, partialMovements])

  const visibleMovements = useMemo(() => {
    if (!searchTerm.trim()) return movements
    return movements.filter((movement) =>
      matchesSearch(
        [
          movement.item,
          movement.from,
          movement.to,
          movement.inv,
          movement.permit,
          movement.date,
          movement.issue,
          movement.notes,
          movement.price,
        ],
        searchTerm
      )
    )
  }, [movements, searchTerm])


  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(movements))
    } catch {
      // ignore storage errors
    }
  }, [movements])

  const systemDisplayName = useMemo(() => getSystemDisplayName(settings), [settings])

  const routeMetadata = useMemo(() => getRouteMetadata(location.pathname), [location.pathname])

  useEffect(() => {
    document.title = `${routeMetadata.title} | ${systemDisplayName}`
  }, [routeMetadata.title, systemDisplayName])

  // مراقب النسخ الاحتياطي التلقائي: يربط كافة صفحات وتعديلات النظام تلقائياً بالنسخ الاحتياطي
  useEffect(() => {
    const cleanup = startAutoBackupWatcher(session)
    return () => cleanup()
  }, [session])

  useEffect(() => {
    purgeLocalDemoData()
    function handleLocalAuth() {
      const local = getLocalSession()
      if (local) {
        updateAccessSession(local as unknown as Session)
        setAuthLoading(false)
      } else if (!supabase) {
        updateAccessSession(null)
        setAuthLoading(false)
      }
    }
    window.addEventListener('local-auth-changed', handleLocalAuth)

    if (!supabase) {
      handleLocalAuth()
      return () => window.removeEventListener('local-auth-changed', handleLocalAuth)
    }

    let active = true

    // Recover session from URL tokens (handles single or double hashes and query params)
    const urlTokens = extractAuthTokensFromUrl()
    if (urlTokens?.access_token && urlTokens?.refresh_token) {
      void supabase.auth.setSession({
        access_token: urlTokens.access_token,
        refresh_token: urlTokens.refresh_token,
      }).then(({ data }) => {
        if (!active) return
        if (data?.session) {
          updateAccessSession(data.session)
          const isRecovery = urlTokens.type === 'recovery' ||
            window.location.hash.includes('type=recovery') ||
            window.location.search.includes('type=recovery')
          if (isRecovery) {
            setIsSettingPassword(true)
            setIsInviteFlow(false)
          }
        }
      })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {

      const isActivation = window.location.hash.includes('type=invite') ||
        window.location.search.includes('type=invite') ||
        (nextSession?.user?.app_metadata as Record<string, unknown> | undefined)?.status === 'pending_activation'

      if (event === 'PASSWORD_RECOVERY') {
        if (isActivation) {
          setIsInviteFlow(true)
          setIsSettingPassword(false)
        } else {
          setIsSettingPassword(true)
          setIsInviteFlow(false)
        }
      }
      if ((window.location.hash.includes('type=invite') || window.location.search.includes('type=invite')) && !window.location.hash.includes('error=')) {
        setIsInviteFlow(true)
      }
      if (event === 'SIGNED_IN' && nextSession?.user) {
        void logAuditEvent({
          action: 'تسجيل دخول إلى النظام',
          entity_type: 'auth',
          user: nextSession.user,
        })
      }
      if (nextSession) {
        updateAccessSession(nextSession)
      } else {
        const local = getLocalSession()
        updateAccessSession(local ? (local as unknown as Session) : null)
      }
      setAuthLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setSyncError(error.message)
      if (data.session) {
        updateAccessSession(data.session)
      } else {
        const local = getLocalSession()
        if (local) {
          updateAccessSession(local as unknown as Session)
        }
      }
      setAuthLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      setSyncError(error instanceof Error ? error.message : 'تعذر التحقق من جلسة الدخول.')
      const local = getLocalSession()
      if (local) updateAccessSession(local as unknown as Session)
      setAuthLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener('local-auth-changed', handleLocalAuth)
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session) return

    let active = true
    setSyncStatus('loading')
    setSyncError('')

    function withTimeout<T>(promise: Promise<T>, ms: number, resourceName: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`انتهت مهلة تحميل ${resourceName} (${ms}ms)`)), ms)
        ),
      ])
    }

    void (async () => {
      // Requirement #40: Load settings, custody, movements, and users concurrently with per-resource timeouts
      const [movementsResult, settingsResult, custodyResult, _usersResult] = await Promise.allSettled([
        withTimeout(fetchMovements(), 5000, 'سجل الحركات'),
        withTimeout(fetchAppSettingsFromCloud(), 4000, 'إعدادات المؤسسة'),
        getDashboardScope(session) !== 'purchases_only'
          ? withTimeout(fetchCustodyItemsFromCloud(), 5000, 'عهدة المخازن')
          : Promise.resolve(null),
        isSystemAdmin
          ? withTimeout(syncUsersWithCloud(), 4000, 'دليل المستخدمين')
          : Promise.resolve(null),
      ])

      if (!active) return

      // 1. Process movements result
      if (movementsResult.status === 'fulfilled' && Array.isArray(movementsResult.value)) {
        let remoteMovements = movementsResult.value
        if (remoteMovements.length === 0 && isSystemAdmin) {
          try {
            const cached = localStorage.getItem(storageKey)
            if (cached) {
              const parsed = JSON.parse(cached) as unknown
              if (Array.isArray(parsed) && parsed.length > 0) {
                await withTimeout(saveMovements(parsed as FixtureMovement[], session?.user?.id), 4000, 'حفظ الحركات الأولية')
                remoteMovements = await withTimeout(fetchMovements(), 4000, 'إعادة قراءة الحركات')
              }
            }
          } catch {
            // non-blocking
          }
        }
        if (active) {
          setMovements(remoteMovements)
          try {
            localStorage.setItem(storageKey, JSON.stringify(remoteMovements))
          } catch {
            // ignore localStorage quota
          }
        }
      } else if (movementsResult.status === 'rejected') {
        console.warn('Concurrent sync warning (movements):', movementsResult.reason)
      }

      // 2. Process settings result
      if (settingsResult.status === 'fulfilled' && settingsResult.value) {
        if (active) {
          setSettings((current) => resolveSettingsWithCloud(current, settingsResult.value || undefined))
        }
      }

      // 3. Process custody result
      if (custodyResult.status === 'fulfilled' && Array.isArray(custodyResult.value)) {
        if (active) {
          setCustodyItems(custodyResult.value)
        }
      }

      // 4. Update synchronization status
      const hasMovementsError = movementsResult.status === 'rejected'
      if (active) {
        if (hasMovementsError) {
          setSyncStatus('error')
          setSyncError('تعذرت مزامنة بعض البيانات السحابية في الوقت المحدد. يعمل النظام حالياً بالبيانات المخزنة محلياً.')
        } else {
          setSyncStatus('synced')
        }
      }
    })().catch((err: unknown) => {
      if (!active) return
      setSyncStatus('error')
      setSyncError(err instanceof Error ? err.message : 'حدث خطأ أثناء مزامنة البيانات.')
    })

    return () => {
      active = false
    }
  }, [session?.user?.id, isSystemAdmin])

  useEffect(() => {
    if (session?.user?.user_metadata?.app_settings) {
      const userSettings = { ...(session.user.user_metadata.app_settings as Partial<AppSettings>) }
      if (userSettings.organization === 'المعهد' || userSettings.organization === 'معهد التكنولوجيا') {
        delete userSettings.organization
      }
      if (userSettings.department === 'قسم المخازن' || userSettings.department === 'المخزن الهندسي') {
        delete userSettings.department
      }
      if (Object.keys(userSettings).length > 0) {
        setSettings((current) => resolveSettingsWithCloud(current, userSettings))
      }
    }
  }, [session])

  useEffect(() => {
    try {
      localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
      const currentLogo = settings.logoDataUrl || settings.logoUrl || ''
      if (currentLogo) {
        localStorage.setItem(logoBackupStorageKey, currentLogo)
      } else {
        localStorage.removeItem(logoBackupStorageKey)
      }
    } catch {
      // ignore
    }
  }, [settings])

  async function handleSaveSettings(nextSettings: AppSettings): Promise<PersistenceOutcome> {
    setSettings(nextSettings)
    const outcome = await saveAppSettingsToCloud(nextSettings)
    void logAuditEvent({
      action: 'تعديل إعدادات المؤسسة',
      entity_type: 'settings',
      details: { organization: nextSettings.organization, currency: nextSettings.currency },
      user: session?.user,
    })
    return outcome
  }

  async function handleLoadDemoData() {
    if (supabase && session) {
      try {
        setSyncStatus('loading')
        const saved = await saveMovements(fixtureMovements, session.user.id)
        setMovements(saved)
        setSyncStatus('synced')
      } catch (error) {
        setSyncStatus('error')
        setSyncError(error instanceof Error ? error.message : 'تعذر تحميل البيانات التجريبية.')
      }
    } else {
      setMovements(fixtureMovements)
    }
    void logAuditEvent({
      action: 'تحميل بيانات تجريبية للمخزن',
      entity_type: 'import',
      details: { count: fixtureMovements.length },
      user: session?.user,
    })
  }

  useEffect(() => {
    applyTheme(darkMode)
  }, [darkMode])

  async function addMovement(movement: FixtureMovement, redirectPath: string | null = '/purchases') {
    if (Number(movement.qin) > 0 ? !canCreatePurchase(session) : !canCreateDisbursement(session)) {
      throw new Error('حسابك لا يملك صلاحية الإضافة في هذا القسم.')
    }
    const isPurchase = Number(movement.qin) > 0
    let savedMovement = movement

    if (supabase && session) {
      if (isPurchase) {
        // 1. فواتير الشراء: استدعاء دالة RPC الذرية record_purchase
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('record_purchase', {
            p_fingerprint: movementFingerprint(movement),
            p_item: movement.item,
            p_qty: Number(movement.qin),
            p_unit_price: Number(movement.price) || 0,
            p_supplier: movement.from || '',
            p_notes: movement.notes || '',
            p_created_by: session.user.email || '',
            p_received_on: movement.date || null,
            p_invoice_number: movement.inv || '',
          })
          if (rpcError) throw rpcError

          savedMovement = {
            ...movement,
            id: rpcData?.movement_id || movement.id,
            custodyApplied: true,
          }
          setMovements((current) => [...current, savedMovement])
          setSyncStatus('synced')

          // إعادة تحميل عهدة المخازن من السحابة لضمان مطابقة رصيد المخزن الرئيسي المتزايد ذرياً
          try {
            const cloudCustody = await fetchCustodyItemsFromCloud()
            if (cloudCustody.length > 0) {
              setCustodyItems(cloudCustody)
              saveCustodyItems(cloudCustody)
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('custody-changed'))
              }
            }
          } catch (custodyReloadErr) {
            console.warn('Could not reload custody after record_purchase:', custodyReloadErr)
          }
        } catch (error) {
          setSyncStatus('error')
          setSyncError(error instanceof Error ? error.message : 'تعذر تسجيل فاتورة الشراء على الخادم.')
          throw error
        }
      } else {
        // 2. حركات المنصرف والتحويل: الحفظ والخصم المحلي
        try {
          const saved = await createWarehouseIssue(movement, session.user.id)
          savedMovement = saved
          setMovements((current) => [...current, saved])
          setSyncStatus('synced')
          const cloudCustody = await fetchCustodyItemsFromCloud()
          setCustodyItems(cloudCustody)
        } catch (error) {
          setSyncStatus('error')
          setSyncError(error instanceof Error ? error.message : 'تعذر حفظ الحركة على الخادم.')
          throw error
        }
      }
    } else {
      // 3. وضع عدم الاتصال (Offline Fallback): حفظ محلي فقط دون كسر
      setMovements((current) => [...current, movement])
      try {
        if (isPurchase) {
          syncInwardMovementToCustody(movement)
        } else if (Number(movement.qout) > 0) {
          syncOutwardMovementToCustody(movement)
        }
      } catch (custodyErr) {
        console.warn('Custody synchronization warning:', custodyErr)
      }
    }

    void logAuditEvent({
      action: isPurchase ? `إضافة حركة وارد: ${movement.item}` : `إضافة حركة صرف: ${movement.item}`,
      entity_type: 'movement',
      details: {
        item: movement.item,
        price: movement.price,
        qty_in: movement.qin,
        qty_out: movement.qout,
        supplier: movement.from,
        recipient: movement.to,
        inv: movement.inv,
        date: movement.date,
      },
      user: session?.user,
    })
    if (redirectPath !== null) {
      navigate(redirectPath || '/purchases')
    }
  }

  async function updateExistingMovement(updated: FixtureMovement) {
    if (!isSystemAdmin) {
      throw new Error('تعديل الحركات والبيانات في النظام مقتصر حصرياً على مدير النظام (System Admin).')
    }

    const oldMovement = movements.find((m) => m.id === updated.id)

    if (supabase && session) {
      try {
        const saved = await updateMovement(updated, session.user.id)
        setMovements((current) => current.map((m) => (m.id === updated.id ? saved : m)))
        setSyncStatus('synced')
      } catch (error) {
        setSyncStatus('error')
        setSyncError(error instanceof Error ? error.message : 'تعذر تحديث الحركة على الخادم.')
        throw error
      }
    } else {
      setMovements((current) => current.map((m) => (m.id === updated.id ? updated : m)))
    }

    // مزامنة العهدة بتطبيق فرق الكميات والقيم فقط بين الحركة السابقة والجديدة (Delta Reconciliation)
    if (oldMovement) {
      try {
        const nextCustody = reconcileMovementEdit(oldMovement, updated)
        setCustodyItems(nextCustody)
      } catch (custodyErr) {
        console.warn('Custody delta reconciliation warning on update:', custodyErr)
      }
    }

    void logAuditEvent({
      action: `تعديل حركة: ${updated.item}`,
      entity_type: 'movement',
      details: {
        id: updated.id,
        item: updated.item,
        price: updated.price,
        qty_in: updated.qin,
        qty_out: updated.qout,
        supplier: updated.from,
        recipient: updated.to,
        inv: updated.inv,
        date: updated.date,
      },
      user: session?.user,
    })
  }

  async function deleteExistingMovement(_movement: FixtureMovement) {
    throw new Error('سجل العمليات وحركات المخزون محفوظ بشكل دائم وغير قابل للحذف نهائياً لضمان النزاهة والامتثال المحاسبي.')
  }

  async function mergeImportedMovements(imported: FixtureMovement[]) {
    if (!isSystemAdmin) throw new Error('استبدال واستيراد السجلات مقتصر على مدير النظام.')
    const knownMovements = new Set(movements.map(movementFingerprint))
    const uniqueMovements: FixtureMovement[] = []
    let skipped = 0

    for (const movement of imported) {
      const fingerprint = movementFingerprint(movement)
      if (knownMovements.has(fingerprint)) {
        skipped += 1
        continue
      }
      knownMovements.add(fingerprint)
      uniqueMovements.push(movement)
    }

    let added = 0
    if (supabase && session) {
      try {
        const purchases = uniqueMovements.filter((m) => Number(m.qin) > 0)
        const others = uniqueMovements.filter((m) => !(Number(m.qin) > 0))

        // 1. تسجيل فواتير الشراء المستوردة عبر دالة RPC الذرية لزيادة عهدة المخزن الرئيسي بأمان
        for (const p of purchases) {
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('record_purchase', {
              p_fingerprint: movementFingerprint(p),
              p_item: p.item,
              p_qty: Number(p.qin),
              p_unit_price: Number(p.price) || 0,
              p_supplier: p.from || '',
              p_notes: p.notes || '',
              p_created_by: session.user.email || '',
              p_received_on: p.date || null,
              p_invoice_number: p.inv || '',
            })
            if (!rpcErr) {
              p.id = rpcData?.movement_id || p.id
              p.custodyApplied = true
              added += 1
            }
          } catch (pErr) {
            console.warn('Import purchase RPC error:', pErr)
          }
        }

        // 2. تسجيل حركات الصرف والتحويل الأخرى
        if (others.length > 0) {
          const savedOthers = await saveMovements(others, session.user.id)
          added += savedOthers.length
          for (const m of others) {
            try {
              syncOutwardMovementToCustody(m)
            } catch (custodyErr) {
              console.warn('Custody synchronization on import warning:', custodyErr)
            }
          }
        }

        setMovements((current) => [...current, ...uniqueMovements])
        setSyncStatus('synced')

        // 3. تحديث عهدة المخازن من السحابة لضمان مطابقة التعديلات الذرية
        if (purchases.length > 0) {
          try {
            const cloudCustody = await fetchCustodyItemsFromCloud()
            if (cloudCustody.length > 0) {
              setCustodyItems(cloudCustody)
              saveCustodyItems(cloudCustody)
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('custody-changed'))
              }
            }
          } catch (custodyReloadErr) {
            console.warn('Could not reload custody after import purchases:', custodyReloadErr)
          }
        }
      } catch (error) {
        setSyncStatus('error')
        setSyncError(error instanceof Error ? error.message : 'تعذر استيراد الحركات إلى Supabase.')
        throw error
      }
    } else {
      setMovements((current) => [...current, ...uniqueMovements])
      added = uniqueMovements.length
      // مزامنة الحركات المستوردة تلقائياً مع عهدة المخازن محلياً (وضع عدم الاتصال)
      try {
        for (const m of uniqueMovements) {
          if (Number(m.qin) > 0) {
            syncInwardMovementToCustody(m)
          } else if (Number(m.qout) > 0) {
            syncOutwardMovementToCustody(m)
          }
        }
      } catch (custodyErr) {
        console.warn('Custody synchronization on import warning:', custodyErr)
      }
    }

    void logAuditEvent({
      action: `استيراد حركات من ملف (${added} حركة)`,
      entity_type: 'import',
      details: { added, skipped },
      user: session?.user,
    })
    return { added, skipped }
  }

  useEffect(() => {
    let active = true
    if (supabase && isSystemAdmin) {
      fetchAuditLogs(6).then((logs) => {
        if (active && logs && logs.length > 0) {
          setAuditEvents(logs)
        }
      }).catch(() => {
        // Fallback silently if offline or restricted
      })
    } else if (!isSystemAdmin) {
      setAuditEvents([])
    }
    return () => {
      active = false
    }
  }, [movements.length, session, isSystemAdmin])



  const monthlyStats = useMemo(() => {
    const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    const groups: Record<string, {
      key: string
      year: number
      month: number
      label: string
      inValue: number
      outValue: number
      inQty: number
      outQty: number
      count: number
    }> = {}

    for (let i = 0; i < movements.length; i++) {
      const m = movements[i]
      const derived = deriveMovement(m, i)
      const dateObj = derived.received_on || derived.issued_on
      let year = 2024
      let month = 0
      let key = 'general'
      let label = 'فترة عامة'

      if (dateObj && !isNaN(dateObj.getTime())) {
        year = dateObj.getFullYear()
        month = dateObj.getMonth()
        key = `${year}-${String(month + 1).padStart(2, '0')}`
        label = `${ARABIC_MONTHS[month]} ${year}`
      } else {
        const rawDate = String(m.date || '').trim()
        if (rawDate.includes('/')) {
          const p = rawDate.split('/')
          if (p.length === 3) {
            year = parseInt(p[2]) || 2024
            month = Math.max(0, Math.min(11, (parseInt(p[1]) || 1) - 1))
            key = `${year}-${String(month + 1).padStart(2, '0')}`
            label = `${ARABIC_MONTHS[month]} ${year}`
          }
        } else if (rawDate.includes('-')) {
          const p = rawDate.split('-')
          if (p.length === 3) {
            year = parseInt(p[0]) || 2024
            month = Math.max(0, Math.min(11, (parseInt(p[1]) || 1) - 1))
            key = `${year}-${String(month + 1).padStart(2, '0')}`
            label = `${ARABIC_MONTHS[month]} ${year}`
          }
        }
      }

      groups[key] ??= {
        key,
        year,
        month,
        label,
        inValue: 0,
        outValue: 0,
        inQty: 0,
        outQty: 0,
        count: 0,
      }

      groups[key].inValue += derived.total ?? 0
      groups[key].outValue += derived.issued_value ?? 0
      groups[key].inQty += derived.qty_in ?? 0
      groups[key].outQty += derived.qty_out ?? 0
      groups[key].count++
    }

    const sorted = Object.values(groups).sort((a, b) => a.key.localeCompare(b.key))
    if (sorted.length === 0) {
      return [
        { key: 'curr', year: 2026, month: 9, label: 'أكتوبر 2026', inValue: 0, outValue: 0, inQty: 0, outQty: 0, count: 0 }
      ]
    }
    return sorted
  }, [movements])

  const maxChartVal = useMemo(() => {
    if (chartMetric === 'value') {
      return Math.max(...monthlyStats.map((s) => Math.max(s.inValue, s.outValue)), 1)
    }
    return Math.max(...monthlyStats.map((s) => Math.max(s.inQty, s.outQty)), 1)
  }, [monthlyStats, chartMetric])

  const filteredRecentMovements = useMemo(() => {
    let list = visibleMovements
    if (tableFilter === 'full') {
      list = list.filter((m, idx) => deriveMovement(m, idx).status === 'full')
    } else if (tableFilter === 'part') {
      list = list.filter((m, idx) => deriveMovement(m, idx).status === 'part')
    } else if (tableFilter === 'pending') {
      list = list.filter((m, idx) => deriveMovement(m, idx).status === 'pending')
    }
    return list.slice(-6).reverse()
  }, [visibleMovements, tableFilter])

  function signOut() {
    if (session?.user) {
      void logAuditEvent({
        action: 'تسجيل خروج من النظام',
        entity_type: 'auth',
        user: session.user,
      })
    }
    clearLocalSession()
    updateAccessSession(null)
    navigate('/', { replace: true })
    if (supabase) void supabase.auth.signOut()
  }

  if (authLoading) {
    return <main className="auth-shell" dir="rtl"><p>جارٍ التحقق من جلسة الدخول...</p></main>
  }

  const isPendingActivation = (session?.user?.app_metadata as Record<string, unknown> | undefined)?.status === 'pending_activation'
  const requiresPasswordChange = Boolean(session?.user && userMustChangePassword(session.user))

  if (supabase && (isInviteFlow || isPendingActivation)) {
    return (
      <AuthPage
        initialMode="activateAccount"
        settings={settings}
        onPasswordSet={() => {
          setIsInviteFlow(false)
          setIsSettingPassword(false)
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', window.location.pathname)
          }
          // Refresh session after activation — the session is already live from the invite flow
          void supabase?.auth.getSession().then(({ data }) => {
            if (data?.session) {
              updateAccessSession(data.session)
            } else {
              // Fallback: force a session check after a short delay (metadata propagation)
              setTimeout(() => {
                void supabase?.auth.getSession().then(({ data: d2 }) => {
                  if (d2?.session) updateAccessSession(d2.session)
                })
              }, 1200)
            }
          })
        }}
      />
    )
  }

  if (supabase && (isSettingPassword || requiresPasswordChange) && !isInviteFlow) {
    return (
      <AuthPage
        initialMode="setNewPassword"
        settings={settings}
        onPasswordSet={() => {
          setIsSettingPassword(false)
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', window.location.pathname)
          }
          void supabase?.auth.refreshSession().then(({ data }) => {
            if (data?.session) {
              updateAccessSession(data.session)
              setSession(data.session)
            }
          })
        }}
      />
    )
  }



  if (!session) {
    if (location.pathname === '/support' || location.pathname.startsWith('/support')) {
      return (
        <div className="public-support-shell" dir="rtl">
          <header className="public-support-topbar">
            <div className="public-support-brand">
              <Warehouse size={22} className="text-accent" />
              <div>
                <strong>{systemDisplayName}</strong>
                <span className="public-support-badge">بوابة الدعم الفني والمساعدة المباشرة</span>
              </div>
            </div>
            <Link to="/auth" className="public-support-back-btn">
              <LogIn size={16} />
              <span>العودة لصفحة تسجيل الدخول</span>
            </Link>
          </header>
          <main className="public-support-main">
            <SupportPage session={null} />
          </main>
        </div>
      )
    }

    return (
      <AuthPage
        settings={settings}
        onPasswordSet={() => {
          const local = getLocalSession()
          if (local) updateAccessSession(local as unknown as Session)
        }}
      />
    )
  }

  return (
    <div className={`app-shell ${mobileMenuOpen ? 'mobile-nav-active' : ''}`} dir="rtl">
      <a href="#main-content" className="skip-link">تخطي إلى المحتوى الرئيسي</a>

      {mobileMenuOpen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside id="app-sidebar" className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`} aria-label="شريط التنقل الجانبي">
        <div className="sidebar-scrollable-content">
          {mobileMenuOpen && (
            <div className="mobile-drawer-header">
              <div className="flex items-center gap-2">
                <Warehouse size={18} className="text-accent" />
                <strong className="font-sm text-ink">{systemDisplayName}</strong>
              </div>
              <button
                type="button"
                className="mobile-drawer-close-btn"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="إغلاق القائمة"
              >
                <X size={18} />
              </button>
            </div>
          )}

          <div className="brand-wrap">
            <div className="brand-mark">
              {logoSource && failedLogoSource !== logoSource ? (
                <img
                  src={logoSource}
                  alt={`شعار ${settings.organization || 'المؤسسة'}`}
                  onError={() => setFailedLogoSource(logoSource)}
                />
              ) : (
                <Warehouse size={21} strokeWidth={2.2} />
              )}
            </div>
            <div>
              <div className="brand-title" title={systemDisplayName}>
                {systemDisplayName}
              </div>
              <small title={`${settings.organization || 'المؤسسة'} • ${settings.department || 'المخازن'}`}>
                {settings.organization || 'المؤسسة'} • {settings.department || 'المخازن'}
              </small>
            </div>
          </div>

          <nav className="nav" aria-label="التنقل الرئيسي">
            {navSections.map((section) => (
              <div key={section.id} className="nav-section">
                <div className="nav-section-title">{section.title}</div>
                {section.items.map(({ to, label, mark, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    title={label}
                    aria-label={label}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                    <span className="nav-label">{label}</span>
                    {mark ? <small className="nav-badge">{mark}</small> : null}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {!isInstalled ? (
          <div className="pwa-sidebar-card">
            <div className="pwa-sidebar-head">
              <Smartphone size={18} className="pwa-icon" />
              <span>تطبيق الأجهزة (PWA)</span>
            </div>
            <p className="pwa-desc">ثبّت التطبيق على جهاز الكمبيوتر أو الهاتف ليعمل مباشرة كنافذة مستقلة.</p>
            <button
              type="button"
              className="pwa-install-action"
              onClick={() => void promptInstall()}
            >
              <Download size={15} /> تثبيت التطبيق الآن
            </button>
          </div>
        ) : (
          <div className="pwa-installed-tag">
            <CheckCircle2 size={15} /> التطبيق مثبت على الجهاز
          </div>
        )}
      </aside>

      <main id="main-content" className="main-panel">
        <header className="topbar">
          <div className="mobile-topbar-row">
            <button
              type="button"
              className="mobile-menu-trigger-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة الرئيسية"
              aria-expanded={mobileMenuOpen}
              aria-controls="app-sidebar"
              title="القائمة الرئيسية"
            >
              <Menu size={20} />
              <span>القائمة</span>
            </button>

            <div className="mobile-brand-pill">
              <Warehouse size={15} className="text-accent" />
              <span>{systemDisplayName}</span>
            </div>

            <button
              type="button"
              className="theme-toggle mobile-theme-toggle"
              onClick={() => setDarkMode((value) => !value)}
              aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>

          <div className="mobile-native-greeting">
            <div className="mobile-greeting-date">
              <CalendarDays size={13} className="text-accent" />
              <span>{new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span>
            </div>
            <h2 className="mobile-greeting-title">
              أهلاً {activeUserDisplayName} 👋
            </h2>
            <p className="mobile-greeting-subtitle">
              {ROLE_LABELS[effectiveRole] || effectiveRole} • {settings.organization}
            </p>
            <div className="mobile-quick-chips">
              <button type="button" className="quick-chip" onClick={() => navigate('/purchases?tab=add')}>
                <Plus size={14} /> إضافة توريد
              </button>
              <button type="button" className="quick-chip" onClick={() => navigate('/requests')}>
                <ClipboardList size={14} /> طلب صرف
              </button>
              <button type="button" className="quick-chip" onClick={() => navigate('/reports')}>
                <FileSpreadsheet size={14} /> كشف الجرد
              </button>
              <button type="button" className="quick-chip" onClick={() => navigate('/support')}>
                <Headphones size={14} /> الدعم الفني
              </button>
            </div>
          </div>

          <div className="topbar-meta">
            <nav aria-label="مسار التنقل" className="eyebrow breadcrumb-nav">
              {logoSource && failedLogoSource !== logoSource ? (
                <img src={logoSource} alt="" className="topbar-mini-logo" />
              ) : (
                <Warehouse size={14} />
              )}
              {routeMetadata.breadcrumbs.map((b, idx) => (
                <span key={idx} className="breadcrumb-segment">
                  {idx > 0 && <span className="breadcrumb-sep" aria-hidden="true">›</span>}
                  {b.to ? (
                    <Link to={b.to} className="breadcrumb-link">{b.label}</Link>
                  ) : (
                    <span className="breadcrumb-current" aria-current="page">{b.label}</span>
                  )}
                </span>
              ))}
            </nav>
            <h1>{routeMetadata.title}</h1>
            <p className="topbar-subtitle">{routeMetadata.subtitle}</p>
          </div>

          <div className="toolbar-actions">
            <form
              className="toolbar-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                const currentPath = window.location.pathname
                // Requirement #22: Stay in the active scope if it already supports search (never redirect from custody to purchases)
                if (['/custody', '/purchases', '/movements', '/reports'].includes(currentPath)) {
                  return
                }
                if (searchTerm.trim()) {
                  navigate('/purchases')
                }
              }}
            >
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ابحث عن صنف، مورد، مستلم..."
                aria-label="ابحث عن صنف أو مستلم"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="toolbar-search-clear-btn"
                  onClick={() => setSearchTerm('')}
                  title="مسح البحث"
                  aria-label="مسح البحث"
                >
                  <X size={14} />
                </button>
              )}
            </form>

            <button type="button" className="theme-toggle" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'} title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => navigate('/support')}
              title="مركز الدعم الفني وتذاكر الموظفين"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '6px 10px',
                height: '38px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              <Headphones size={15} style={{ color: 'var(--accent, #3b82f6)' }} />
              <span className="hidden sm:inline">الدعم الفني</span>
            </button>

            {session && (
              <div className="topbar-user-wrap" title={`الحساب الحالي: ${activeUserDisplayName}`}>
                <span className="topbar-user-name">{activeUserDisplayName}</span>
                <span className={`topbar-role-badge role-${effectiveRole}`}>
                  {ROLE_LABELS[effectiveRole] || effectiveRole}
                </span>
                <button
                  type="button"
                  className="secondary-btn topbar-logout-btn"
                  onClick={signOut}
                  title="تسجيل الخروج"
                  aria-label="تسجيل الخروج"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="workspace-meta">
          <span><CalendarDays size={15} /> كل الحركات</span>
          <span><Package size={15} /> {movements.length.toLocaleString('ar-EG')} حركة مسجلة</span>
          <span className="local-status"><i />{syncStatus === 'synced' ? 'متزامنة مع Supabase' : syncStatus === 'error' ? 'تعذرت المزامنة' : 'محفوظة على هذا الجهاز'}</span>
        </div>
        {syncError && <div className="inline-message error" role="alert">{syncError}</div>}

        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="route-content-container"
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <ErrorBoundary>
              <Suspense fallback={<PageLoadingFallback />}>
                <Routes location={location}>
          <Route
            path="/"
            element={
              dashboardScope === 'purchases_only' ? (
                /* ─── 1. لوحة تحليلات إدارة المشتريات والتوريدات المخصصة ─── */
                <section className="dashboard-grid purchases-only-dashboard">
                  <div className="hero-overview-card card-surface">
                    <div className="hero-main-content">
                      <div className="hero-status-tag tone-emerald">
                        <span className="live-pulse-dot" />
                        <span>إدارة المشتريات والتوريدات</span>
                        <span className="hero-divider">•</span>
                        <span>{settings.organization} ({settings.department})</span>
                      </div>
                      <h2 className="hero-title">لوحة التحكم والمؤشرات التشغيلية لإدارة المشتريات</h2>
                      <p className="hero-desc">
                        متابعة فورية لدورة المشتريات والاحتياجات، تدفق مسار الاعتمادات، عروض الأسعار التنافسية، وأوامر الشراء المعتمدة لجامعة الزقازيق الأهلية.
                      </p>
                      <div className="hero-actions">
                        <button type="button" className="primary-btn" onClick={() => navigate('/purchases?tab=add')}>
                          <Plus size={16} /> تسجيل فاتورة وتوريد جديد
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/purchases/quotes')}>
                          <FileSpreadsheet size={16} /> عروض الأسعار
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/purchases/suppliers')}>
                          <Building2 size={16} /> إدارة الموردين
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/purchases/contracts')}>
                          <FileText size={16} /> عقود الموردين
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <ProcurementAnalyticsDashboard
                      movements={movements}
                      currency={settings.currency}
                      isDashboardEmbed={false}
                    />
                  </div>
                </section>
              ) : dashboardScope === 'warehouse_only' ? (
                /* ─── 2. لوحة تحليلات إدارة المخازن والتشغيل المخصصة ─── */
                <section className="dashboard-grid warehouse-only-dashboard">
                  <div className="hero-overview-card card-surface">
                    <div className="hero-main-content">
                      <div className={`hero-status-tag tone-${stockStatusConfig.tone}`}>
                        <span className="live-pulse-dot" />
                        <span>{stockStatusConfig.text}</span>
                        <span className="hero-divider">•</span>
                        <span>{settings.organization} ({settings.department})</span>
                      </div>
                      <h2 className="hero-title">لوحة التحكم والمؤشرات التشغيلية للمستودع والعهدة</h2>
                      <p className="hero-desc">
                        تم صرف <strong>{issuedPercentage}</strong> من إجمالي قيمة الوارد (<strong>{summary.qty_out.toLocaleString('ar-EG')}</strong> من <strong>{summary.qty_in.toLocaleString('ar-EG')}</strong> وحدة)، مع رصيد متبقٍ بقيمة <strong>{formatCurrency(summary.remaining_value, settings.currency)}</strong> موزع على <strong>{summary.pending_rows.toLocaleString('ar-EG')}</strong> بنداً بانتظار استكمال الصرف.
                      </p>
                      <div className="hero-actions">
                        <button type="button" className="primary-btn" onClick={() => navigate('/requests')}>
                          <ClipboardList size={16} /> طلبات الصرف الداخلي
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/custody')}>
                          <Building2 size={16} /> جرد عهد الكليات
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/quality')}>
                          <ShieldAlert size={17} /> فحص الجودة ({totalQualityIssues} ملاحظة)
                        </button>
                      </div>
                    </div>

                    <div className="hero-meter-wrap">
                      <div className="circular-meter">
                        <svg viewBox="0 0 100 100" className="meter-svg">
                          <circle className="meter-bg" cx="50" cy="50" r="40" />
                          <circle
                            className="meter-bar"
                            cx="50"
                            cy="50"
                            r="40"
                            strokeDasharray="251.2"
                            strokeDashoffset={251.2 - (251.2 * Math.min(100, Math.max(0, turnoverRateNum))) / 100}
                          />
                        </svg>
                        <div className="meter-content">
                          <span className="meter-val">{issuedPercentage}</span>
                          <span className="meter-lbl">نسبة الصرف</span>
                        </div>
                      </div>
                      <div className="meter-sub">
                        <span>معدل الدوران: <strong>{turnoverRate}%</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Operational Micro-Gauges Strip */}
                  <div className="operational-strip">
                    <div className="op-gauge-card card-surface">
                      <div className="op-head">
                        <span className="op-icon tone-emerald"><Percent size={16} /></span>
                        <span className="op-label">معدل دوران المخزون</span>
                      </div>
                      <div className="op-val">{turnoverRate}%</div>
                      <div className="op-progress-track">
                        <div className="op-progress-bar tone-emerald" style={{ width: `${Math.min(100, Math.max(5, turnoverRateNum))}%` }} />
                      </div>
                      <div className="op-foot">نسبة المنصرف من إجمالي الوارد</div>
                    </div>

                    <div className="op-gauge-card card-surface">
                      <div className="op-head">
                        <span className="op-icon tone-cyan"><CheckCircle2 size={16} /></span>
                        <span className="op-label">اكتمال أذونات الصرف</span>
                      </div>
                      <div className="op-val">{fulfillmentRatio}%</div>
                      <div className="op-progress-track">
                        <div className="op-progress-bar tone-cyan" style={{ width: `${Math.min(100, Math.max(5, fulfillmentRatio))}%` }} />
                      </div>
                      <div className="op-foot">{completedMovements} إذن صرف مكتمل كلياً</div>
                    </div>

                    <div className="op-gauge-card card-surface">
                      <div className="op-head">
                        <span className="op-icon tone-amber"><CircleDollarSign size={16} /></span>
                        <span className="op-label">متوسط تكلفة الوحدة</span>
                      </div>
                      <div className="op-val">{formatCurrency(avgUnitCost, settings.currency)}</div>
                      <div className="op-foot">المعدل المالي لكل وحدة واردة</div>
                    </div>

                    <div className="op-gauge-card card-surface">
                      <div className="op-head">
                        <span className="op-icon tone-indigo"><ShieldAlert size={16} /></span>
                        <span className="op-label">مؤشر سلامة البيانات</span>
                      </div>
                      <div className="op-val">{qualityHealthScore}%</div>
                      <div className="op-progress-track">
                        <div className="op-progress-bar tone-indigo" style={{ width: `${qualityHealthScore}%` }} />
                      </div>
                      <div className="op-foot">{totalQualityIssues === 0 ? 'سجلات نموذجية 100%' : `${totalQualityIssues} ملاحظة تحت التدقيق`}</div>
                    </div>
                  </div>

                  {/* 6 Main Warehouse KPI Cards */}
                  <div className="kpi-grid">
                    {kpis.map(({ id, label, value, badge, sub, tone, icon: Icon }) => (
                      <div key={id} className={`kpi-card card-surface tone-${tone}`}>
                        <div className="kpi-header-row">
                          <span className="kpi-icon-box">
                            <Icon size={20} strokeWidth={2.1} />
                          </span>
                          <span className="kpi-badge">{badge}</span>
                        </div>
                        <div className="kpi-label-text">{label}</div>
                        <strong className="kpi-main-val">{value}</strong>
                        <div className="kpi-footer-note">{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Dynamic Analytics & Timeline Chart */}
                  <div className="content-grid">
                    <div className="card-surface analytics-card">
                      <div className="section-head chart-section-head">
                        <div>
                          <h2><ChartNoAxesCombined size={19} /> التوزيع الزمني وحركة التوريد والصرف</h2>
                          <span>تحليل حركة الوارد والمنصرف المالي والكمي عبر الفترات المسجلة</span>
                        </div>
                        <div className="chart-metric-switch">
                          <button
                            type="button"
                            className={`switch-btn ${chartMetric === 'value' ? 'active' : ''}`}
                            onClick={() => setChartMetric('value')}
                          >
                            القيمة المالية ({settings.currency})
                          </button>
                          <button
                            type="button"
                            className={`switch-btn ${chartMetric === 'qty' ? 'active' : ''}`}
                            onClick={() => setChartMetric('qty')}
                          >
                            كميات الوحدات
                          </button>
                        </div>
                      </div>

                      <div className="chart-canvas-wrap">
                        <div className="chart-bars-area" aria-label="مخطط حركة المخزن">
                          {monthlyStats.map((item) => {
                            const valIn = chartMetric === 'value' ? item.inValue : item.inQty
                            const valOut = chartMetric === 'value' ? item.outValue : item.outQty
                            const heightIn = Math.max(12, Math.round((valIn / maxChartVal) * 100))
                            const heightOut = Math.max(10, Math.round((valOut / maxChartVal) * 100))
                            const isHovered = hoveredMonthKey === item.key

                            return (
                              <div
                                key={item.key}
                                tabIndex={0}
                                role="graphics-symbol"
                                aria-label={`${item.label}: وارد ${chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : `${item.inQty} وحدة`}, منصرف ${chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : `${item.outQty} وحدة`}`}
                                className={`chart-bar-group ${isHovered ? 'hovered' : ''}`}
                                onMouseEnter={() => setHoveredMonthKey(item.key)}
                                onMouseLeave={() => setHoveredMonthKey(null)}
                                onFocus={() => setHoveredMonthKey(item.key)}
                                onBlur={() => setHoveredMonthKey(null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    setHoveredMonthKey((curr) => (curr === item.key ? null : item.key))
                                  }
                                }}
                              >
                                {isHovered && (
                                  <div className="chart-tooltip">
                                    <div className="tooltip-title">{item.label}</div>
                                    <div className="tooltip-row in">
                                      <span>الوارد:</span>
                                      <strong>{chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : `${item.inQty.toLocaleString('ar-EG')} وحدة`}</strong>
                                    </div>
                                    <div className="tooltip-row out">
                                      <span>المنصرف:</span>
                                      <strong>{chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : `${item.outQty.toLocaleString('ar-EG')} وحدة`}</strong>
                                    </div>
                                    <div className="tooltip-row info">
                                      <span>الحركات:</span>
                                      <span>{item.count} حركة مسجلة</span>
                                    </div>
                                  </div>
                                )}
                                <div className="bars-pair">
                                  <div
                                    className="bar bar-received"
                                    style={{ height: `${heightIn}%` }}
                                    title={`وارد: ${chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : item.inQty}`}
                                  />
                                  <div
                                    className="bar bar-issued"
                                    style={{ height: `${heightOut}%` }}
                                    title={`منصرف: ${chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : item.outQty}`}
                                  />
                                </div>
                                <span className="month-axis-label">{item.label}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="chart-legend-footer">
                        <div className="legend-chip in">
                          <span className="legend-dot in-dot" />
                          <span>الوارد: {chartMetric === 'value' ? formatCurrency(summary.total_value, settings.currency) : `${summary.qty_in.toLocaleString('ar-EG')} وحدة`}</span>
                        </div>
                        <div className="legend-chip out">
                          <span className="legend-dot out-dot" />
                          <span>المنصرف: {chartMetric === 'value' ? formatCurrency(summary.issued_value, settings.currency) : `${summary.qty_out.toLocaleString('ar-EG')} وحدة`}</span>
                        </div>
                        <div className="legend-chip bal">
                          <span className="legend-dot bal-dot" />
                          <span>المتبقي: {chartMetric === 'value' ? formatCurrency(summary.remaining_value, settings.currency) : `${netStockUnits.toLocaleString('ar-EG')} وحدة`}</span>
                        </div>
                      </div>

                      {/* Accessible Data Table for Screen Readers & Keyboard users */}
                      <details className="chart-accessible-table-wrap px-4 pb-3">
                        <summary className="text-xs text-muted cursor-pointer hover:underline py-1">
                          عرض بيانات المخطط كجدول نصي للقراءة والوصولية
                        </summary>
                        <div className="table-card mt-2">
                          <table aria-label="بيانات حركة التوريد والصرف الشهرية">
                            <thead>
                              <tr>
                                <th>الفترة</th>
                                <th>الوارد ({chartMetric === 'value' ? settings.currency : 'وحدة'})</th>
                                <th>المنصرف ({chartMetric === 'value' ? settings.currency : 'وحدة'})</th>
                                <th>عدد العمليات</th>
                              </tr>
                            </thead>
                            <tbody>
                              {monthlyStats.map((item) => (
                                <tr key={`table-summary-${item.key}`}>
                                  <td>{item.label}</td>
                                  <td>{chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : item.inQty.toLocaleString('ar-EG')}</td>
                                  <td>{chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : item.outQty.toLocaleString('ar-EG')}</td>
                                  <td>{item.count.toLocaleString('ar-EG')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </div>
                  </div>

                  {/* Custody & Assets across the 8 Colleges */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 size={19} className="text-accent" />
                        <h3 className="m-0 text-lg font-bold text-ink">
                          إحصائيات وتحليلات عهد وأصول كليات المؤسسة (8 كليات)
                        </h3>
                      </div>
                      <button
                        type="button"
                        className="secondary-btn btn-sm"
                        onClick={() => navigate('/reports')}
                      >
                        <FileSpreadsheet size={14} /> الانتقال لمركز التقارير
                      </button>
                    </div>

                    <CustodyAnalyticsDashboard
                      items={custodyItems}
                      currency={settings.currency}
                      onSelectWarehouse={(whId) => navigate(`/custody?warehouse=${whId}`)}
                      onExportAllExcel={() => navigate('/reports')}
                    />
                  </div>

                  {/* Recent Warehouse Movements Table */}
                  <div className="lower-grid">
                    <div className="card-surface table-card">
                      <div className="section-head table-section-head">
                        <div>
                          <h2><ClipboardList size={18} /> أحدث حركات المستودع</h2>
                          <span>متابعة فورية لحركات الإضافة والصرف</span>
                        </div>
                        <div className="table-filter-pills">
                          <button
                            type="button"
                            className={`filter-tab ${tableFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setTableFilter('all')}
                          >
                            الكل ({movements.length})
                          </button>
                          <button
                            type="button"
                            className={`filter-tab ${tableFilter === 'full' ? 'active' : ''}`}
                            onClick={() => setTableFilter('full')}
                          >
                            مكتمل ({completedMovements})
                          </button>
                          <button
                            type="button"
                            className={`filter-tab ${tableFilter === 'part' ? 'active' : ''}`}
                            onClick={() => setTableFilter('part')}
                          >
                            جزئي ({partialMovements})
                          </button>
                          <button
                            type="button"
                            className={`filter-tab ${tableFilter === 'pending' ? 'active' : ''}`}
                            onClick={() => setTableFilter('pending')}
                          >
                            معلق ({pendingMovements})
                          </button>
                        </div>
                      </div>

                      <div className="table-scroll-container">
                        <table>
                          <thead>
                            <tr>
                              <th>الصنف والمصدر</th>
                              <th>المستلم</th>
                              <th>الكميات (وارد / منصرف)</th>
                              <th>الحالة</th>
                              <th>القيمة</th>
                              <th className="actions-header">الإجراءات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRecentMovements.length === 0 ? (
                              <tr>
                                <td className="table-empty" colSpan={6}>لا توجد حركات مسجلة ضمن هذا التصنيف.</td>
                              </tr>
                            ) : (
                              filteredRecentMovements.map((movement, idx) => {
                                const derived = deriveMovement(movement, idx)
                                const value = derived.total ?? 0
                                const status = derived.status === 'full' ? 'مكتمل'
                                  : derived.status === 'part' ? 'جزئي'
                                    : derived.status === 'over' ? 'تجاوز'
                                      : 'معلق'

                                return (
                                  <tr key={movement.id || idx}>
                                    <td>
                                      <div className="cell-item-name">{movement.item}</div>
                                      <small className="cell-sub">{movement.from ? `المورد: ${movement.from}` : 'بدون مورد'}</small>
                                    </td>
                                    <td>
                                      <span className="recipient-badge">{movement.to || 'غير محدد'}</span>
                                    </td>
                                    <td className="quantity-cell">
                                      <span className="qty-in-tag">+{movement.qin}</span>
                                      <span className="qty-sep">/</span>
                                      <span className="qty-out-tag">-{movement.qout}</span>
                                    </td>
                                    <td>
                                      <span className={`status-pill ${status === 'مكتمل' ? 'ok' : status === 'جزئي' ? 'warn' : 'info'}`}>
                                        {status}
                                      </span>
                                    </td>
                                    <td className="table-value-cell">
                                      <strong>{formatCurrency(value, settings.currency)}</strong>
                                    </td>
                                    <td className="actions-cell">
                                      {canEdit ? (
                                        <div className="action-buttons-wrap">
                                          <button
                                            type="button"
                                            className="table-action-btn edit-action-btn"
                                            onClick={() => setEditingMovement(movement)}
                                            title="تعديل تفاصيل الحركة"
                                            aria-label={`تعديل حركة ${movement.item}`}
                                          >
                                            <Pencil size={14} />
                                            <span>تعديل</span>
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="read-only-badge" title="صلاحية قراءة وعرض فقط">
                                          <Eye size={13} /> عرض فقط
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="table-card-footer">
                        <button type="button" className="text-link-btn" onClick={() => navigate('/analytics')}>
                          عرض تحليلات الدوران الكاملة <ArrowLeft size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="stack-column">
                      <div className="card-surface info-card">
                        <div className="section-head">
                          <div>
                            <h2><ShieldAlert size={18} /> جودة وصحة البيانات</h2>
                            <span>فحص دوري لسلامة السجلات والأذونات</span>
                          </div>
                          <span className="score-pill">{qualityHealthScore}% سليم</span>
                        </div>

                        <div className="quality-list">
                          {qualityCards.length === 0 ? (
                            <div className="quality-empty">
                              <CheckCircle2 size={24} className="ok-icon" />
                              <span>كافة البيانات مكتملة وخالية من الملاحظات!</span>
                            </div>
                          ) : (
                            qualityCards.map(({ rule, count, level, text }) => (
                              <div key={rule} className={`quality-item ${level}`}>
                                <span className="quality-text">{text}</span>
                                <strong className="quality-badge">{count}</strong>
                              </div>
                            ))
                          )}
                        </div>
                        <button type="button" className="outline-btn w-full mt-2" onClick={() => navigate('/quality')}>
                          فتح تقرير الجودة الكامل <ArrowLeft size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                /* ─── 3. المنظومة الموحدة الشاملة (الأدمن ومدير النظام) ─── */
                <section className="dashboard-grid admin-unified-dashboard">
                  <div className="hero-overview-card card-surface unified-hero">
                    <div className="hero-main-content">
                      <div className="hero-status-tag tone-indigo">
                        <span className="live-pulse-dot" />
                        <span>المنظومة الموحدة الشاملة</span>
                        <span className="hero-divider">•</span>
                        <span>المخازن والمشتريات والعهدة</span>
                      </div>
                      <h2 className="hero-title">اللوحة القيادية الموحدة للمخازن والمشتريات</h2>
                      <p className="hero-desc">
                        نظرة استراتيجية متكاملة لجامعة الزقازيق الأهلية تجمع بين رصيد المخزون، معدلات دوران الأصناف، عهد الكليات الـ 8، وتدفقات الإنفاق والموردين وأوامر الشراء.
                      </p>
                      <div className="hero-actions">
                        <button type="button" className="primary-btn" onClick={() => navigate('/purchases?tab=add')}>
                          <Plus size={16} /> إضافة توريد شراء
                        </button>
                        <button type="button" className="secondary-btn" onClick={() => navigate('/requests')}>
                          <ClipboardList size={16} /> طلبات الصرف
                        </button>
                        <button type="button" className="outline-btn" onClick={() => navigate('/reports')}>
                          <FileSpreadsheet size={16} /> التقارير الموحدة
                        </button>
                      </div>
                    </div>

                    <div className="hero-meter-wrap">
                      <div className="circular-meter">
                        <svg viewBox="0 0 100 100" className="meter-svg">
                          <circle className="meter-bg" cx="50" cy="50" r="40" />
                          <circle
                            className="meter-bar"
                            cx="50"
                            cy="50"
                            r="40"
                            strokeDasharray="251.2"
                            strokeDashoffset={251.2 - (251.2 * Math.min(100, Math.max(0, turnoverRateNum))) / 100}
                          />
                        </svg>
                        <div className="meter-content">
                          <span className="meter-val">{turnoverRate}%</span>
                          <span className="meter-lbl">دوران المخزون</span>
                        </div>
                      </div>
                      <div className="meter-sub">
                        <span>سلامة البيانات: <strong>{qualityHealthScore}%</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Dual Department Switcher Tabs for Admins */}
                  <div className="card-surface dashboard-analytics-bar">
                    <div className="flex items-center gap-2">
                      <BarChart3 size={18} className="text-accent" />
                      <strong className="font-sm text-ink">لوحة التحليلات والإحصائيات الشاملة للمؤسسة:</strong>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        className={`secondary-btn ${dashboardAnalyticsTab === 'all' ? 'active' : ''}`}
                        onClick={() => setDashboardAnalyticsTab('all')}
                      >
                        <Sparkles size={14} /> المنظومة الموحدة الشاملة (القسمين)
                      </button>

                      <button
                        type="button"
                        className={`secondary-btn ${dashboardAnalyticsTab === 'movements' ? 'active' : ''}`}
                        onClick={() => setDashboardAnalyticsTab('movements')}
                      >
                        <TrendingUp size={14} /> تحليلات إدارة المخازن والعهدة
                      </button>

                      <button
                        type="button"
                        className={`secondary-btn ${dashboardAnalyticsTab === 'procurement' ? 'active' : ''}`}
                        onClick={() => setDashboardAnalyticsTab('procurement')}
                      >
                        <Receipt size={14} /> تحليلات إدارة المشتريات والعقود
                      </button>

                      <button
                        type="button"
                        className={`secondary-btn ${dashboardAnalyticsTab === 'custody' ? 'active' : ''}`}
                        onClick={() => setDashboardAnalyticsTab('custody')}
                      >
                        <Building2 size={14} /> عهد كليات الجامعة (8 مخازن)
                      </button>
                    </div>
                  </div>

                  {/* Procurement Analytics View */}
                  {(dashboardAnalyticsTab === 'all' || dashboardAnalyticsTab === 'procurement') && (
                    <div className="mt-2">
                      <ProcurementAnalyticsDashboard
                        movements={movements}
                        currency={settings.currency}
                        isDashboardEmbed={true}
                      />
                    </div>
                  )}

                  {/* Movements Analytics: Gauges, KPIs, Chart */}
                  {(dashboardAnalyticsTab === 'all' || dashboardAnalyticsTab === 'movements') && (
                    <>
                      <div className="operational-strip">
                        <div className="op-gauge-card card-surface">
                          <div className="op-head">
                            <span className="op-icon tone-emerald"><Percent size={16} /></span>
                            <span className="op-label">معدل دوران المخزون</span>
                          </div>
                          <div className="op-val">{turnoverRate}%</div>
                          <div className="op-progress-track">
                            <div className="op-progress-bar tone-emerald" style={{ width: `${Math.min(100, Math.max(5, turnoverRateNum))}%` }} />
                          </div>
                          <div className="op-foot">نسبة المنصرف من إجمالي الوارد</div>
                        </div>

                        <div className="op-gauge-card card-surface">
                          <div className="op-head">
                            <span className="op-icon tone-cyan"><CheckCircle2 size={16} /></span>
                            <span className="op-label">اكتمال أذونات الصرف</span>
                          </div>
                          <div className="op-val">{fulfillmentRatio}%</div>
                          <div className="op-progress-track">
                            <div className="op-progress-bar tone-cyan" style={{ width: `${Math.min(100, Math.max(5, fulfillmentRatio))}%` }} />
                          </div>
                          <div className="op-foot">{completedMovements} إذن صرف مكتمل كلياً</div>
                        </div>

                        <div className="op-gauge-card card-surface">
                          <div className="op-head">
                            <span className="op-icon tone-amber"><CircleDollarSign size={16} /></span>
                            <span className="op-label">متوسط تكلفة الوحدة</span>
                          </div>
                          <div className="op-val">{formatCurrency(avgUnitCost, settings.currency)}</div>
                          <div className="op-foot">المعدل المالي لكل وحدة واردة</div>
                        </div>

                        <div className="op-gauge-card card-surface">
                          <div className="op-head">
                            <span className="op-icon tone-indigo"><ShieldAlert size={16} /></span>
                            <span className="op-label">مؤشر سلامة البيانات</span>
                          </div>
                          <div className="op-val">{qualityHealthScore}%</div>
                          <div className="op-progress-track">
                            <div className="op-progress-bar tone-indigo" style={{ width: `${qualityHealthScore}%` }} />
                          </div>
                          <div className="op-foot">{totalQualityIssues === 0 ? 'سجلات نموذجية 100%' : `${totalQualityIssues} ملاحظة تحت التدقيق`}</div>
                        </div>
                      </div>

                      <div className="kpi-grid">
                        {kpis.map(({ id, label, value, badge, sub, tone, icon: Icon }) => (
                          <div key={id} className={`kpi-card card-surface tone-${tone}`}>
                            <div className="kpi-header-row">
                              <span className="kpi-icon-box">
                                <Icon size={20} strokeWidth={2.1} />
                              </span>
                              <span className="kpi-badge">{badge}</span>
                            </div>
                            <div className="kpi-label-text">{label}</div>
                            <strong className="kpi-main-val">{value}</strong>
                            <div className="kpi-footer-note">{sub}</div>
                          </div>
                        ))}
                      </div>

                      <div className="content-grid">
                        <div className="card-surface analytics-card">
                          <div className="section-head chart-section-head">
                            <div>
                              <h2><ChartNoAxesCombined size={19} /> التوزيع الزمني وحركة التوريد والصرف</h2>
                              <span>تحليل حركة الوارد والمنصرف المالي والكمي عبر الفترات المسجلة</span>
                            </div>
                            <div className="chart-metric-switch">
                              <button
                                type="button"
                                className={`switch-btn ${chartMetric === 'value' ? 'active' : ''}`}
                                onClick={() => setChartMetric('value')}
                              >
                                القيمة المالية ({settings.currency})
                              </button>
                              <button
                                type="button"
                                className={`switch-btn ${chartMetric === 'qty' ? 'active' : ''}`}
                                onClick={() => setChartMetric('qty')}
                              >
                                كميات الوحدات
                              </button>
                            </div>
                          </div>

                          <div className="chart-canvas-wrap">
                            <div className="chart-bars-area" aria-label="مخطط حركة المخزن">
                              {monthlyStats.map((item) => {
                                const valIn = chartMetric === 'value' ? item.inValue : item.inQty
                                const valOut = chartMetric === 'value' ? item.outValue : item.outQty
                                const heightIn = Math.max(12, Math.round((valIn / maxChartVal) * 100))
                                const heightOut = Math.max(10, Math.round((valOut / maxChartVal) * 100))
                                const isHovered = hoveredMonthKey === item.key

                                return (
                                  <div
                                    key={item.key}
                                    tabIndex={0}
                                    role="graphics-symbol"
                                    aria-label={`${item.label}: وارد ${chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : `${item.inQty} وحدة`}, منصرف ${chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : `${item.outQty} وحدة`}`}
                                    className={`chart-bar-group ${isHovered ? 'hovered' : ''}`}
                                    onMouseEnter={() => setHoveredMonthKey(item.key)}
                                    onMouseLeave={() => setHoveredMonthKey(null)}
                                    onFocus={() => setHoveredMonthKey(item.key)}
                                    onBlur={() => setHoveredMonthKey(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        setHoveredMonthKey((curr) => (curr === item.key ? null : item.key))
                                      }
                                    }}
                                  >
                                    {isHovered && (
                                      <div className="chart-tooltip">
                                        <div className="tooltip-title">{item.label}</div>
                                        <div className="tooltip-row in">
                                          <span>الوارد:</span>
                                          <strong>{chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : `${item.inQty.toLocaleString('ar-EG')} وحدة`}</strong>
                                        </div>
                                        <div className="tooltip-row out">
                                          <span>المنصرف:</span>
                                          <strong>{chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : `${item.outQty.toLocaleString('ar-EG')} وحدة`}</strong>
                                        </div>
                                        <div className="tooltip-row info">
                                          <span>الحركات:</span>
                                          <span>{item.count} حركة مسجلة</span>
                                        </div>
                                      </div>
                                    )}
                                    <div className="bars-pair">
                                      <div
                                        className="bar bar-received"
                                        style={{ height: `${heightIn}%` }}
                                        title={`وارد: ${chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : item.inQty}`}
                                      />
                                      <div
                                        className="bar bar-issued"
                                        style={{ height: `${heightOut}%` }}
                                        title={`منصرف: ${chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : item.outQty}`}
                                      />
                                    </div>
                                    <span className="month-axis-label">{item.label}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          <div className="chart-legend-footer">
                            <div className="legend-chip in">
                              <span className="legend-dot in-dot" />
                              <span>الوارد: {chartMetric === 'value' ? formatCurrency(summary.total_value, settings.currency) : `${summary.qty_in.toLocaleString('ar-EG')} وحدة`}</span>
                            </div>
                            <div className="legend-chip out">
                              <span className="legend-dot out-dot" />
                              <span>المنصرف: {chartMetric === 'value' ? formatCurrency(summary.issued_value, settings.currency) : `${summary.qty_out.toLocaleString('ar-EG')} وحدة`}</span>
                            </div>
                            <div className="legend-chip bal">
                              <span className="legend-dot bal-dot" />
                              <span>المتبقي: {chartMetric === 'value' ? formatCurrency(summary.remaining_value, settings.currency) : `${netStockUnits.toLocaleString('ar-EG')} وحدة`}</span>
                            </div>
                          </div>

                          {/* Accessible Data Table for Screen Readers & Keyboard users */}
                          <details className="chart-accessible-table-wrap px-4 pb-3">
                            <summary className="text-xs text-muted cursor-pointer hover:underline py-1">
                              عرض بيانات المخطط كجدول نصي للقراءة والوصولية
                            </summary>
                            <div className="table-card mt-2">
                              <table aria-label="بيانات حركة التوريد والصرف عبر الأشهر">
                                <thead>
                                  <tr>
                                    <th>الفترة</th>
                                    <th>الوارد ({chartMetric === 'value' ? settings.currency : 'وحدة'})</th>
                                    <th>المنصرف ({chartMetric === 'value' ? settings.currency : 'وحدة'})</th>
                                    <th>عدد العمليات</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {monthlyStats.map((item) => (
                                    <tr key={`table-view-${item.key}`}>
                                      <td>{item.label}</td>
                                      <td>{chartMetric === 'value' ? formatCurrency(item.inValue, settings.currency) : item.inQty.toLocaleString('ar-EG')}</td>
                                      <td>{chartMetric === 'value' ? formatCurrency(item.outValue, settings.currency) : item.outQty.toLocaleString('ar-EG')}</td>
                                      <td>{item.count.toLocaleString('ar-EG')}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Custody View */}
                  {(dashboardAnalyticsTab === 'all' || dashboardAnalyticsTab === 'custody') && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <Building2 size={19} className="text-accent" />
                          <h3 className="m-0 text-lg font-bold text-ink">
                            إحصائيات وتحليلات عهد وأصول كليات المؤسسة (8 كليات)
                          </h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn btn-sm"
                          onClick={() => navigate('/reports')}
                        >
                          <FileSpreadsheet size={14} /> الانتقال لمركز التقارير
                        </button>
                      </div>

                      <CustodyAnalyticsDashboard
                        items={custodyItems}
                        currency={settings.currency}
                        onSelectWarehouse={(whId) => navigate(`/custody?warehouse=${whId}`)}
                        onExportAllExcel={() => navigate('/reports')}
                      />
                    </div>
                  )}

                  {/* Recent Table in Unified View */}
                  {dashboardAnalyticsTab !== 'procurement' && (
                    <div className="lower-grid">
                      <div className="card-surface table-card">
                        <div className="section-head table-section-head">
                          <div>
                            <h2><ClipboardList size={18} /> أحدث حركات المستودع</h2>
                            <span>متابعة فورية لحركات الإضافة والصرف</span>
                          </div>
                          <div className="table-filter-pills">
                            <button
                              type="button"
                              className={`filter-tab ${tableFilter === 'all' ? 'active' : ''}`}
                              onClick={() => setTableFilter('all')}
                            >
                              الكل ({movements.length})
                            </button>
                            <button
                              type="button"
                              className={`filter-tab ${tableFilter === 'full' ? 'active' : ''}`}
                              onClick={() => setTableFilter('full')}
                            >
                              مكتمل ({completedMovements})
                            </button>
                            <button
                              type="button"
                              className={`filter-tab ${tableFilter === 'part' ? 'active' : ''}`}
                              onClick={() => setTableFilter('part')}
                            >
                              جزئي ({partialMovements})
                            </button>
                            <button
                              type="button"
                              className={`filter-tab ${tableFilter === 'pending' ? 'active' : ''}`}
                              onClick={() => setTableFilter('pending')}
                            >
                              معلق ({pendingMovements})
                            </button>
                          </div>
                        </div>

                        <div className="table-scroll-container">
                          <table>
                            <thead>
                              <tr>
                                <th>الصنف والمصدر</th>
                                <th>المستلم</th>
                                <th>الكميات (وارد / منصرف)</th>
                                <th>الحالة</th>
                                <th>القيمة</th>
                                <th className="actions-header">الإجراءات</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredRecentMovements.length === 0 ? (
                                <tr>
                                  <td className="table-empty" colSpan={6}>لا توجد حركات مسجلة ضمن هذا التصنيف.</td>
                                </tr>
                              ) : (
                                filteredRecentMovements.map((movement, idx) => {
                                  const derived = deriveMovement(movement, idx)
                                  const value = derived.total ?? 0
                                  const status = derived.status === 'full' ? 'مكتمل'
                                    : derived.status === 'part' ? 'جزئي'
                                      : derived.status === 'over' ? 'تجاوز'
                                        : 'معلق'

                                  return (
                                    <tr key={movement.id || idx}>
                                      <td>
                                        <div className="cell-item-name">{movement.item}</div>
                                        <small className="cell-sub">{movement.from ? `المورد: ${movement.from}` : 'بدون مورد'}</small>
                                      </td>
                                      <td>
                                        <span className="recipient-badge">{movement.to || 'غير محدد'}</span>
                                      </td>
                                      <td className="quantity-cell">
                                        <span className="qty-in-tag">+{movement.qin}</span>
                                        <span className="qty-sep">/</span>
                                        <span className="qty-out-tag">-{movement.qout}</span>
                                      </td>
                                      <td>
                                        <span className={`status-pill ${status === 'مكتمل' ? 'ok' : status === 'جزئي' ? 'warn' : 'info'}`}>
                                          {status}
                                        </span>
                                      </td>
                                      <td className="table-value-cell">
                                        <strong>{formatCurrency(value, settings.currency)}</strong>
                                      </td>
                                      <td className="actions-cell">
                                        {canEdit ? (
                                          <div className="action-buttons-wrap">
                                            <button
                                              type="button"
                                              className="table-action-btn edit-action-btn"
                                              onClick={() => setEditingMovement(movement)}
                                              title="تعديل تفاصيل الحركة"
                                              aria-label={`تعديل حركة ${movement.item}`}
                                            >
                                              <Pencil size={14} />
                                              <span>تعديل</span>
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="read-only-badge" title="صلاحية قراءة وعرض فقط">
                                            <Eye size={13} /> عرض فقط
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className="table-card-footer">
                          <button type="button" className="text-link-btn" onClick={() => navigate('/movements')}>
                            عرض كافة الحركات في السجل الكامل ({movements.length.toLocaleString('ar-EG')} حركة) <ArrowLeft size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="stack-column">
                        <div className="card-surface info-card">
                          <div className="section-head">
                            <div>
                              <h2><ShieldAlert size={18} /> جودة وصحة البيانات</h2>
                              <span>فحص دوري لسلامة السجلات والأذونات</span>
                            </div>
                            <span className="score-pill">{qualityHealthScore}% سليم</span>
                          </div>

                          <div className="quality-list">
                            {qualityCards.length === 0 ? (
                              <div className="quality-empty">
                                <CheckCircle2 size={24} className="ok-icon" />
                                <span>كافة البيانات مكتملة وخالية من الملاحظات!</span>
                              </div>
                            ) : (
                              qualityCards.map(({ rule, count, level, text }) => (
                                <div key={rule} className={`quality-item ${level}`}>
                                  <span className="quality-text">{text}</span>
                                  <strong className="quality-badge">{count}</strong>
                                </div>
                              ))
                            )}
                          </div>
                          <button type="button" className="outline-btn w-full mt-2" onClick={() => navigate('/quality')}>
                            فتح تقرير الجودة الكامل <ArrowLeft size={14} />
                          </button>
                        </div>

                        {isSystemAdmin && (
                          <div className="card-surface activity-card">
                            <div className="section-head">
                              <div>
                                <h2><Activity size={18} /> سجل العمليات الأخير</h2>
                                <span>أحدث الإجراءات والتدقيق (خاص بمدير النظام)</span>
                              </div>
                              <button type="button" className="text-link-btn" onClick={() => navigate('/audit')}>
                                عرض السجل <ArrowLeft size={13} />
                              </button>
                            </div>

                            <ul className="activity-list">
                              {auditEvents.length > 0 ? (
                                auditEvents.slice(0, 4).map((event) => (
                                  <li key={event.id} className="activity-item info">
                                    <div className="dot" />
                                    <div className="activity-details">
                                      <strong>{event.action}</strong>
                                      <div className="activity-meta">
                                        <span>{event.user_email || 'مستخدم النظام'}</span>
                                        <span>•</span>
                                        <small>{new Date(event.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</small>
                                      </div>
                                    </div>
                                  </li>
                                ))
                              ) : (
                                <li className="activity-empty-state">
                                  <History size={24} className="opacity-50 mb-1" />
                                  <div>لا توجد عمليات مسجلة حديثاً في سجل التدقيق.</div>
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )
            }
          />

          <Route
            path="/movements/edit/:id"
            element={
              isSystemAdmin ? (
                <MovementEditPage
                  movements={movements}
                  onSave={async (m) => { await updateExistingMovement(m); navigate('/movements') }}
                  onCancel={() => navigate('/movements')}
                />
              ) : (
                <RestrictedScreen
                  title="تعديل حركة المخزن"
                  subtitle="سجل حركات المخزن"
                  message="تعديل وحذف الحركات والبيانات في النظام مقتصر حصرياً على مدير النظام (System Admin)."
                />
              )
            }
          />
          <Route
            path="/purchases"
            element={
              canAccessRoute(session, '/purchases') ? (
                <PurchasesPage
                  movements={movements}
                  currency={settings.currency}
                  onSaveMovement={addMovement}
                  onEdit={canManageRecords ? (m) => setEditingMovement(m) : () => {}}
                  onLoadDemoData={handleLoadDemoData}
                  canEdit={canEdit}
                  isSystemAdmin={isSystemAdmin}
                  session={session}
                  globalSearchTerm={searchTerm}
                />
              ) : (
                <RestrictedScreen
                  title="المشتريات والتوريدات"
                  subtitle="صلاحية مقيدة"
                  message="صفحة المشتريات والتوريدات وفواتير الشراء مقتصرة حصرياً على موظفي المشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route path="/movements" element={<Navigate to="/purchases" replace />} />
          <Route path="/movements/new" element={<Navigate to="/purchases?tab=add" replace />} />
          <Route path="/purchases/requests" element={<Navigate to="/purchases" replace />} />
          <Route path="/purchases/requests/new" element={<Navigate to="/purchases?tab=add" replace />} />
          <Route
            path="/purchases/suppliers"
            element={
              canAccessRoute(session, '/purchases/suppliers') ? (
                <SuppliersPage session={session} />
              ) : (
                <RestrictedScreen
                  title="إدارة الموردين"
                  subtitle="صلاحية مقيدة"
                  message="سجل إدارة الموردين والشركات مقتصر حصرياً على موظفي المشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route
            path="/purchases/quotes"
            element={
              canAccessRoute(session, '/purchases/quotes') ? (
                <QuotesPage session={session} currency={settings.currency} />
              ) : (
                <RestrictedScreen
                  title="عروض الأسعار وأوامر الشراء"
                  subtitle="صلاحية مقيدة"
                  message="عروض الأسعار وإصدار أوامر الشراء مقتصرة حصرياً على موظفي المشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route path="/purchases/analytics" element={<Navigate to="/" replace />} />
          <Route path="/suppliers" element={<Navigate to="/purchases/suppliers" replace />} />
          <Route path="/quotes" element={<Navigate to="/purchases/quotes" replace />} />
          <Route
            path="/custody"
            element={
              canAccessRoute(session, '/custody') ? (
                <CustodyPage
                  settings={settings}
                  session={session}
                  globalSearchTerm={searchTerm}
                  movements={movements}
                  onSaveMovement={addMovement}
                />
              ) : (
                <RestrictedScreen
                  title="عهدة المخازن"
                  subtitle="صلاحية مقيدة"
                  message="سجل وإدارة عهدة المخازن مقتصر حصرياً على موظفي ومشرفي المخازن وإدارة النظام."
                />
              )
            }
          />
          <Route
            path="/reports"
            element={
              canAccessRoute(session, '/reports') ? (
                <ReportsPage
                  movements={movements}
                  settings={settings}
                  currency={settings.currency}
                  session={session}
                  custodyItems={custodyItems}
                  onExportMovements={() => exportMovements(movements)}
                />
              ) : (
                <RestrictedScreen
                  title="التقارير الرسمية"
                  subtitle="صلاحية مقيدة"
                  message="التقارير الرسمية وكشوف الجرد مقتصرة على موظفي المخازن والمشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route
            path="/imports"
            element={
              canAccessRoute(session, '/imports') ? (
                <ImportPage onImport={mergeImportedMovements} session={session} />
              ) : (
                <RestrictedScreen
                  title="استيراد Excel"
                  subtitle="صلاحية مقيدة"
                  message="استيراد البيانات وتحديث السجلات مقتصر حصرياً على موظفي المشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route
            path="/quality"
            element={
              canAccessRoute(session, '/quality') ? (
                <QualityPage session={session} movements={movements} onInspect={(item) => { setSearchTerm(item); navigate('/purchases') }} />
              ) : (
                <RestrictedScreen
                  title="فحص الجودة"
                  subtitle="صلاحية مقيدة"
                  message="فحص الجودة وتدقيق البيانات مقتصر حصرياً على مسؤولي المخازن وإدارة النظام."
                />
              )
            }
          />
          <Route
            path="/audit"
            element={
              canAccessRoute(session, '/audit') ? (
                <AuditLogPage session={session} />
              ) : (
                <RestrictedScreen
                  title="سجل العمليات والتدقيق"
                  subtitle="مراقبة العمليات والأمان"
                  message="سجل العمليات والمراقبة مخصص حصرياً لمدير النظام أو الحسابات المخولة بصلاحية عرض السجل."
                />
              )
            }
          />
          <Route
            path="/users"
            element={
              canAccessRoute(session, '/users') ? (
                <UsersPage session={session} />
              ) : (
                <RestrictedScreen
                  title="المستخدمون والصلاحيات"
                  subtitle="إدارة الحسابات والأمان"
                  message="إدارة الحسابات والصلاحيات وكلمات المرور مخصصة حصرياً لمدير النظام (System Admin) فقط."
                />
              )
            }
          />
          <Route
            path="/telegram-bot"
            element={
              canAccessRoute(session, '/telegram-bot') ? (
                <TelegramBotPage session={session} />
              ) : (
                <RestrictedScreen
                  title="إدارة بوت تيليجرام"
                  subtitle="صلاحية مقيدة"
                  message="إدارة وتخصيص بوت تيليجرام مقتصرة حصرياً على مدير النظام (System Admin) فقط."
                />
              )
            }
          />
          <Route
            path="/chatbot-admin"
            element={
              canAccessRoute(session, '/chatbot-admin') ? (
                <ChatbotAdminPage session={session} />
              ) : (
                <RestrictedScreen
                  title="إدارة وتوجيه المساعد الذكي"
                  subtitle="صلاحية مقيدة"
                  message="منصة توجيه المساعد الذكي وتعديل الأكواد مقتصرة حصرياً على مدير النظام (System Admin) فقط."
                />
              )
            }
          />
          <Route
            path="/settings"
            element={
              canAccessRoute(session, '/settings') ? (
                <SettingsPage settings={settings} darkMode={darkMode} session={session} onSave={handleSaveSettings} onToggleTheme={() => setDarkMode((value) => !value)} />
              ) : (
                <RestrictedScreen
                  title="إعدادات المؤسسة"
                  subtitle="لوحة إدارة المخزن"
                  message="إعدادات وبيانات المؤسسة والشعار مخصصة حصرياً لمدير النظام أو الحسابات المخولة بصلاحية الإعدادات."
                />
              )
            }
          />
          <Route
            path="/requests"
            element={
              canAccessRoute(session, '/requests') ? (
                <DisbursementRequestsPage session={session} />
              ) : (
                <RestrictedScreen
                  title="طلبات الصرف الداخلي"
                  subtitle="صلاحية مقيدة"
                  message="طلبات الصرف الداخلي مقتصرة على موظفي ومسؤولي المخازن والأقسام المعتمدة."
                />
              )
            }
          />
          <Route
            path="/notifications"
            element={<NotificationsPage session={session} />}
          />
          <Route
            path="/analytics"
            element={
              canAccessRoute(session, '/analytics') ? (
                <InventoryAnalyticsPage
                  session={session}
                  movements={movements}
                  custodyItems={custodyItems}
                  currency={settings.currency}
                />
              ) : (
                <RestrictedScreen
                  title="تحليلات المخزون"
                  subtitle="صلاحية مقيدة"
                  message="تحليلات المخزون مقتصرة على الحسابات المخولة."
                />
              )
            }
          />
          <Route
            path="/purchases/contracts"
            element={
              canAccessRoute(session, '/purchases/contracts') ? (
                <ContractsPage session={session} />
              ) : (
                <RestrictedScreen
                  title="إدارة العقود"
                  subtitle="صلاحية مقيدة"
                  message="عقود الموردين مقتصرة حصرياً على موظفي المشتريات وإدارة النظام."
                />
              )
            }
          />
          <Route path="/contracts" element={<Navigate to="/purchases/contracts" replace />} />
          <Route
            path="/asset-history"
            element={
              canAccessRoute(session, '/asset-history') ? (
                <AssetHistoryPage session={session} />
              ) : (
                <RestrictedScreen
                  title="سجل حركة الأصول"
                  subtitle="صلاحية مقيدة"
                  message="سجل حركة وتتبع الأصول مقتصر على مسؤولي العهدة والمخازن."
                />
              )
            }
          />
          <Route
            path="/financial-reports"
            element={
              canAccessRoute(session, '/financial-reports') ? (
                <FinancialReportsPage session={session} currency={settings.currency} />
              ) : (
                <RestrictedScreen
                  title="التقارير المالية الدورية"
                  subtitle="صلاحية مقيدة"
                  message="التقارير المالية مقتصرة على الإدارة المالية والمشرفين ومدير النظام."
                />
              )
            }
          />
          <Route
            path="/budget"
            element={
              canAccessRoute(session, '/budget') ? (
                <BudgetPage session={session} currency={settings.currency} />
              ) : (
                <RestrictedScreen
                  title="الميزانية والتخطيط"
                  subtitle="صلاحية مقيدة"
                  message="إدارة الميزانية والتخطيط مقتصرة على الإدارة العليا والمشرفين الماليين."
                />
              )
            }
          />
          <Route
            path="/support"
            element={<SupportPage session={session} />}
          />
          <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </motion.div>
      </AnimatePresence>

        <AnimatePresence>
          {canManageRecords && editingMovement && (
            <AccessibleDialog
              isOpen={true}
              onClose={() => !isUpdating && setEditingMovement(null)}
              titleId="edit-movement-title"
              dialogClassName="modal-dialog modal-dialog-form"
              closeOnBackdropClick={!isUpdating}
              closeOnEscape={!isUpdating}
            >
              <div className="modal-header">
                <div className="modal-title-wrap">
                  <div className="modal-title-icon"><Pencil size={18} /></div>
                  <div>
                    <h3 id="edit-movement-title">تعديل حركة المخزن</h3>
                    <span className="modal-subtitle">{editingMovement.item}</span>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => !isUpdating && setEditingMovement(null)} disabled={isUpdating} aria-label="إغلاق">
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <MovementForm
                  initialMovement={editingMovement}
                  isModal
                  onSave={async (updated) => {
                    setIsUpdating(true)
                    try {
                      await updateExistingMovement(updated)
                      setEditingMovement(null)
                    } finally {
                      setIsUpdating(false)
                    }
                  }}
                  onCancel={() => !isUpdating && setEditingMovement(null)}
                />
              </div>
            </AccessibleDialog>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {canManageRecords && deletingMovement && (
            <AccessibleDialog
              isOpen={true}
              role="alertdialog"
              onClose={() => !isDeleting && setDeletingMovement(null)}
              titleId="delete-movement-title"
              dialogClassName="modal-dialog modal-dialog-confirm"
              closeOnBackdropClick={!isDeleting}
              closeOnEscape={!isDeleting}
            >
              <div className="modal-header">
                <div className="modal-title-wrap">
                  <div className="modal-title-icon modal-icon-danger">
                    <Trash2 size={18} />
                  </div>
                  <div>
                    <h3 id="delete-movement-title">تأكيد حذف الحركة</h3>
                    <span className="modal-subtitle">سيتم حذف الحركة نهائياً من السجل</span>
                  </div>
                </div>
                <button type="button" className="modal-close-btn" disabled={isDeleting} onClick={() => setDeletingMovement(null)} aria-label="إغلاق">
                  <X size={18} />
                </button>
              </div>

              <div className="modal-confirm-body">
                <div className="confirm-icon-wrap delete-tone">
                  <Trash2 size={26} />
                </div>
                <h3>هل أنت متأكد من الحذف؟</h3>
                <p>أنت على وشك حذف هذا السجل بشكل نهائي من قاعدة البيانات والسجلات المخزنية.</p>

                <div className="confirm-details-card">
                  <div className="confirm-detail-row">
                    <span className="confirm-detail-label">الصنف:</span>
                    <strong className="confirm-detail-val">{deletingMovement.item}</strong>
                  </div>
                  <div className="confirm-detail-row">
                    <span className="confirm-detail-label">تاريخ الحركة:</span>
                    <span className="confirm-detail-val">{deletingMovement.date || '—'}</span>
                  </div>
                  <div className="confirm-detail-row">
                    <span className="confirm-detail-label">الكميات (وارد / منصرف):</span>
                    <span className="confirm-detail-val">+{deletingMovement.qin} / -{deletingMovement.qout}</span>
                  </div>
                  {deletingMovement.from && (
                    <div className="confirm-detail-row">
                      <span className="confirm-detail-label">المورد:</span>
                      <span className="confirm-detail-val">{deletingMovement.from}</span>
                    </div>
                  )}
                  {deletingMovement.to && (
                    <div className="confirm-detail-row">
                      <span className="confirm-detail-label">المستلم:</span>
                      <span className="confirm-detail-val">{deletingMovement.to}</span>
                    </div>
                  )}
                </div>

                <div className="confirm-warning">
                  ⚠️ تنبيه: لا يمكن استرجاع هذا السجل بعد إتمام عملية الحذف.
                </div>

                {deleteError && <div className="inline-message error w-full mb-3" role="alert">{deleteError}</div>}

                <div className="modal-confirm-actions">
                  <button type="button" className="secondary-btn" disabled={isDeleting} onClick={() => setDeletingMovement(null)}>
                    إلغاء
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={isDeleting}
                    onClick={async () => {
                      setIsDeleting(true)
                      setDeleteError('')
                      try {
                        await deleteExistingMovement(deletingMovement)
                        setDeletingMovement(null)
                      } catch (err) {
                        setDeleteError(err instanceof Error ? err.message : 'تعذر حذف الحركة.')
                      } finally {
                        setIsDeleting(false)
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    {isDeleting ? 'جارٍ الحذف...' : 'نعم، حذف الحركة'}
                  </button>
                </div>
              </div>
            </AccessibleDialog>
          )}
        </AnimatePresence>


        {isSystemAdmin && <WarehouseChatBot session={session} />}
      </main>

      {/* ─── Mobile Bottom Navigation Dock (App-Like Touch Bar) ─── */}
      <nav className="mobile-bottom-dock" aria-label="شريط التنقل السريع للهاتف">
        <NavLink to="/" end className={({ isActive }) => `bottom-dock-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>الرئيسية</span>
        </NavLink>
        <NavLink to="/purchases" className={({ isActive }) => `bottom-dock-item ${isActive ? 'active' : ''}`}>
          <Receipt size={20} />
          <span>المشتريات</span>
        </NavLink>
        <NavLink to="/movements" className={({ isActive }) => `bottom-dock-item ${isActive ? 'active' : ''}`}>
          <Boxes size={20} />
          <span>المخازن</span>
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => `bottom-dock-item ${isActive ? 'active' : ''}`}>
          <FileSpreadsheet size={20} />
          <span>التقارير</span>
        </NavLink>
        <button
          type="button"
          className={`bottom-dock-item ${mobileMenuOpen ? 'active' : ''}`}
          onClick={() => setMobileMenuOpen(true)}
          aria-label="فتح القائمة الكاملة"
        >
          <Menu size={20} />
          <span>القائمة</span>
        </button>
      </nav>
    </div>
  )
}


function MovementEditPage({
  movements,
  onSave,
  onCancel,
}: {
  movements: FixtureMovement[]
  onSave: (movement: FixtureMovement) => Promise<void>
  onCancel: () => void
}) {
  const { id } = useParams<{ id: string }>()
  const movement = movements.find((m) => String(m.id) === String(id))

  if (!movement) {
    return (
      <section className="card-surface movement-form-page">
        <div className="section-head">
          <div>
            <h2>لم يتم العثور على الحركة</h2>
            <span>الحركة المطلوبة غير موجودة في السجل أو قد تكون حُذفت.</span>
          </div>
        </div>
        <div className="form-actions mt-4">
          <button type="button" className="primary-btn" onClick={onCancel}>العودة إلى سجل الحركات</button>
        </div>
      </section>
    )
  }

  return <MovementForm initialMovement={movement} onSave={onSave} onCancel={onCancel} />
}

function MovementForm({
  initialMovement,
  isModal = false,
  onSave,
  onCancel,
}: {
  initialMovement?: FixtureMovement | null
  isModal?: boolean
  onSave: (movement: FixtureMovement) => Promise<void>
  onCancel: () => void
}) {
  const [today] = useState(() => getCairoDateString())
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // التبويب الافتراضي: إذا كانت حركة صرف سابقة اجعلها صرف، وإلا وارد
  const [movementType, setMovementType] = useState<'inward' | 'outward'>(() => {
    if (initialMovement) {
      if ((Number(initialMovement.qout) || 0) > 0 && (!initialMovement.qin || Number(initialMovement.qin) === 0)) {
        return 'outward'
      }
    }
    return canCreatePurchase(getAccessSession()) ? 'inward' : 'outward'
  })

  // قائمة المخازن والكليات الفرعية التابعة للجامعة (ما عدا المخزن الرئيسي)
  const branchWarehouses = useMemo(() => WAREHOUSES.filter((w) => w.id !== 'main'), [])

  // عهدة المخزن الرئيسي للربط المباشر ومعرفة الرصيد المتاح
  const mainCustodyItems = useMemo(() => {
    return loadCustodyItems().filter((i) => i.warehouseId === 'main')
  }, [])

  // حقول تاب الوارد
  const [inwardItem, setInwardItem] = useState(initialMovement?.item ?? '')
  const [inwardDate, setInwardDate] = useState(initialMovement?.date || today)
  const [inwardQin, setInwardQin] = useState<string | number>(
    initialMovement?.qin ? initialMovement.qin : ''
  )
  const [inwardPrice, setInwardPrice] = useState<string | number>(
    initialMovement?.price !== undefined ? initialMovement.price : ''
  )
  const [inwardFrom, setInwardFrom] = useState(initialMovement?.from ?? '')
  const [inwardInv, setInwardInv] = useState(initialMovement?.inv ?? '')
  const [inwardNotes, setInwardNotes] = useState(initialMovement?.notes ?? '')

  // حقول تاب الصرف
  const [outwardItem, setOutwardItem] = useState(initialMovement?.item ?? '')
  const [outwardDate, setOutwardDate] = useState(
    initialMovement?.issue || initialMovement?.date || today
  )
  const [outwardQout, setOutwardQout] = useState<string | number>(
    initialMovement?.qout ? initialMovement.qout : ''
  )
  const [outwardPrice, setOutwardPrice] = useState<string | number>(
    initialMovement?.price !== undefined ? initialMovement.price : ''
  )
  const [outwardPermit, setOutwardPermit] = useState(initialMovement?.permit ?? '')
  const [outwardNotes, setOutwardNotes] = useState(initialMovement?.notes ?? '')

  // المستلم لحركة الصرف
  const [selectedRecipientOption, setSelectedRecipientOption] = useState<string>(() => {
    if (initialMovement?.to) {
      const match = branchWarehouses.find(
        (w) =>
          w.name === initialMovement.to ||
          w.shortName === initialMovement.to ||
          w.id === initialMovement.to
      )
      if (match) return match.name
      return 'custom'
    }
    return branchWarehouses[0]?.name || ''
  })
  const [customRecipient, setCustomRecipient] = useState<string>(() => {
    if (initialMovement?.to) {
      const isBranch = branchWarehouses.some(
        (w) =>
          w.name === initialMovement.to ||
          w.shortName === initialMovement.to ||
          w.id === initialMovement.to
      )
      if (!isBranch) return initialMovement.to
    }
    return ''
  })

  // التحقق من وجود الصنف ورصيده بالمخزن الرئيسي
  const selectedMainItem = useMemo(() => {
    if (!outwardItem.trim()) return null
    return mainCustodyItems.find(
      (i) => i.name.trim().toLowerCase() === outwardItem.trim().toLowerCase()
    )
  }, [outwardItem, mainCustodyItems])

  function handleSelectMainItem(itemName: string) {
    setOutwardItem(itemName)
    const item = mainCustodyItems.find((i) => i.name === itemName)
    if (item && item.value && item.quantity > 0 && !outwardPrice) {
      setOutwardPrice(Math.round(item.value / item.quantity))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSaving(true)

    try {
      if (movementType === 'inward') {
        const cleanItem = inwardItem.trim()
        if (!cleanItem) throw new Error('اسم الصنف مطلوب لحركة الوارد.')
        const qinNum = Number(inwardQin)
        if (isNaN(qinNum) || qinNum <= 0) throw new Error('كمية الوارد يجب أن تكون أكبر من صفر.')
        const priceNum = Number(inwardPrice)
        if (isNaN(priceNum) || priceNum < 0) {
          throw new Error('سعر الوحدة يجب أن يكون رقماً صحيحاً أو عشرياً (0 أو أكثر).')
        }

        const movement: FixtureMovement = {
          id: initialMovement ? initialMovement.id : Date.now(),
          date: String(inwardDate || today),
          inv: String(inwardInv).trim(),
          from: String(inwardFrom).trim(),
          to: 'المخزن الرئيسي',
          permit: '',
          issue: '',
          item: cleanItem,
          price: priceNum,
          qin: qinNum,
          qout: 0,
          notes: String(inwardNotes).trim(),
        }

        await onSave(movement)
      } else {
        const cleanItem = outwardItem.trim()
        if (!cleanItem) throw new Error('اسم الصنف مطلوب لحركة الصرف.')
        const qoutNum = Number(outwardQout)
        if (isNaN(qoutNum) || qoutNum <= 0) throw new Error('كمية المنصرف يجب أن تكون أكبر من صفر.')

        const finalRecipient =
          selectedRecipientOption === 'custom'
            ? customRecipient.trim()
            : selectedRecipientOption.trim()

        if (!finalRecipient) throw new Error('يرجى تحديد المخزن أو الكلية المستلمة للصرف.')

        const priceNum = Number(outwardPrice) || 0

        const movement: FixtureMovement = {
          id: initialMovement ? initialMovement.id : Date.now(),
          date: String(outwardDate || today),
          inv: '',
          from: 'المخزن الرئيسي',
          to: finalRecipient,
          permit: String(outwardPermit).trim(),
          issue: String(outwardDate || today),
          item: cleanItem,
          price: priceNum,
          qin: 0,
          qout: qoutNum,
          notes: String(outwardNotes).trim(),
        }

        await onSave(movement)
        if (!initialMovement) {
          setInwardItem('')
          setInwardQin('')
          setInwardPrice('')
          setInwardFrom('')
          setInwardInv('')
          setInwardNotes('')
          setOutwardItem('')
          setOutwardQout('')
          setOutwardPrice('')
          setOutwardPermit('')
          setOutwardNotes('')
        }
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر حفظ الحركة.')
    } finally {
      setIsSaving(false)
    }
  }

  const formElement = (
    <div className="movement-form-container">
      {/* تابات التبديل بين الوارد والصرف */}
      <div className="movement-type-tabs" role="tablist" aria-label="نوع حركة المخزن">
        <button hidden={!canCreatePurchase(getAccessSession())}
          type="button"
          role="tab"
          id="tab-movement-inward"
          aria-controls="panel-movement-form"
          aria-selected={movementType === 'inward'}
          className={`movement-type-tab inward-tab ${movementType === 'inward' ? 'active' : ''}`}
          onClick={() => {
            setMovementType('inward')
            setError('')
          }}
        >
          <div className="movement-tab-icon inward">
            <ArrowDownToLine size={20} />
          </div>
          <div className="movement-tab-texts">
            <div className="movement-tab-title">حركة وارد (توريد للمخزن)</div>
            <div className="movement-tab-sub">تُضاف مباشرة لعهدة «المخزن الرئيسي»</div>
          </div>
          <span className="movement-tab-badge inward">وارد +</span>
        </button>

        <button hidden={!canCreateDisbursement(getAccessSession())}
          type="button"
          role="tab"
          id="tab-movement-outward"
          aria-controls="panel-movement-form"
          aria-selected={movementType === 'outward'}
          className={`movement-type-tab outward-tab ${movementType === 'outward' ? 'active' : ''}`}
          onClick={() => {
            setMovementType('outward')
            setError('')
          }}
        >
          <div className="movement-tab-icon outward">
            <ArrowUpRight size={20} />
          </div>
          <div className="movement-tab-texts">
            <div className="movement-tab-title">حركة صرف (للمخازن والكليات)</div>
            <div className="movement-tab-sub">تُخصم من الرئيسي وتُدرج بعهدة الكلية المستلمة</div>
          </div>
          <span className="movement-tab-badge outward">منصرف -</span>
        </button>
      </div>

      <form
        id="panel-movement-form"
        role="tabpanel"
        aria-labelledby={movementType === 'inward' ? 'tab-movement-inward' : 'tab-movement-outward'}
        className="movement-form"
        onSubmit={handleSubmit}
      >
        {/* إشعار توضيحي بحسب التاب المختار */}
        {movementType === 'inward' ? (
          <div className="movement-type-banner inward">
            <div className="banner-icon"><PackagePlus size={18} /></div>
            <div>
              <strong>توريد بضاعة إلى المخزن الرئيسي:</strong> يتم تسجيل حركة الوارد وإضافة الرصيد آلياً إلى عهدة «المخزن الرئيسي».
            </div>
          </div>
        ) : (
          <div className="movement-type-banner outward">
            <div className="banner-icon"><Send size={18} /></div>
            <div>
              <strong>صرف وتغذية للمخازن والكليات:</strong> يتم خصم الكمية المنصرفة من رصيد المخزن الرئيسي وتغذية عهدة المخزن المستلم تلقائياً.
            </div>
          </div>
        )}

        {/* ===================== حقول تاب الوارد ===================== */}
        {movementType === 'inward' && (
          <>
            <label className="span-2">
              اسم الصنف / الجهاز / الأصل
              <input
                name="item"
                value={inwardItem}
                onChange={(e) => setInwardItem(e.target.value)}
                placeholder="مثال: جهاز حاسب آلي مكتبي Core i7، شاشات عرض ذكية"
                required
                autoFocus
              />
            </label>

            <label>
              تاريخ الوارد والتسليم
              <input
                name="date"
                type="date"
                value={inwardDate}
                onChange={(e) => setInwardDate(e.target.value)}
                required
              />
            </label>

            <label>
              كمية الوارد (عدد الوحدات)
              <input
                name="qin"
                type="number"
                min="0.001"
                step="any"
                value={inwardQin}
                onChange={(e) => setInwardQin(e.target.value)}
                placeholder="مثال: 50"
                required
              />
            </label>

            <label>
              سعر الوحدة
              <input
                name="price"
                type="number"
                min="0"
                step="any"
                value={inwardPrice}
                onChange={(e) => setInwardPrice(e.target.value)}
                placeholder="سعر القطعة الواحدة"
                required
              />
            </label>

            <label>
              المورد / الشركة الموردة
              <input
                name="from"
                value={inwardFrom}
                onChange={(e) => setInwardFrom(e.target.value)}
                placeholder="اسم المورد أو الشركة الموردة للبضاعة"
              />
            </label>

            <label>
              رقم الفاتورة / أمر التوريد
              <input
                name="inv"
                value={inwardInv}
                onChange={(e) => setInwardInv(e.target.value)}
                placeholder="مثال: INV-2026/841"
              />
            </label>

            <label className="form-notes span-2">
              ملاحظات التوريد
              <textarea
                name="notes"
                rows={2}
                value={inwardNotes}
                onChange={(e) => setInwardNotes(e.target.value)}
                placeholder="ملاحظات حول حالة الاستلام، الضمان، المواصفات..."
              />
            </label>
          </>
        )}

        {/* ===================== حقول تاب الصرف ===================== */}
        {movementType === 'outward' && (
          <>
            <div className="span-2 outward-item-picker">
              <label>
                اسم الصنف المراد صرفه
                <div className="input-with-datalist">
                  <input
                    name="item"
                    list="main-warehouse-items"
                    value={outwardItem}
                    onChange={(e) => setOutwardItem(e.target.value)}
                    placeholder="اختر صنفاً من المخزن الرئيسي أو اكتب اسمه..."
                    required
                    autoFocus
                  />
                  <datalist id="main-warehouse-items">
                    {mainCustodyItems.map((item) => (
                      <option key={item.id} value={item.name}>
                        {`الرصيد: ${item.quantity} ${item.unit} • ${item.code}`}
                      </option>
                    ))}
                  </datalist>
                </div>
              </label>

              {/* شارة رصيد الصنف بالمخزن الرئيسي */}
              {selectedMainItem ? (
                <div className="stock-status-pill ok">
                  <CheckCircle2 size={15} />
                  <span>
                    متوفر في المخزن الرئيسي: <strong>{selectedMainItem.quantity} {selectedMainItem.unit}</strong>
                    {selectedMainItem.roomLocation ? ` (${selectedMainItem.roomLocation})` : ''}
                  </span>
                </div>
              ) : outwardItem.trim() ? (
                <div className="stock-status-pill info">
                  <Info size={15} />
                  <span>صنف جديد أو غير مقيد مسبقاً بالمخزن الرئيسي. سيتم تسجيل الصرف وإضافته للمخزن المستلم.</span>
                </div>
              ) : mainCustodyItems.length > 0 ? (
                <div className="quick-item-pills">
                  <span className="pills-label">أصناف سريعة بالمخزن الرئيسي:</span>
                  {mainCustodyItems.slice(0, 4).map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="quick-item-pill"
                      onClick={() => handleSelectMainItem(i.name)}
                    >
                      {i.name} ({i.quantity})
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <label>
              المخزن أو الكلية المستلمة (جهة الصرف)
              <select
                value={selectedRecipientOption}
                onChange={(e) => setSelectedRecipientOption(e.target.value)}
                required
              >
                {branchWarehouses.map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name} ({w.shortName})
                  </option>
                ))}
                <option value="custom">جهة أخرى / كتابة يدوية...</option>
              </select>
            </label>

            {selectedRecipientOption === 'custom' && (
              <label>
                اسم الجهة أو المستلم
                <input
                  value={customRecipient}
                  onChange={(e) => setCustomRecipient(e.target.value)}
                  placeholder="مثال: الإدارة العامة للشؤون الهندسية، قسم الجودة"
                  required
                />
              </label>
            )}

            <label>
              تاريخ الصرف
              <input
                name="issue"
                type="date"
                value={outwardDate}
                onChange={(e) => setOutwardDate(e.target.value)}
                required
              />
            </label>

            <label>
              كمية المنصرف (عدد الوحدات)
              <input
                name="qout"
                type="number"
                min="0.001"
                step="any"
                max={selectedMainItem ? selectedMainItem.quantity : undefined}
                value={outwardQout}
                onChange={(e) => setOutwardQout(e.target.value)}
                placeholder={selectedMainItem ? `الحد الأقصى: ${selectedMainItem.quantity}` : 'مثال: 5'}
                required
              />
            </label>

            <label>
              رقم إذن الصرف
              <input
                name="permit"
                value={outwardPermit}
                onChange={(e) => setOutwardPermit(e.target.value)}
                placeholder="مثال: إذن صرف رقم 44/ص"
              />
            </label>

            <label>
              سعر الوحدة (تقديري)
              <input
                name="price"
                type="number"
                min="0"
                step="any"
                value={outwardPrice}
                onChange={(e) => setOutwardPrice(e.target.value)}
                placeholder="سعر القطعة الواحدة"
              />
            </label>

            <label className="form-notes span-2">
              ملاحظات الصرف والاعتماد
              <textarea
                name="notes"
                rows={2}
                value={outwardNotes}
                onChange={(e) => setOutwardNotes(e.target.value)}
                placeholder="اسم المستلم، الغرض من الصرف، ملاحظات فنية..."
              />
            </label>
          </>
        )}

        {error && (
          <div
            id="movement-form-error"
            className="inline-message error form-notes span-2"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <div className="form-actions span-2">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={isSaving}>إلغاء</button>
          <button
            type="submit"
            className={`primary-btn ${movementType === 'outward' ? 'outward-submit-btn' : 'inward-submit-btn'}`}
            disabled={isSaving}
          >
            {isSaving
              ? 'جارٍ الحفظ...'
              : initialMovement
                ? 'حفظ التعديلات'
                : movementType === 'inward'
                  ? 'حفظ حركة الوارد (إضافة للعهدة)'
                  : 'حفظ حركة الصرف (تغذية المخزن المستلم)'}
          </button>
        </div>
      </form>
    </div>
  )

  if (isModal) {
    return formElement
  }

  return (
    <section className="card-surface movement-form-page">
      <div className="section-head">
        <div>
          <h2>
            {initialMovement ? <Pencil size={19} /> : <Package size={19} />}
            {' '}
            {initialMovement ? 'تعديل حركة المخزن' : 'إضافة حركة جديدة'}
          </h2>
          <span>
            {initialMovement
              ? `تعديل بيانات حركة «${initialMovement.item}»`
              : 'تسجيل توريد إلى المخزن الرئيسي أو صرف للمخازن والكليات'}
          </span>
        </div>
      </div>
      {formElement}
    </section>
  )
}


export default App
