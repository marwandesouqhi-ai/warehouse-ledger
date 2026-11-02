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
 */
export async function executeAutoBackup(session?: Session | null): Promise<void> {
  if (isPerformingAutoBackup) return
  isPerformingAutoBackup = true

  try {
    const snapshot = generateHotRecoverySnapshot(session)
    const timestamp = snapshot.backupDate

    // 1. حفظ اللقطة المحلية الفورية
    try {
      localStorage.setItem(AUTO_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot))
      localStorage.setItem(LAST_AUTO_BACKUP_KEY, timestamp)
    } catch (e) {
      console.warn('Auto-backup local storage quota exceeded, falling back:', e)
    }

    // 2. إذا كان المستخدم مديراً للنظام والسحابة متاحة، مزامنة سحابية هادئة في الخلفية
    if (supabase && checkIsSystemAdmin(session) && navigator.onLine) {
      try {
        await backupToSupabaseCloud(session)
      } catch (cloudErr) {
        console.warn('Silent cloud auto-backup skipped or queued:', cloudErr)
      }
    }

    // 3. إشعار الواجهة بنجاح النسخ التلقائي
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auto-backup-completed', {
          detail: {
            timestamp,
            counts: snapshot.metadata.counts,
          },
        })
      )
    }
  } finally {
    isPerformingAutoBackup = false
  }
}

/**
 * تشغيل مراقب النسخ الاحتياطي التلقائي لكافة صفحات النظام
 * يُسجل listeners على جميع أحداث النظام لضمان ارتباط أي تعديل أو إضافة جديدة بالنسخ الاحتياطي فوراً.
 */
export function startAutoBackupWatcher(session?: Session | null): () => void {
  if (typeof window === 'undefined') return () => {}

  function handleSystemMutation() {
    if (!isAutoBackupEnabled()) return

    if (autoBackupTimer) {
      clearTimeout(autoBackupTimer)
    }

    // فترة تأخير ذكية (Debounce) لمنع تكرار النسخ في العمليات المتتالية
    autoBackupTimer = setTimeout(() => {
      void executeAutoBackup(session)
    }, 2500)
  }

  // تسجيل الاستماع لكافة أحداث النظام الـ 19
  for (const eventName of SYSTEM_MUTATION_EVENTS) {
    window.addEventListener(eventName, handleSystemMutation)
  }

  // إرجاع دالة تنظيف لإلغاء المراقبة عند الحاجة
  return () => {
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
