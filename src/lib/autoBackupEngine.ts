/**
 * src/lib/autoBackupEngine.ts
 *
 * محرك النسخ الاحتياطي التلقائي الشامل (Automatic Real-Time Backup Engine).
 * يراقب كل التعديلات والإضافات المستقبلية في جميع صفحات ووحدات النظام:
 * (حركات المخازن، الأرصدة والعهد، عقود الموردين، طلبات الصرف، الميزانية، التقارير المالية،
 * حركة الأصول، تذاكر الدعم، محاضر الفحص والتسوية، طلبات الشراء، عروض الأسعار، أوامر التوريد،
 * مستخدمي النظام، طلبات التسجيل، إعدادات البوت والذكاء الاصطناعي، والإعدادات العامة).
 *
 * عند حدوث أي تعديل أو إضافة في أي صفحة:
 * 1. يتم توليد لقطة تعافي فورية (Hot Auto-Recovery Snapshot) وتحديثها محلياً.
 * 2. إذا كان المستخدم مديراً للنظام ومتصلاً بالسحابة، تتم المزامنة السحابية تلقائياً في الخلفية.
 * 3. يتم توثيق طابع زمني دقيق لآخر نسخ تلقائي.
 */

import type { Session } from '@supabase/supabase-js'
import {
  backupToSupabaseCloud,
  getAutoRecoverySnapshot,
  restoreLocalBackup,
  AUTO_RECOVERY_STORAGE_KEY,
  LAST_AUTO_BACKUP_KEY,
  type SystemBackupPayload,
  type RestoreResult,
  type SystemBackupCounts,
  getStoredMovements,
} from './backup'
import { loadAppSettings } from './settings'
import { loadCustodyItems } from './custody'
import { loadLocalUsers } from './localUsers'
import { getLocalAuditLogs } from './auditLogger'
import { getLocalContracts } from './contractsRepository'
import { getLocalRequests } from './disbursementRequestsRepository'
import { getLocalBudgetPlans } from './budgetRepository'
import { getLocalReports } from './financialReportsRepository'
import { getLocalAssetMovements } from './assetMovementRepository'
import { getLocalTickets } from './supportTicketsRepository'
import { getLocalNotifications } from './notificationsRepository'
import {
  getLocalPurchaseRequests,
  getLocalSupplierQuotes,
  getLocalPurchaseOrders,
} from './procurementRepository'
import { checkIsSystemAdmin, supabase } from './supabase'

export const AUTO_BACKUP_ENABLED_KEY = 'warehouse_ledger_auto_backup_enabled'
export const AUTO_BACKUP_SCHEDULE_KEY = 'warehouse_ledger_auto_backup_schedule_v2'

export type BackupFrequency = 'daily' | 'weekly' | 'custom_days'
export type BackupExecutionMode = 'realtime_and_scheduled' | 'scheduled_only' | 'realtime_only'

export interface AutoBackupScheduleConfig {
  enabled: boolean
  mode: BackupExecutionMode
  frequency: BackupFrequency
  time: string // "HH:mm" 24h format (e.g. "23:00")
  daysOfWeek: number[] // 0: Sunday, 1: Monday, 2: Tuesday, 3: Wednesday, 4: Thursday, 5: Friday, 6: Saturday
  lastScheduledRun?: string
}

export const DEFAULT_SCHEDULE_CONFIG: AutoBackupScheduleConfig = {
  enabled: true,
  mode: 'scheduled_only',
  frequency: 'daily',
  time: '23:00',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // كل أيام الأسبوع افتراضياً
}

export const ARABIC_DAYS_OF_WEEK = [
  { value: 6, label: 'السبت' },
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الإثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
]

export function isAutoBackupEnabled(): boolean {
  try {
    const val = localStorage.getItem(AUTO_BACKUP_ENABLED_KEY)
    return val === null ? true : val === 'true'
  } catch {
    return true
  }
}

export function setAutoBackupEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_BACKUP_ENABLED_KEY, String(enabled))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auto-backup-status-changed', { detail: { enabled } }))
    }
  } catch {
    // ignore
  }
}

