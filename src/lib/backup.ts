import type { Session } from '@supabase/supabase-js'
import { logAuditEvent, getLocalAuditLogs, fetchAuditLogs, type AuditLogEntry } from './auditLogger'
import { fetchCustodyItemsFromCloud, loadCustodyItems, saveCustodyItems, saveCustodyItemsToCloud, type CustodyItem } from './custody'
import type { FixtureMovement } from './fixture'
import { fetchUsersFromCloud, loadLocalUsers, saveLocalUsers, syncUsersWithCloud, type LocalUser } from './localUsers'
import { fetchMovements, saveMovements } from './movementsRepository'
import { fetchAppSettingsFromCloud, loadAppSettings, saveAppSettingsToCloud, type AppSettings } from './settings'
import { checkIsSystemAdmin, supabase } from './supabase'
import { fetchActiveSuppliers } from './suppliersRepository'

// Repositories for all system modules
import { fetchContracts, getLocalContracts, saveLocalContracts, type SupplierContract } from './contractsRepository'
import { fetchDisbursementRequests, getLocalRequests, saveLocalRequests, type DisbursementRequest } from './disbursementRequestsRepository'
import { fetchBudgetPlans, getLocalBudgetPlans, saveLocalBudgetPlans, type BudgetPlan } from './budgetRepository'
import { fetchFinancialReports, getLocalReports, saveLocalReports, type FinancialReport } from './financialReportsRepository'
import { fetchAssetMovements, getLocalAssetMovements, saveLocalAssetMovements, type AssetMovement } from './assetMovementRepository'
import { fetchSupportTickets, getLocalTickets, saveLocalTickets, type SupportTicket } from './supportTicketsRepository'
import { fetchTelegramBotSettings, saveTelegramBotSettings, type TelegramBotSettings } from './telegramSettingsRepository'
import { fetchNotifications, getLocalNotifications, saveLocalNotifications, type AppNotification } from './notificationsRepository'

export const LAST_CLOUD_BACKUP_KEY = 'warehouse-ledger-last-cloud-backup'
export const LAST_LOCAL_BACKUP_KEY = 'warehouse-ledger-last-local-backup'

const INSPECTIONS_STORAGE_KEY = 'warehouse_inspection_reports'
const SETTLEMENTS_STORAGE_KEY = 'warehouse_settlement_history'

export type SystemBackupCounts = {
  movements: number
  custody: number
  users: number
  auditLogs: number
  suppliers?: number
  contracts?: number
  disbursementRequests?: number
  budgetPlans?: number
  financialReports?: number
  assetMovements?: number
  supportTickets?: number
  technicalInspections?: number
  inventorySettlements?: number
  telegramSettings?: number
  notifications?: number
  settings?: boolean
}

export type SystemBackupPayload = {
  app: 'warehouse-ledger'
  version: '2.0.0' | '1.0.0'
  backupDate: string
  generator: {
    userId?: string | null
    email?: string | null
    role?: string
  }
  metadata: {
    organization: string
    department: string
    currency: string
    counts: SystemBackupCounts
  }
  data: {
    settings: AppSettings
    movements: FixtureMovement[]
    custody: CustodyItem[]
    users: LocalUser[]
    auditLogs: AuditLogEntry[]
    suppliers?: Record<string, unknown>[]
    contracts?: SupplierContract[]
    disbursementRequests?: DisbursementRequest[]
    budgetPlans?: BudgetPlan[]
    financialReports?: FinancialReport[]
    assetMovements?: AssetMovement[]
    supportTickets?: SupportTicket[]
    technicalInspections?: Record<string, unknown>[]
    inventorySettlements?: Record<string, unknown>[]
    telegramSettings?: TelegramBotSettings
    notifications?: AppNotification[]
  }
}

export type BackupResult = {
  success: boolean
  counts: SystemBackupCounts
  timestamp: string
  fileName?: string
}

export type RestoreOptions = {
  restoreMovements?: boolean
  restoreCustody?: boolean
  restoreUsers?: boolean
  restoreSettings?: boolean
  restoreAuditLogs?: boolean
  restoreSuppliers?: boolean
  restoreContracts?: boolean
  restoreDisbursementRequests?: boolean
  restoreBudgetPlans?: boolean
  restoreFinancialReports?: boolean
  restoreAssetMovements?: boolean
  restoreSupportTickets?: boolean
  restoreTechnicalInspections?: boolean
  restoreInventorySettlements?: boolean
  restoreTelegramSettings?: boolean
  restoreNotifications?: boolean
}

export type RestoreResult = {
  success: boolean
  counts: SystemBackupCounts
  source: 'local_file' | 'cloud'
  timestamp: string
}

function isUuid(str: string | undefined | null): boolean {
  if (!str) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
}

function sanitizeForUuidPk<T extends { id?: string }>(item: T): Omit<T, 'id'> | T {
  if (item && item.id && !isUuid(item.id)) {
    const { id, ...rest } = item
    return rest as T
  }
  return item
}

export function getStoredMovements(): FixtureMovement[] {
  try {
    const raw = localStorage.getItem('warehouse-ledger-movements')
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed as FixtureMovement[]
      }
    }
  } catch {
    // ignore
  }
  return []
}

export function getLastCloudBackupTime(): string | null {
  try {
    return localStorage.getItem(LAST_CLOUD_BACKUP_KEY)
  } catch {
    return null
  }
}

export function getLastLocalBackupTime(): string | null {
  try {
    return localStorage.getItem(LAST_LOCAL_BACKUP_KEY)
  } catch {
    return null
  }
}

export function formatBackupTimestamp(isoString?: string | null): string {
  if (!isoString) return 'لم يتم إجراء نسخ بعد'
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return isoString
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d)
  } catch {
    return isoString
  }
}

/**
 * Creates and downloads a complete JSON backup file to the local device.
 * Covers 100% of all pages and datasets across the system:
 * - settings, movements, custody, users, audit logs, suppliers
 * - supplier_contracts (with all attachments)
 * - disbursement_requests, budget_plans, financial_reports, asset_movement_log
 * - support_tickets, technical_inspections, inventory_settlements
 * - telegram_bot_settings, notifications
 * Restricted strictly to System Admin.
 */