export function getAutoBackupScheduleConfig(): AutoBackupScheduleConfig {
  try {
    if (typeof window === 'undefined') return DEFAULT_SCHEDULE_CONFIG
    let raw = localStorage.getItem(AUTO_BACKUP_SCHEDULE_KEY)
    if (!raw) {
      // Migrate from v1 if present, forcing mode to 'scheduled_only'
      const legacyRaw = localStorage.getItem('warehouse_ledger_auto_backup_schedule_v1')
      if (legacyRaw) {
        try {
          const parsedLegacy = JSON.parse(legacyRaw) as Partial<AutoBackupScheduleConfig>
          const migrated: AutoBackupScheduleConfig = {
            ...DEFAULT_SCHEDULE_CONFIG,
            ...parsedLegacy,
            mode: 'scheduled_only',
          }
          localStorage.setItem(AUTO_BACKUP_SCHEDULE_KEY, JSON.stringify(migrated))
          return migrated
        } catch {
          // ignore
        }
      }
    } else {
      const parsed = JSON.parse(raw) as Partial<AutoBackupScheduleConfig>
      return {
        ...DEFAULT_SCHEDULE_CONFIG,
        ...parsed,
        mode: parsed.mode || 'scheduled_only',
        daysOfWeek: Array.isArray(parsed.daysOfWeek) && parsed.daysOfWeek.length > 0 ? parsed.daysOfWeek : DEFAULT_SCHEDULE_CONFIG.daysOfWeek,
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_SCHEDULE_CONFIG
}

export function saveAutoBackupScheduleConfig(config: AutoBackupScheduleConfig): void {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(AUTO_BACKUP_SCHEDULE_KEY, JSON.stringify(config))
    window.dispatchEvent(new CustomEvent('auto-backup-schedule-changed', { detail: config }))
  } catch (err) {
    console.warn('Could not save auto-backup schedule:', err)
  }
}

export function computeNextScheduledRun(config: AutoBackupScheduleConfig, fromDate = new Date()): Date | null {
  if (!config.enabled || config.mode === 'realtime_only') return null
  const [hhStr, mmStr] = (config.time || '23:00').split(':')
  const targetHour = parseInt(hhStr, 10) || 0
  const targetMinute = parseInt(mmStr, 10) || 0

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(fromDate.getTime())
    candidate.setDate(candidate.getDate() + offset)
    candidate.setHours(targetHour, targetMinute, 0, 0)

    const dayOfWeek = candidate.getDay()
    if (config.daysOfWeek.includes(dayOfWeek)) {
      if (offset === 0) {
        if (candidate.getTime() > fromDate.getTime()) {
          return candidate
        }
      } else {
        return candidate
      }
    }
  }
  return null
}

export function formatNextScheduledRunArabic(nextDate: Date | null): string {
  if (!nextDate) return 'الجدولة متوقفة حالياً'
  const now = new Date()
  const isToday = nextDate.toDateString() === now.toDateString()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const isTomorrow = nextDate.toDateString() === tomorrow.toDateString()

  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  const dayName = dayNames[nextDate.getDay()]

  const hours = nextDate.getHours()
  const minutes = String(nextDate.getMinutes()).padStart(2, '0')
  const period = hours >= 12 ? 'مساءً' : 'صباحاً'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12

  const timeFormatted = `${displayHours}:${minutes} ${period}`

  if (isToday) {
    return `اليوم (${dayName}) في تمام الساعة ${timeFormatted}`
  }
  if (isTomorrow) {
    return `غداً (${dayName}) في تمام الساعة ${timeFormatted}`
  }
  return `يوم ${dayName} (${nextDate.getDate()}/${nextDate.getMonth() + 1}) في تمام الساعة ${timeFormatted}`
}

export const SYSTEM_MUTATION_EVENTS = [
  'warehouse-ledger-updated',
  'custody-changed',
  'custody-items-changed',
  'contracts-changed',
  'disbursement-requests-changed',
  'budget-plans-changed',
  'financial-reports-changed',
  'asset-movements-changed',
  'support-tickets-changed',
  'technical-inspections-changed',
  'inventory-settlements-changed',
  'procurement-updated',
  'suppliers-changed',
  'local-users-changed',
  'registration-requests-changed',
  'settings-changed',
  'telegram-settings-changed',
  'notifications-changed',
  'chatbot-directives-changed',
] as const

let autoBackupTimer: ReturnType<typeof setTimeout> | null = null
let isPerformingAutoBackup = false

/**
 * يولد لقطة تعافي فورية سريعة محلياً بدون إبطاء واجهة المستخدم
 */
export function generateHotRecoverySnapshot(session?: Session | null): SystemBackupPayload {
  const settings = loadAppSettings()
  const movements = getStoredMovements()
  const custody = loadCustodyItems()
  const users = loadLocalUsers()
  const auditLogs = getLocalAuditLogs()
  const contracts = getLocalContracts()
  const disbursementRequests = getLocalRequests()
  const budgetPlans = getLocalBudgetPlans()
  const financialReports = getLocalReports()
  const assetMovements = getLocalAssetMovements()
  const supportTickets = getLocalTickets()
  const notifications = getLocalNotifications()
  const purchaseRequests = getLocalPurchaseRequests()
  const supplierQuotes = getLocalSupplierQuotes()
  const purchaseOrders = getLocalPurchaseOrders()

  let suppliers: Record<string, unknown>[] = []
  try {
    const raw = localStorage.getItem('warehouse_custom_suppliers')
    if (raw) suppliers = JSON.parse(raw)
  } catch {
    // ignore
  }

  let technicalInspections: Record<string, unknown>[] = []
  try {
    const raw = localStorage.getItem('warehouse_inspection_reports')
    if (raw) technicalInspections = JSON.parse(raw)
  } catch {
    // ignore
  }

  let inventorySettlements: Record<string, unknown>[] = []
  try {
    const raw = localStorage.getItem('warehouse_settlement_history')
    if (raw) inventorySettlements = JSON.parse(raw)
  } catch {
    // ignore
  }

  let chatbotDirectives = ''
  try {
    chatbotDirectives = localStorage.getItem('znu_chatbot_custom_developer_directives') || ''
  } catch {
    // ignore
  }

  const timestamp = new Date().toISOString()

  const counts: SystemBackupCounts = {
    movements: movements.length,
    custody: custody.length,
    users: users.length,
    auditLogs: auditLogs.length,
    suppliers: suppliers.length,
    contracts: contracts.length,
    disbursementRequests: disbursementRequests.length,
    budgetPlans: budgetPlans.length,
    financialReports: financialReports.length,
    assetMovements: assetMovements.length,
    supportTickets: supportTickets.length,
    technicalInspections: technicalInspections.length,
    inventorySettlements: inventorySettlements.length,
    notifications: notifications.length,
    purchaseRequests: purchaseRequests.length,
    supplierQuotes: supplierQuotes.length,
    purchaseOrders: purchaseOrders.length,
    chatbotDirectives: Boolean(chatbotDirectives),
    settings: true,
  }

  return {
    app: 'warehouse-ledger',
    version: '2.0.0',
    backupDate: timestamp,
    generator: {
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? 'auto-backup-engine',
      role: 'admin',
    },
    metadata: {
      organization: settings.organization || 'جامعة الزقازيق الأهلية',
      department: settings.department || 'إدارة المخازن المركزية',
      currency: settings.currency || 'EGP',
      counts,
    },
    data: {
      settings,
      movements,
      custody,
      users,
      auditLogs,
      suppliers,
      contracts,
      disbursementRequests,
      budgetPlans,
      financialReports,
      assetMovements,
      supportTickets,
      technicalInspections,
      inventorySettlements,
      notifications,
      purchaseRequests,
      supplierQuotes,
      purchaseOrders,
      chatbotDirectives,
    },
  }
}

/**
 * تنفيذ عملية النسخ الاحتياطي التلقائي الحالية
 * isScheduled = true: فقط عند حلول موعد الجدولة المحدد، يتم رفع النسخة إلى السحابة وتوثيقها في سجل المراجعة
 * isScheduled = false: لقطة تعافي محلية فورية فقط بدون إجهاد السحابة أو إغراق سجل المراجعة
 */
export async function executeAutoBackup(session?: Session | null, isScheduled = false): Promise<void> {
  if (isPerformingAutoBackup) return
  isPerformingAutoBackup = true

  try {
    const snapshot = generateHotRecoverySnapshot(session)
    const timestamp = snapshot.backupDate

    // 1. حفظ اللقطة المحلية الفورية دائماً للحماية في حال إغلاق المتصفح
    try {
      localStorage.setItem(AUTO_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot))
      localStorage.setItem(LAST_AUTO_BACKUP_KEY, timestamp)
    } catch (e) {
      console.warn('Auto-backup local storage quota exceeded, falling back:', e)
    }

    // 2. المزامنة السحابية الكاملة وتوثيق سجل المراجعة تحدث حصرياً عند حلول الموعد المجدول
    if (isScheduled && supabase && checkIsSystemAdmin(session) && navigator.onLine) {
      try {
        await backupToSupabaseCloud(session, 'scheduled')
      } catch (cloudErr) {
        console.warn('Scheduled cloud auto-backup skipped or queued:', cloudErr)
      }
    }

    // 3. إشعار الواجهة بنجاح النسخ
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auto-backup-completed', {
          detail: {
            timestamp,
            isScheduled,
            counts: snapshot.metadata.counts,
          },
        })
      )
    }
  } finally {
    // فترة أمان 1.5 ثانية لامتصاص أي أحداث متتالية ومنع الحلقات اللانهائية
    setTimeout(() => {
      isPerformingAutoBackup = false
    }, 1500)
  }
}

/**
 * تشغيل مراقب النسخ الاحتياطي التلقائي لكافة صفحات النظام
 * يُسجل listeners على جميع أحداث النظام لضمان ارتباط أي تعديل أو إضافة جديدة بالنسخ الاحتياطي فوراً.
 */
export function startAutoBackupWatcher(session?: Session | null): () => void {
  if (typeof window === 'undefined') return () => {}

  function handleSystemMutation() {
    if (isPerformingAutoBackup) return
    if (!isAutoBackupEnabled()) return
    const config = getAutoBackupScheduleConfig()
    // إذا كان المستخدم محدد وضع الجدولة فقط، لا يتم عمل أي نسخ فوري
    if (config.mode === 'scheduled_only') return

    if (autoBackupTimer) {
      clearTimeout(autoBackupTimer)
    }

    // فترة تأخير ذكية وتحديث اللقطة المحلية فقط دون المساس بالسحابة وسجل المراجعة
    autoBackupTimer = setTimeout(() => {
      void executeAutoBackup(session, false)
    }, 4000)
  }

  // 1. تسجيل الاستماع لكافة أحداث النظام الـ 19
  for (const eventName of SYSTEM_MUTATION_EVENTS) {
    window.addEventListener(eventName, handleSystemMutation)
  }

  // 2. مراقب الجدولة الزمنية المحددة (Scheduled Planner Runner)
  let scheduleInterval: ReturnType<typeof setInterval> | null = null

  function checkScheduledBackup() {
    try {
      if (!isAutoBackupEnabled()) return
      const config = getAutoBackupScheduleConfig()
      if (!config.enabled || config.mode === 'realtime_only') return

      const now = new Date()
      const currDay = now.getDay()
      if (!config.daysOfWeek.includes(currDay)) return

      const [hhStr, mmStr] = (config.time || '23:00').split(':')
      const targetHour = parseInt(hhStr, 10) || 0
      const targetMinute = parseInt(mmStr, 10) || 0

      if (now.getHours() === targetHour && now.getMinutes() === targetMinute) {
        // Prevent duplicate trigger in the same minute
        if (config.lastScheduledRun) {
          const last = new Date(config.lastScheduledRun)
          if (
            last.getFullYear() === now.getFullYear() &&
            last.getMonth() === now.getMonth() &&
            last.getDate() === now.getDate() &&
            last.getHours() === targetHour &&
            last.getMinutes() === targetMinute
          ) {
            return
          }
        }

        // Execute scheduled backup to Supabase Cloud
        void executeAutoBackup(session, true).then(() => {
          const updated = {
            ...config,
            lastScheduledRun: now.toISOString(),
          }
          saveAutoBackupScheduleConfig(updated)
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('auto-backup-completed', {
                detail: {
                  type: 'scheduled',
                  timestamp: now.toISOString(),
                },
              })
            )
          }
        })
      }
    } catch {
      // ignore
    }
  }
      // ignore
    }
  }

  // Check every 30 seconds
  scheduleInterval = setInterval(checkScheduledBackup, 30000)
  checkScheduledBackup()

  // إرجاع دالة تنظيف لإلغاء المراقبة عند الحاجة
  return () => {
    if (scheduleInterval) clearInterval(scheduleInterval)
    if (autoBackupTimer) clearTimeout(autoBackupTimer)
    for (const eventName of SYSTEM_MUTATION_EVENTS) {
      window.removeEventListener(eventName, handleSystemMutation)
    }
  }
}

/**
 * استعادة فورية من أحدث لقطة تعافي تلقائية (Hot Recovery Snapshot)
 */
export async function restoreFromAutoRecovery(session?: Session | null): Promise<RestoreResult> {
  const snapshot = getAutoRecoverySnapshot()
  if (!snapshot) {
    throw new Error('لا توجد لقطة تعافي تلقائية محفوظة حالياً.')
  }
  return restoreLocalBackup(snapshot, session)
}