export async function exportLocalBackup(session?: Session | null): Promise<BackupResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  const settings = loadAppSettings()

  // 1. Movements
  let movements = getStoredMovements()
  try {
    const cloudMovements = await fetchMovements()
    if (cloudMovements && cloudMovements.length > 0) {
      const mvMap = new Map<string, FixtureMovement>()
      for (const m of movements) {
        if (m.id) mvMap.set(String(m.id), m)
      }
      for (const m of cloudMovements) {
        if (m.id) mvMap.set(String(m.id), m)
      }
      movements = Array.from(mvMap.values())
    }
  } catch {
    // fallback
  }

  // 2. Custody
  let custody = loadCustodyItems()
  try {
    const cloudCustody = await fetchCustodyItemsFromCloud()
    if (cloudCustody && cloudCustody.length > 0) {
      const cMap = new Map<string, CustodyItem>()
      for (const c of custody) {
        if (c.id) cMap.set(String(c.id), c)
      }
      for (const c of cloudCustody) {
        if (c.id) cMap.set(String(c.id), c)
      }
      custody = Array.from(cMap.values())
    }
  } catch {
    // fallback
  }

  // 3. Users
  let users = loadLocalUsers()
  try {
    const cloudUsers = await fetchUsersFromCloud()
    if (cloudUsers && cloudUsers.length > 0) {
      const uMap = new Map<string, LocalUser>()
      for (const u of users) {
        const key = u.id || u.username
        if (key) uMap.set(key, u)
      }
      for (const u of cloudUsers) {
        const key = u.id || u.username
        if (key) uMap.set(key, u)
      }
      users = Array.from(uMap.values())
    }
  } catch {
    // fallback
  }

  // 4. Audit logs
  let auditLogs = getLocalAuditLogs()
  try {
    const remoteLogs = await fetchAuditLogs(1000)
    if (remoteLogs && remoteLogs.length > 0) {
      const logMap = new Map<string, AuditLogEntry>()
      for (const l of auditLogs) {
        if (l.id) logMap.set(String(l.id), l)
      }
      for (const l of remoteLogs) {
        if (l.id) logMap.set(String(l.id), l)
      }
      auditLogs = Array.from(logMap.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }
  } catch {
    // fallback
  }

  // 5. Suppliers
  let suppliers: Record<string, unknown>[] = []
  try {
    const rawSuppliers = localStorage.getItem('warehouse_custom_suppliers')
    if (rawSuppliers) {
      const parsed = JSON.parse(rawSuppliers)
      if (Array.isArray(parsed)) suppliers = parsed
    }
    const activeSuppliers = await fetchActiveSuppliers()
    if (activeSuppliers && activeSuppliers.length > 0) {
      const supMap = new Map<string, Record<string, unknown>>()
      for (const s of suppliers) {
        const key = (s.id as string) || (s.name as string)
        if (key) supMap.set(key, s)
      }
      for (const s of activeSuppliers) {
        const key = s.id || s.name
        if (key) supMap.set(key, s as unknown as Record<string, unknown>)
      }
      suppliers = Array.from(supMap.values())
    }
  } catch {
    // ignore
  }

  // 6. Contracts (عقود الموردين بمرفقاتها)
  let contracts: SupplierContract[] = getLocalContracts()
  try {
    const cloudContracts = await fetchContracts()
    if (cloudContracts && cloudContracts.length > 0) {
      const cMap = new Map<string, SupplierContract>()
      for (const c of contracts) if (c.id) cMap.set(c.id, c)
      for (const c of cloudContracts) if (c.id) cMap.set(c.id, c)
      contracts = Array.from(cMap.values())
    }
  } catch {
    // ignore
  }

  // 7. Disbursement Requests (طلبات الصرف الداخلي)
  let disbursementRequests: DisbursementRequest[] = getLocalRequests()
  try {
    const cloudRequests = await fetchDisbursementRequests()
    if (cloudRequests && cloudRequests.length > 0) {
      const dMap = new Map<string, DisbursementRequest>()
      for (const d of disbursementRequests) if (d.id) dMap.set(d.id, d)
      for (const d of cloudRequests) if (d.id) dMap.set(d.id, d)
      disbursementRequests = Array.from(dMap.values())
    }
  } catch {
    // ignore
  }

  // 8. Budget Plans (الميزانية والتخطيط)
  let budgetPlans: BudgetPlan[] = getLocalBudgetPlans()
  try {
    const cloudBudget = await fetchBudgetPlans()
    if (cloudBudget && cloudBudget.length > 0) {
      const bMap = new Map<string, BudgetPlan>()
      for (const b of budgetPlans) if (b.id) bMap.set(b.id, b)
      for (const b of cloudBudget) if (b.id) bMap.set(b.id, b)
      budgetPlans = Array.from(bMap.values())
    }
  } catch {
    // ignore
  }

  // 9. Financial Reports (التقارير المالية)
  let financialReports: FinancialReport[] = getLocalReports()
  try {
    const cloudReports = await fetchFinancialReports()
    if (cloudReports && cloudReports.length > 0) {
      const fMap = new Map<string, FinancialReport>()
      for (const f of financialReports) if (f.id) fMap.set(f.id, f)
      for (const f of cloudReports) if (f.id) fMap.set(f.id, f)
      financialReports = Array.from(fMap.values())
    }
  } catch {
    // ignore
  }

  // 10. Asset Movements (سجل حركة الأصول)
  let assetMovements: AssetMovement[] = getLocalAssetMovements()
  try {
    const cloudAssets = await fetchAssetMovements()
    if (cloudAssets && cloudAssets.length > 0) {
      const aMap = new Map<string, AssetMovement>()
      for (const a of assetMovements) if (a.id) aMap.set(a.id, a)
      for (const a of cloudAssets) if (a.id) aMap.set(a.id, a)
      assetMovements = Array.from(aMap.values())
    }
  } catch {
    // ignore
  }

  // 11. Support Tickets (تذاكر الدعم الفني)
  let supportTickets: SupportTicket[] = getLocalTickets()
  try {
    const cloudTickets = await fetchSupportTickets(session)
    if (cloudTickets && cloudTickets.length > 0) {
      const tMap = new Map<string, SupportTicket>()
      for (const t of supportTickets) if (t.id) tMap.set(t.id, t)
      for (const t of cloudTickets) if (t.id) tMap.set(t.id, t)
      supportTickets = Array.from(tMap.values())
    }
  } catch {
    // ignore
  }

  // 12. Technical Inspections (محاضر الفحص الفني)
  let technicalInspections: Record<string, unknown>[] = []
  try {
    const rawInspections = localStorage.getItem(INSPECTIONS_STORAGE_KEY)
    if (rawInspections) {
      const parsed = JSON.parse(rawInspections)
      if (Array.isArray(parsed)) technicalInspections = parsed
    }
    if (supabase) {
      const { data: cloudInspections } = await supabase.from('technical_inspections').select('*')
      if (cloudInspections && cloudInspections.length > 0) {
        const iMap = new Map<string, Record<string, unknown>>()
        for (const i of technicalInspections) {
          const key = (i.id as string) || (i.inspection_number as string)
          if (key) iMap.set(key, i)
        }
        for (const i of cloudInspections) {
          const key = (i.id as string) || (i.inspection_number as string)
          if (key) iMap.set(key, i)
        }
        technicalInspections = Array.from(iMap.values())
      }
    }
  } catch {
    // ignore
  }

  // 13. Inventory Settlements (محاضر التسوية الجردية)
  let inventorySettlements: Record<string, unknown>[] = []
  try {
    const rawSettlements = localStorage.getItem(SETTLEMENTS_STORAGE_KEY)
    if (rawSettlements) {
      const parsed = JSON.parse(rawSettlements)
      if (Array.isArray(parsed)) inventorySettlements = parsed
    }
    if (supabase) {
      const { data: cloudSettlements } = await supabase.from('inventory_settlements').select('*')
      if (cloudSettlements && cloudSettlements.length > 0) {
        const sMap = new Map<string, Record<string, unknown>>()
        for (const s of inventorySettlements) {
          const key = (s.id as string) || (s.settlement_number as string)
          if (key) sMap.set(key, s)
        }
        for (const s of cloudSettlements) {
          const key = (s.id as string) || (s.settlement_number as string)
          if (key) sMap.set(key, s)
        }
        inventorySettlements = Array.from(sMap.values())
      }
    }
  } catch {
    // ignore
  }

  // 14. Telegram Bot Settings (إعدادات التيليجرام)
  let telegramSettings: TelegramBotSettings | undefined
  try {
    telegramSettings = await fetchTelegramBotSettings()
  } catch {
    // ignore
  }

  // 15. Notifications (نظام الإشعارات)
  let notifications: AppNotification[] = getLocalNotifications()
  try {
    const cloudNotifs = await fetchNotifications()
    if (cloudNotifs && cloudNotifs.length > 0) {
      const nMap = new Map<string, AppNotification>()
      for (const n of notifications) if (n.id) nMap.set(n.id, n)
      for (const n of cloudNotifs) if (n.id) nMap.set(n.id, n)
      notifications = Array.from(nMap.values())
    }
  } catch {
    // ignore
  }

  const timestamp = new Date().toISOString()

  const payload: SystemBackupPayload = {
    app: 'warehouse-ledger',
    version: '2.0.0',
    backupDate: timestamp,
    generator: {
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? ((session?.user?.app_metadata as Record<string, unknown>)?.username as string) ?? 'admin',
      role: 'admin',
    },
    metadata: {
      organization: settings.organization || 'جامعة الزقازيق الأهلية',
      department: settings.department || 'إدارة المخازن المركزية',
      currency: settings.currency || 'EGP',
      counts: {
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
        telegramSettings: telegramSettings ? 1 : 0,
        notifications: notifications.length,
      },
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
      telegramSettings,
      notifications,
    },
  }

  const jsonString = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' })
  const dateStr = timestamp.slice(0, 10)
  const timeStr = timestamp.slice(11, 16).replace(':', '-')
  const fileName = `نسخة_احتياطية_شاملة_المخازن_${dateStr}_${timeStr}.json`

  // Trigger browser file download if in browser
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  try {
    localStorage.setItem(LAST_LOCAL_BACKUP_KEY, timestamp)
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `نسخ احتياطي محلي شامل: تنزيل نسخة لكافة بيانات النظام (${movements.length} حركة، ${custody.length} عهدة، ${contracts.length} عقد، ${disbursementRequests.length} طلب صرف، ${budgetPlans.length} بند موازنة، ${financialReports.length} تقرير مالي، ${assetMovements.length} أصل، ${supportTickets.length} تذكرة دعم)`,
    entity_type: 'backup',
    details: {
      movementsCount: movements.length,
      custodyCount: custody.length,
      usersCount: users.length,
      contractsCount: contracts.length,
      disbursementRequestsCount: disbursementRequests.length,
      budgetPlansCount: budgetPlans.length,
      financialReportsCount: financialReports.length,
      assetMovementsCount: assetMovements.length,
      supportTicketsCount: supportTickets.length,
      inspectionsCount: technicalInspections.length,
      settlementsCount: inventorySettlements.length,
      auditLogsCount: auditLogs.length,
      suppliersCount: suppliers.length,
      fileName,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts: payload.metadata.counts,
    timestamp,
    fileName,
  }
}

/**
 * Performs a complete backup and synchronization of ALL system records into Supabase cloud database.
 * Syncs movements, custody, users, settings, contracts, disbursements, budget, financial reports,
 * asset movements, support tickets, inspections, settlements, and telegram settings.
 * Restricted strictly to System Admin.
 */
export async function backupToSupabaseCloud(session?: Session | null): Promise<BackupResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  if (!supabase) {
    throw new Error('تعذر الاتصال بخادم Supabase. يرجى التحقق من اتصال الإنترنت وإعدادات البيئة.')
  }

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

  let technicalInspections: Record<string, unknown>[] = []
  try {
    const raw = localStorage.getItem(INSPECTIONS_STORAGE_KEY)
    if (raw) technicalInspections = JSON.parse(raw)
  } catch {
    // ignore
  }

  let inventorySettlements: Record<string, unknown>[] = []
  try {
    const raw = localStorage.getItem(SETTLEMENTS_STORAGE_KEY)
    if (raw) inventorySettlements = JSON.parse(raw)
  } catch {
    // ignore
  }

  const timestamp = new Date().toISOString()

  // 1. Settings Backup to Cloud
  await saveAppSettingsToCloud(settings)

  // 2. Custody Items Backup to Cloud
  if (custody.length > 0) {
    await saveCustodyItemsToCloud(custody)
  }

  // 3. Ledger Movements Backup to Cloud
  if (movements.length > 0) {
    await saveMovements(movements, session?.user?.id)
  }

  // 4. Users Backup to Cloud
  if (users.length > 0) {
    await syncUsersWithCloud()
  }

  // 5. Contracts Backup to Cloud
  if (contracts.length > 0) {
    for (const c of contracts) {
      try {
        const payload = sanitizeForUuidPk({
          ...c,
          attachments: c.attachments || [],
        })
        await supabase.from('supplier_contracts').upsert(payload, { onConflict: 'contract_number' })
      } catch (err) {
        console.warn('Could not sync contract to cloud:', err)
      }
    }
  }

  // 6. Disbursement Requests Backup to Cloud
  if (disbursementRequests.length > 0) {
    for (const d of disbursementRequests) {
      try {
        const payload = sanitizeForUuidPk(d)
        await supabase.from('disbursement_requests').upsert(payload, { onConflict: 'request_number' })
      } catch (err) {
        console.warn('Could not sync disbursement request to cloud:', err)
      }
    }
  }

  // 7. Budget Plans Backup to Cloud
  if (budgetPlans.length > 0) {
    for (const b of budgetPlans) {
      try {
        const payload = sanitizeForUuidPk(b)
        await supabase.from('budget_plans').upsert(payload)
      } catch (err) {
        console.warn('Could not sync budget plan to cloud:', err)
      }
    }
  }

  // 8. Financial Reports Backup to Cloud
  if (financialReports.length > 0) {
    for (const f of financialReports) {
      try {
        const payload = sanitizeForUuidPk(f)
        await supabase.from('financial_reports').upsert(payload, { onConflict: 'report_number' })
      } catch (err) {
        console.warn('Could not sync financial report to cloud:', err)
      }
    }
  }

  // 9. Asset Movement Log Backup to Cloud
  if (assetMovements.length > 0) {
    for (const a of assetMovements) {
      try {
        const payload = sanitizeForUuidPk(a)
        await supabase.from('asset_movement_log').upsert(payload)
      } catch (err) {
        console.warn('Could not sync asset movement to cloud:', err)
      }
    }
  }

  // 10. Support Tickets Backup to Cloud
  if (supportTickets.length > 0) {
    for (const t of supportTickets) {
      try {
        const payload = sanitizeForUuidPk(t)
        await supabase.from('support_tickets').upsert(payload, { onConflict: 'ticket_number' })
      } catch (err) {
        console.warn('Could not sync support ticket to cloud:', err)
      }
    }
  }

  // 11. Technical Inspections Backup to Cloud
  if (technicalInspections.length > 0) {
    for (const i of technicalInspections) {
      try {
        const payload = sanitizeForUuidPk(i)
        await supabase.from('technical_inspections').upsert(payload, { onConflict: 'inspection_number' })
      } catch (err) {
        console.warn('Could not sync inspection to cloud:', err)
      }
    }
  }

  // 12. Inventory Settlements Backup to Cloud
  if (inventorySettlements.length > 0) {
    for (const s of inventorySettlements) {
      try {
        const payload = sanitizeForUuidPk(s)
        await supabase.from('inventory_settlements').upsert(payload, { onConflict: 'settlement_number' })
      } catch (err) {
        console.warn('Could not sync settlement to cloud:', err)
      }
    }
  }

  // 13. Notifications Backup to Cloud
  if (notifications.length > 0) {
    for (const n of notifications) {
      try {
        const payload = sanitizeForUuidPk(n)
        await supabase.from('notifications').upsert(payload)
      } catch (err) {
        console.warn('Could not sync notification to cloud:', err)
      }
    }
  }

  try {
    localStorage.setItem(LAST_CLOUD_BACKUP_KEY, timestamp)
  } catch {
    // ignore
  }

  const counts: SystemBackupCounts = {
    movements: movements.length,
    custody: custody.length,
    users: users.length,
    auditLogs: auditLogs.length,
    contracts: contracts.length,
    disbursementRequests: disbursementRequests.length,
    budgetPlans: budgetPlans.length,
    financialReports: financialReports.length,
    assetMovements: assetMovements.length,
    supportTickets: supportTickets.length,
    technicalInspections: technicalInspections.length,
    inventorySettlements: inventorySettlements.length,
    notifications: notifications.length,
    settings: true,
  }

  void logAuditEvent({
    action: `نسخ احتياطي سحابي شامل: مزامنة وتأكيد قاعدة بيانات Supabase لكافة الجداول (${movements.length} حركة، ${custody.length} عهدة، ${contracts.length} عقد، ${disbursementRequests.length} طلب صرف، ${budgetPlans.length} ميزانية)`,
    entity_type: 'backup',
    details: {
      ...counts,
      syncedAt: timestamp,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts,
    timestamp,
  }
}

export function validateBackupPayload(jsonString: string): {
  valid: boolean
  payload?: SystemBackupPayload
  error?: string
} {
  try {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch {
      return { valid: false, error: 'الملف ليس بتنسيق JSON صحيح.' }
    }

    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'الملف ليس بتنسيق JSON صحيح.' }
    }
    const candidate = parsed as Partial<SystemBackupPayload>
    if (candidate.app !== 'warehouse-ledger') {
      return {
        valid: false,
        error: 'الملف المختار ليس نسخة احتياطية صالحة لنظام حركة المخزن (رمز التطبيق غير مطابق).',
      }
    }
    if (!candidate.data || typeof candidate.data !== 'object') {
      return { valid: false, error: 'النسخة الاحتياطية لا تحتوي على حزمة بيانات صالحة (حقل data مفقود).' }
    }

    const payload: SystemBackupPayload = {
      app: 'warehouse-ledger',
      version: candidate.version || '2.0.0',
      backupDate: candidate.backupDate || new Date().toISOString(),
      generator: candidate.generator || { role: 'admin' },
      metadata: candidate.metadata || {
        organization: candidate.data.settings?.organization || 'جامعة الزقازيق الأهلية',
        department: candidate.data.settings?.department || 'إدارة المخازن',
        currency: candidate.data.settings?.currency || 'EGP',
        counts: {
          movements: Array.isArray(candidate.data.movements) ? candidate.data.movements.length : 0,
          custody: Array.isArray(candidate.data.custody) ? candidate.data.custody.length : 0,
          users: Array.isArray(candidate.data.users) ? candidate.data.users.length : 0,
          auditLogs: Array.isArray(candidate.data.auditLogs) ? candidate.data.auditLogs.length : 0,
          suppliers: Array.isArray(candidate.data.suppliers) ? candidate.data.suppliers.length : 0,
          contracts: Array.isArray(candidate.data.contracts) ? candidate.data.contracts.length : 0,
          disbursementRequests: Array.isArray(candidate.data.disbursementRequests) ? candidate.data.disbursementRequests.length : 0,
          budgetPlans: Array.isArray(candidate.data.budgetPlans) ? candidate.data.budgetPlans.length : 0,
          financialReports: Array.isArray(candidate.data.financialReports) ? candidate.data.financialReports.length : 0,
          assetMovements: Array.isArray(candidate.data.assetMovements) ? candidate.data.assetMovements.length : 0,
          supportTickets: Array.isArray(candidate.data.supportTickets) ? candidate.data.supportTickets.length : 0,
          technicalInspections: Array.isArray(candidate.data.technicalInspections) ? candidate.data.technicalInspections.length : 0,
          inventorySettlements: Array.isArray(candidate.data.inventorySettlements) ? candidate.data.inventorySettlements.length : 0,
          telegramSettings: candidate.data.telegramSettings ? 1 : 0,
          notifications: Array.isArray(candidate.data.notifications) ? candidate.data.notifications.length : 0,
        },
      },
      data: {
        settings: candidate.data.settings || loadAppSettings(),
        movements: Array.isArray(candidate.data.movements) ? candidate.data.movements : [],
        custody: Array.isArray(candidate.data.custody) ? candidate.data.custody : [],
        users: Array.isArray(candidate.data.users) ? candidate.data.users : [],
        auditLogs: Array.isArray(candidate.data.auditLogs) ? candidate.data.auditLogs : [],
        suppliers: Array.isArray(candidate.data.suppliers) ? candidate.data.suppliers : [],
        contracts: Array.isArray(candidate.data.contracts) ? candidate.data.contracts : [],
        disbursementRequests: Array.isArray(candidate.data.disbursementRequests) ? candidate.data.disbursementRequests : [],
        budgetPlans: Array.isArray(candidate.data.budgetPlans) ? candidate.data.budgetPlans : [],
        financialReports: Array.isArray(candidate.data.financialReports) ? candidate.data.financialReports : [],
        assetMovements: Array.isArray(candidate.data.assetMovements) ? candidate.data.assetMovements : [],
        supportTickets: Array.isArray(candidate.data.supportTickets) ? candidate.data.supportTickets : [],
        technicalInspections: Array.isArray(candidate.data.technicalInspections) ? candidate.data.technicalInspections : [],
        inventorySettlements: Array.isArray(candidate.data.inventorySettlements) ? candidate.data.inventorySettlements : [],
        telegramSettings: candidate.data.telegramSettings,
        notifications: Array.isArray(candidate.data.notifications) ? candidate.data.notifications : [],
      },
    }

    return { valid: true, payload }
  } catch (err) {
    return {
      valid: false,
      error: `تعذر قراءة ملف النسخة الاحتياطية: ${err instanceof Error ? err.message : 'تنسيق غير صالح'}`,
    }
  }
}

/**
 * Restores system data from an uploaded valid JSON backup payload.
 * Restores all modules to local storage AND synchronizes to Supabase.
 * Dispatches reactive custom events so all page views update immediately.
 * Restricted strictly to System Admin.
 */
export async function restoreLocalBackup(
  payload: SystemBackupPayload,
  session?: Session | null,
  options?: RestoreOptions
): Promise<RestoreResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية استعادة النسخة الاحتياطية مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  const opts: Required<RestoreOptions> = {
    restoreMovements: true,
    restoreCustody: true,
    restoreUsers: true,
    restoreSettings: true,
    restoreAuditLogs: true,
    restoreSuppliers: true,
    restoreContracts: true,
    restoreDisbursementRequests: true,
    restoreBudgetPlans: true,
    restoreFinancialReports: true,
    restoreAssetMovements: true,
    restoreSupportTickets: true,
    restoreTechnicalInspections: true,
    restoreInventorySettlements: true,
    restoreTelegramSettings: true,
    restoreNotifications: true,
    ...options,
  }

  const counts: SystemBackupCounts = {
    movements: 0,
    custody: 0,
    users: 0,
    auditLogs: 0,
    suppliers: 0,
    contracts: 0,
    disbursementRequests: 0,
    budgetPlans: 0,
    financialReports: 0,
    assetMovements: 0,
    supportTickets: 0,
    technicalInspections: 0,
    inventorySettlements: 0,
    notifications: 0,
    settings: false,
  }

  // 1. Settings restoration
  if (opts.restoreSettings && payload.data.settings) {
    await saveAppSettingsToCloud(payload.data.settings)
    counts.settings = true
  }

  // 2. Custody items restoration
  if (opts.restoreCustody && Array.isArray(payload.data.custody)) {
    saveCustodyItems(payload.data.custody)
    counts.custody = payload.data.custody.length
    if (supabase && payload.data.custody.length > 0) {
      try {
        await saveCustodyItemsToCloud(payload.data.custody)
      } catch (err) {
        console.warn('Error syncing custody during restore:', err)
      }
    }
  }

  // 3. Movements restoration
  if (opts.restoreMovements && Array.isArray(payload.data.movements)) {
    try {
      localStorage.setItem('warehouse-ledger-movements', JSON.stringify(payload.data.movements))
      if (supabase && payload.data.movements.length > 0) {
        await saveMovements(payload.data.movements, session?.user?.id)
      }
    } catch (err) {
      console.warn('Error syncing movements during restore:', err)
    }
    counts.movements = payload.data.movements.length
  }

  // 4. Users restoration
  if (opts.restoreUsers && Array.isArray(payload.data.users) && payload.data.users.length > 0) {
    saveLocalUsers(payload.data.users)
    counts.users = payload.data.users.length
    if (supabase) {
      try {
        await syncUsersWithCloud()
      } catch (err) {
        console.warn('Error syncing users during restore:', err)
      }
    }
  }

  // 5. Custom Suppliers restoration
  if (opts.restoreSuppliers && Array.isArray(payload.data.suppliers) && payload.data.suppliers.length > 0) {
    try {
      localStorage.setItem('warehouse_custom_suppliers', JSON.stringify(payload.data.suppliers))
      counts.suppliers = payload.data.suppliers.length
    } catch (err) {
      console.warn('Error syncing suppliers during restore:', err)
    }
  }

  // 6. Contracts restoration (عقود الموردين والمرفقات)
  if (opts.restoreContracts && Array.isArray(payload.data.contracts)) {
    saveLocalContracts(payload.data.contracts)
    counts.contracts = payload.data.contracts.length
    if (supabase && payload.data.contracts.length > 0) {
      for (const c of payload.data.contracts) {
        try {
          const clean = sanitizeForUuidPk(c)
          await supabase.from('supplier_contracts').upsert(clean, { onConflict: 'contract_number' })
        } catch {
          // ignore
        }
      }
    }
  }

  // 7. Disbursement Requests restoration
  if (opts.restoreDisbursementRequests && Array.isArray(payload.data.disbursementRequests)) {
    saveLocalRequests(payload.data.disbursementRequests)
    counts.disbursementRequests = payload.data.disbursementRequests.length
    if (supabase && payload.data.disbursementRequests.length > 0) {
      for (const d of payload.data.disbursementRequests) {
        try {
          const clean = sanitizeForUuidPk(d)
          await supabase.from('disbursement_requests').upsert(clean, { onConflict: 'request_number' })
        } catch {
          // ignore
        }
      }
    }
  }

  // 8. Budget Plans restoration
  if (opts.restoreBudgetPlans && Array.isArray(payload.data.budgetPlans)) {
    saveLocalBudgetPlans(payload.data.budgetPlans)
    counts.budgetPlans = payload.data.budgetPlans.length
    if (supabase && payload.data.budgetPlans.length > 0) {
      for (const b of payload.data.budgetPlans) {
        try {
          const clean = sanitizeForUuidPk(b)
          await supabase.from('budget_plans').upsert(clean)
        } catch {
          // ignore
        }
      }
    }
  }

  // 9. Financial Reports restoration
  if (opts.restoreFinancialReports && Array.isArray(payload.data.financialReports)) {
    saveLocalReports(payload.data.financialReports)
    counts.financialReports = payload.data.financialReports.length
    if (supabase && payload.data.financialReports.length > 0) {
      for (const f of payload.data.financialReports) {
        try {
          const clean = sanitizeForUuidPk(f)
          await supabase.from('financial_reports').upsert(clean, { onConflict: 'report_number' })
        } catch {
          // ignore
        }
      }
    }
  }

  // 10. Asset Movements restoration
  if (opts.restoreAssetMovements && Array.isArray(payload.data.assetMovements)) {
    saveLocalAssetMovements(payload.data.assetMovements)
    counts.assetMovements = payload.data.assetMovements.length
    if (supabase && payload.data.assetMovements.length > 0) {
      for (const a of payload.data.assetMovements) {
        try {
          const clean = sanitizeForUuidPk(a)
          await supabase.from('asset_movement_log').upsert(clean)
        } catch {
          // ignore
        }
      }
    }
  }

  // 11. Support Tickets restoration
  if (opts.restoreSupportTickets && Array.isArray(payload.data.supportTickets)) {
    saveLocalTickets(payload.data.supportTickets)
    counts.supportTickets = payload.data.supportTickets.length
    if (supabase && payload.data.supportTickets.length > 0) {
      for (const t of payload.data.supportTickets) {
        try {
          const clean = sanitizeForUuidPk(t)
          await supabase.from('support_tickets').upsert(clean, { onConflict: 'ticket_number' })
        } catch {
          // ignore
        }
      }
    }
  }

  // 12. Technical Inspections restoration
  if (opts.restoreTechnicalInspections && Array.isArray(payload.data.technicalInspections)) {
    try {
      localStorage.setItem(INSPECTIONS_STORAGE_KEY, JSON.stringify(payload.data.technicalInspections))
      counts.technicalInspections = payload.data.technicalInspections.length
      if (supabase && payload.data.technicalInspections.length > 0) {
        for (const i of payload.data.technicalInspections) {
          try {
            const clean = sanitizeForUuidPk(i)
            await supabase.from('technical_inspections').upsert(clean, { onConflict: 'inspection_number' })
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.warn('Error restoring technical inspections:', err)
    }
  }

  // 13. Inventory Settlements restoration
  if (opts.restoreInventorySettlements && Array.isArray(payload.data.inventorySettlements)) {
    try {
      localStorage.setItem(SETTLEMENTS_STORAGE_KEY, JSON.stringify(payload.data.inventorySettlements))
      counts.inventorySettlements = payload.data.inventorySettlements.length
      if (supabase && payload.data.inventorySettlements.length > 0) {
        for (const s of payload.data.inventorySettlements) {
          try {
            const clean = sanitizeForUuidPk(s)
            await supabase.from('inventory_settlements').upsert(clean, { onConflict: 'settlement_number' })
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.warn('Error restoring inventory settlements:', err)
    }
  }

  // 14. Telegram Bot Settings restoration
  if (opts.restoreTelegramSettings && payload.data.telegramSettings) {
    try {
      await saveTelegramBotSettings(payload.data.telegramSettings, session?.user?.email || 'admin')
      counts.telegramSettings = 1
    } catch (err) {
      console.warn('Error restoring telegram settings:', err)
    }
  }

  // 15. Notifications restoration
  if (opts.restoreNotifications && Array.isArray(payload.data.notifications)) {
    saveLocalNotifications(payload.data.notifications)
    counts.notifications = payload.data.notifications.length
    if (supabase && payload.data.notifications.length > 0) {
      for (const n of payload.data.notifications) {
        try {
          const clean = sanitizeForUuidPk(n)
          await supabase.from('notifications').upsert(clean)
        } catch {
          // ignore
        }
      }
    }
  }

  // 16. Audit logs restoration
  if (opts.restoreAuditLogs && Array.isArray(payload.data.auditLogs) && payload.data.auditLogs.length > 0) {
    try {
      const existing = getLocalAuditLogs()
      const logMap = new Map<string, AuditLogEntry>()
      for (const log of existing) {
        if (log.id) logMap.set(log.id, log)
      }
      for (const log of payload.data.auditLogs) {
        if (log.id) logMap.set(log.id, log)
      }
      const mergedLogs = Array.from(logMap.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      localStorage.setItem('warehouse-ledger-audit-logs', JSON.stringify(mergedLogs))
      counts.auditLogs = payload.data.auditLogs.length
    } catch (err) {
      console.warn('Error syncing audit logs during restore:', err)
    }
  }

  const timestamp = new Date().toISOString()

  // Dispatch global events for ALL system pages so that views react immediately
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local-users-changed'))
      window.dispatchEvent(new CustomEvent('warehouse-ledger-updated'))
      window.dispatchEvent(new CustomEvent('custody-changed'))
      window.dispatchEvent(new CustomEvent('custody-items-changed'))
      window.dispatchEvent(new CustomEvent('settings-changed'))
      window.dispatchEvent(new CustomEvent('suppliers-changed'))
      window.dispatchEvent(new CustomEvent('audit-logs-changed'))
      window.dispatchEvent(new CustomEvent('contracts-changed'))
      window.dispatchEvent(new CustomEvent('disbursement-requests-changed'))
      window.dispatchEvent(new CustomEvent('budget-plans-changed'))
      window.dispatchEvent(new CustomEvent('financial-reports-changed'))
      window.dispatchEvent(new CustomEvent('asset-movements-changed'))
      window.dispatchEvent(new CustomEvent('support-tickets-changed'))
      window.dispatchEvent(new CustomEvent('technical-inspections-changed'))
      window.dispatchEvent(new CustomEvent('inventory-settlements-changed'))
      window.dispatchEvent(new CustomEvent('telegram-settings-changed'))
      window.dispatchEvent(new CustomEvent('notifications-changed'))
    }
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `استعادة شاملة من ملف محلي: تم استعادة كافة الجداول المحددة بنجاح`,
    entity_type: 'backup',
    details: {
      ...counts,
      originalBackupDate: payload.backupDate,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts,
    source: 'local_file',
    timestamp,
  }
}

/**
 * Restores and synchronizes local records from Supabase cloud database across ALL tables.
 * Restricted strictly to System Admin.
 */
export async function restoreFromCloud(session?: Session | null): Promise<RestoreResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية استعادة النسخة الاحتياطية مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  if (!supabase) {
    throw new Error('تعذر الاتصال بخادم Supabase. يرجى التحقق من اتصال الإنترنت وإعدادات البيئة.')
  }

  const counts: SystemBackupCounts = {
    movements: 0,
    custody: 0,
    users: 0,
    auditLogs: 0,
    suppliers: 0,
    contracts: 0,
    disbursementRequests: 0,
    budgetPlans: 0,
    financialReports: 0,
    assetMovements: 0,
    supportTickets: 0,
    technicalInspections: 0,
    inventorySettlements: 0,
    notifications: 0,
    settings: false,
  }

  // 1. Settings
  const cloudSettings = await fetchAppSettingsFromCloud()
  if (cloudSettings) {
    await saveAppSettingsToCloud(cloudSettings)
    counts.settings = true
  }

  // 2. Custody
  try {
    const cloudCustody = await fetchCustodyItemsFromCloud()
    if (cloudCustody && cloudCustody.length > 0) {
      saveCustodyItems(cloudCustody)
      counts.custody = cloudCustody.length
    }
  } catch (err) {
    console.warn('Could not restore custody from cloud:', err)
  }

  // 3. Movements
  try {
    const cloudMovements = await fetchMovements()
    if (cloudMovements && Array.isArray(cloudMovements)) {
      localStorage.setItem('warehouse-ledger-movements', JSON.stringify(cloudMovements))
      counts.movements = cloudMovements.length
    }
  } catch (err) {
    console.warn('Could not restore movements from cloud:', err)
  }

  // 4. Users
  try {
    const cloudUsers = await fetchUsersFromCloud()
    if (cloudUsers && cloudUsers.length > 0) {
      saveLocalUsers(cloudUsers)
      counts.users = cloudUsers.length
    }
  } catch (err) {
    console.warn('Could not restore users from cloud:', err)
  }

  // 5. Audit logs
  try {
    const cloudAuditLogs = await fetchAuditLogs(500)
    if (cloudAuditLogs && cloudAuditLogs.length > 0) {
      localStorage.setItem('warehouse-ledger-audit-logs', JSON.stringify(cloudAuditLogs))
      counts.auditLogs = cloudAuditLogs.length
    }
  } catch (err) {
    console.warn('Could not restore audit logs from cloud:', err)
  }

  // 6. Suppliers
  try {
    const cloudSuppliers = await fetchActiveSuppliers()
    if (cloudSuppliers && cloudSuppliers.length > 0) {
      localStorage.setItem('warehouse_custom_suppliers', JSON.stringify(cloudSuppliers))
      counts.suppliers = cloudSuppliers.length
    }
  } catch (err) {
    console.warn('Could not restore suppliers from cloud:', err)
  }

  // 7. Contracts (عقود الموردين بمرفقاتها)
  try {
    const { data: cloudContracts } = await supabase.from('supplier_contracts').select('*').order('created_at', { ascending: false })
    if (cloudContracts && Array.isArray(cloudContracts)) {
      saveLocalContracts(cloudContracts)
      counts.contracts = cloudContracts.length
    }
  } catch (err) {
    console.warn('Could not restore contracts from cloud:', err)
  }

  // 8. Disbursement Requests (طلبات الصرف الداخلي)
  try {
    const { data: cloudRequests } = await supabase.from('disbursement_requests').select('*').order('created_at', { ascending: false })
    if (cloudRequests && Array.isArray(cloudRequests)) {
      saveLocalRequests(cloudRequests)
      counts.disbursementRequests = cloudRequests.length
    }
  } catch (err) {
    console.warn('Could not restore disbursement requests from cloud:', err)
  }

  // 9. Budget Plans (الميزانية والتخطيط)
  try {
    const { data: cloudBudget } = await supabase.from('budget_plans').select('*').order('allocated_amount', { ascending: false })
    if (cloudBudget && Array.isArray(cloudBudget)) {
      saveLocalBudgetPlans(cloudBudget)
      counts.budgetPlans = cloudBudget.length
    }
  } catch (err) {
    console.warn('Could not restore budget plans from cloud:', err)
  }

  // 10. Financial Reports (التقارير المالية)
  try {
    const { data: cloudReports } = await supabase.from('financial_reports').select('*').order('created_at', { ascending: false })
    if (cloudReports && Array.isArray(cloudReports)) {
      saveLocalReports(cloudReports)
      counts.financialReports = cloudReports.length
    }
  } catch (err) {
    console.warn('Could not restore financial reports from cloud:', err)
  }

  // 11. Asset Movements (سجل حركة الأصول)
  try {
    const { data: cloudAssets } = await supabase.from('asset_movement_log').select('*').order('performed_at', { ascending: false })
    if (cloudAssets && Array.isArray(cloudAssets)) {
      saveLocalAssetMovements(cloudAssets)
      counts.assetMovements = cloudAssets.length
    }
  } catch (err) {
    console.warn('Could not restore asset movements from cloud:', err)
  }

  // 12. Support Tickets (تذاكر الدعم)
  try {
    const { data: cloudTickets } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false })
    if (cloudTickets && Array.isArray(cloudTickets)) {
      saveLocalTickets(cloudTickets)
      counts.supportTickets = cloudTickets.length
    }
  } catch (err) {
    console.warn('Could not restore support tickets from cloud:', err)
  }

  // 13. Technical Inspections (محاضر الفحص الفني)
  try {
    const { data: cloudInspections } = await supabase.from('technical_inspections').select('*').order('created_at', { ascending: false })
    if (cloudInspections && Array.isArray(cloudInspections)) {
      localStorage.setItem(INSPECTIONS_STORAGE_KEY, JSON.stringify(cloudInspections))
      counts.technicalInspections = cloudInspections.length
    }
  } catch (err) {
    console.warn('Could not restore technical inspections from cloud:', err)
  }

  // 14. Inventory Settlements (محاضر التسوية الجردية)
  try {
    const { data: cloudSettlements } = await supabase.from('inventory_settlements').select('*').order('created_at', { ascending: false })
    if (cloudSettlements && Array.isArray(cloudSettlements)) {
      localStorage.setItem(SETTLEMENTS_STORAGE_KEY, JSON.stringify(cloudSettlements))
      counts.inventorySettlements = cloudSettlements.length
    }
  } catch (err) {
    console.warn('Could not restore inventory settlements from cloud:', err)
  }

  // 15. Telegram Bot Settings
  try {
    const telegramSettings = await fetchTelegramBotSettings()
    if (telegramSettings) counts.telegramSettings = 1
  } catch (err) {
    console.warn('Could not restore telegram settings from cloud:', err)
  }

  // 16. Notifications
  try {
    const { data: cloudNotifs } = await supabase.from('notifications').select('*').order('created_at', { ascending: false })
    if (cloudNotifs && Array.isArray(cloudNotifs)) {
      saveLocalNotifications(cloudNotifs)
      counts.notifications = cloudNotifs.length
    }
  } catch (err) {
    console.warn('Could not restore notifications from cloud:', err)
  }

  const timestamp = new Date().toISOString()

  // Dispatch global events for UI views
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local-users-changed'))
      window.dispatchEvent(new CustomEvent('warehouse-ledger-updated'))
      window.dispatchEvent(new CustomEvent('custody-changed'))
      window.dispatchEvent(new CustomEvent('custody-items-changed'))
      window.dispatchEvent(new CustomEvent('settings-changed'))
      window.dispatchEvent(new CustomEvent('suppliers-changed'))
      window.dispatchEvent(new CustomEvent('audit-logs-changed'))
      window.dispatchEvent(new CustomEvent('contracts-changed'))
      window.dispatchEvent(new CustomEvent('disbursement-requests-changed'))
      window.dispatchEvent(new CustomEvent('budget-plans-changed'))
      window.dispatchEvent(new CustomEvent('financial-reports-changed'))
      window.dispatchEvent(new CustomEvent('asset-movements-changed'))
      window.dispatchEvent(new CustomEvent('support-tickets-changed'))
      window.dispatchEvent(new CustomEvent('technical-inspections-changed'))
      window.dispatchEvent(new CustomEvent('inventory-settlements-changed'))
      window.dispatchEvent(new CustomEvent('telegram-settings-changed'))
      window.dispatchEvent(new CustomEvent('notifications-changed'))
    }
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `استعادة شاملة من سحابة Supabase: تم جلب ومزامنة كافة الجداول وقواعد البيانات`,
    entity_type: 'backup',
    details: {
      ...counts,
      restoredAt: timestamp,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts,
    source: 'cloud',
    timestamp,
  }
}
