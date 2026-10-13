import type { Session } from '@supabase/supabase-js'
import { logAuditEvent, getLocalAuditLogs, type AuditLogEntry } from './auditLogger'
import { fetchCustodyItemsFromCloud, loadCustodyItems, saveCustodyItems, saveCustodyItemsToCloud, type CustodyItem } from './custody'
import type { FixtureMovement } from './fixture'
import { fetchUsersFromCloud, loadLocalUsers, saveLocalUsers, syncUsersWithCloud, type LocalUser } from './localUsers'
import { fetchMovements, saveMovements } from './movementsRepository'
import { fetchAppSettingsFromCloud, loadAppSettings, saveAppSettingsToCloud, type AppSettings } from './settings'
import { checkIsSystemAdmin, supabase } from './supabase'

export const LAST_CLOUD_BACKUP_KEY = 'warehouse-ledger-last-cloud-backup'
export const LAST_LOCAL_BACKUP_KEY = 'warehouse-ledger-last-local-backup'

export type SystemBackupPayload = {
  app: 'warehouse-ledger'
  version: '1.0.0'
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
    counts: {
      movements: number
      custody: number
      users: number
      auditLogs: number
    }
  }
  data: {
    settings: AppSettings
    movements: FixtureMovement[]
    custody: CustodyItem[]
    users: LocalUser[]
    auditLogs: AuditLogEntry[]
  }
}

export type BackupResult = {
  success: boolean
  counts: {
    movements: number
    custody: number
    users: number
    auditLogs?: number
    settings?: boolean
  }
  timestamp: string
  fileName?: string
}

export function getStoredMovements(): FixtureMovement[] {
  try {
    const raw = localStorage.getItem('warehouse-ledger-movements')
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed as FixtureMovement[]
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
 * Restricted strictly to System Admin.
 */
export async function exportLocalBackup(session?: Session | null): Promise<BackupResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  const settings = loadAppSettings()
  const movements = getStoredMovements()
  const custody = loadCustodyItems()
  const users = loadLocalUsers()
  const auditLogs = getLocalAuditLogs()
  const timestamp = new Date().toISOString()

  const payload: SystemBackupPayload = {
    app: 'warehouse-ledger',
    version: '1.0.0',
    backupDate: timestamp,
    generator: {
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? session?.user?.user_metadata?.username ?? 'admin',
      role: 'admin',
    },
    metadata: {
      organization: settings.organization || 'المؤسسة التعليمية',
      department: settings.department || 'إدارة المخازن المركزية',
      currency: settings.currency || 'EGP',
      counts: {
        movements: movements.length,
        custody: custody.length,
        users: users.length,
        auditLogs: auditLogs.length,
      },
    },
    data: {
      settings,
      movements,
      custody,
      users,
      auditLogs,
    },
  }

  const jsonString = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' })
  const dateStr = timestamp.slice(0, 10)
  const timeStr = timestamp.slice(11, 16).replace(':', '-')
  const fileName = `نسخة_احتياطية_شاملة_المخازن_${dateStr}_${timeStr}.json`

  // Trigger browser file download
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)

  try {
    localStorage.setItem(LAST_LOCAL_BACKUP_KEY, timestamp)
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `نسخ احتياطي محلي: تنزيل نسخة شاملة على جهاز الكمبيوتر (${movements.length} حركة، ${custody.length} عهدة)`,
    entity_type: 'backup',
    details: {
      movementsCount: movements.length,
      custodyCount: custody.length,
      usersCount: users.length,
      auditLogsCount: auditLogs.length,
      fileName,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts: {
      movements: movements.length,
      custody: custody.length,
      users: users.length,
      auditLogs: auditLogs.length,
    },
    timestamp,
    fileName,
  }
}

/**
 * Performs a complete backup and synchronization of all local records into Supabase cloud database.
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

  try {
    localStorage.setItem(LAST_CLOUD_BACKUP_KEY, timestamp)
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `نسخ احتياطي سحابي: مزامنة وتأكيد قاعدة بيانات Supabase كاملة (${movements.length} حركة، ${custody.length} عهدة)`,
    entity_type: 'backup',
    details: {
      movementsCount: movements.length,
      custodyCount: custody.length,
      usersCount: users.length,
      settingsBackedUp: true,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts: {
      movements: movements.length,
      custody: custody.length,
      users: users.length,
      settings: true,
    },
    timestamp,
  }
}

export type RestoreOptions = {
  restoreMovements?: boolean
  restoreCustody?: boolean
  restoreUsers?: boolean
  restoreSettings?: boolean
}

export type RestoreResult = {
  success: boolean
  counts: {
    movements: number
    custody: number
    users: number
    settings?: boolean
  }
  source: 'local_file' | 'cloud'
  timestamp: string
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
      version: candidate.version || '1.0.0',
      backupDate: candidate.backupDate || new Date().toISOString(),
      generator: candidate.generator || { role: 'admin' },
      metadata: candidate.metadata || {
        organization: candidate.data.settings?.organization || 'المؤسسة',
        department: candidate.data.settings?.department || 'المخازن',
        currency: candidate.data.settings?.currency || 'EGP',
        counts: {
          movements: Array.isArray(candidate.data.movements) ? candidate.data.movements.length : 0,
          custody: Array.isArray(candidate.data.custody) ? candidate.data.custody.length : 0,
          users: Array.isArray(candidate.data.users) ? candidate.data.users.length : 0,
          auditLogs: Array.isArray(candidate.data.auditLogs) ? candidate.data.auditLogs.length : 0,
        },
      },
      data: {
        settings: candidate.data.settings || loadAppSettings(),
        movements: Array.isArray(candidate.data.movements) ? candidate.data.movements : [],
        custody: Array.isArray(candidate.data.custody) ? candidate.data.custody : [],
        users: Array.isArray(candidate.data.users) ? candidate.data.users : [],
        auditLogs: Array.isArray(candidate.data.auditLogs) ? candidate.data.auditLogs : [],
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

  const opts = {
    restoreMovements: true,
    restoreCustody: true,
    restoreUsers: true,
    restoreSettings: true,
    ...options,
  }

  let movementsCount = 0
  let custodyCount = 0
  let usersCount = 0
  let settingsRestored = false

  // 1. Settings restoration
  if (opts.restoreSettings && payload.data.settings) {
    await saveAppSettingsToCloud(payload.data.settings)
    settingsRestored = true
  }

  // 2. Custody items restoration
  if (opts.restoreCustody && Array.isArray(payload.data.custody)) {
    saveCustodyItems(payload.data.custody)
    custodyCount = payload.data.custody.length
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
    movementsCount = payload.data.movements.length
  }

  // 4. Users restoration
  if (opts.restoreUsers && Array.isArray(payload.data.users) && payload.data.users.length > 0) {
    saveLocalUsers(payload.data.users)
    usersCount = payload.data.users.length
  }

  const timestamp = new Date().toISOString()

  // Dispatch global events so active UI views react
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local-users-changed'))
      window.dispatchEvent(new CustomEvent('warehouse-ledger-updated'))
      window.dispatchEvent(new CustomEvent('custody-items-changed'))
    }
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `استعادة نسخة احتياطية من ملف محلي: تم استعادة ${movementsCount} حركة، ${custodyCount} صنف عهدة، ${usersCount} مستخدم`,
    entity_type: 'backup',
    details: {
      movementsCount,
      custodyCount,
      usersCount,
      settingsRestored,
      originalBackupDate: payload.backupDate,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts: {
      movements: movementsCount,
      custody: custodyCount,
      users: usersCount,
      settings: settingsRestored,
    },
    source: 'local_file',
    timestamp,
  }
}

/**
 * Restores and synchronizes local records from Supabase cloud database.
 * Restricted strictly to System Admin.
 */
export async function restoreFromCloud(session?: Session | null): Promise<RestoreResult> {
  if (!checkIsSystemAdmin(session)) {
    throw new Error('عملية استعادة النسخة الاحتياطية مقتصرة حصرياً على مدير النظام (System Admin).')
  }

  if (!supabase) {
    throw new Error('تعذر الاتصال بخادم Supabase. يرجى التحقق من اتصال الإنترنت وإعدادات البيئة.')
  }

  let settingsRestored = false
  const cloudSettings = await fetchAppSettingsFromCloud()
  if (cloudSettings) {
    await saveAppSettingsToCloud(cloudSettings)
    settingsRestored = true
  }

  let custodyCount = 0
  try {
    const cloudCustody = await fetchCustodyItemsFromCloud()
    if (cloudCustody && cloudCustody.length > 0) {
      saveCustodyItems(cloudCustody)
      custodyCount = cloudCustody.length
    }
  } catch (err) {
    console.warn('Could not restore custody from cloud:', err)
  }

  let movementsCount = 0
  try {
    const cloudMovements = await fetchMovements()
    if (cloudMovements && Array.isArray(cloudMovements)) {
      localStorage.setItem('warehouse-ledger-movements', JSON.stringify(cloudMovements))
      movementsCount = cloudMovements.length
    }
  } catch (err) {
    console.warn('Could not restore movements from cloud:', err)
  }

  let usersCount = 0
  try {
    const cloudUsers = await fetchUsersFromCloud()
    if (cloudUsers && cloudUsers.length > 0) {
      saveLocalUsers(cloudUsers)
      usersCount = cloudUsers.length
    }
  } catch (err) {
    console.warn('Could not restore users from cloud:', err)
  }

  const timestamp = new Date().toISOString()

  // Dispatch global events so UI views react
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local-users-changed'))
      window.dispatchEvent(new CustomEvent('warehouse-ledger-updated'))
      window.dispatchEvent(new CustomEvent('custody-items-changed'))
    }
  } catch {
    // ignore
  }

  void logAuditEvent({
    action: `استعادة نسخة احتياطية من Supabase: تم جلب ${movementsCount} حركة، ${custodyCount} صنف عهدة، ${usersCount} مستخدم`,
    entity_type: 'backup',
    details: {
      movementsCount,
      custodyCount,
      usersCount,
      settingsRestored,
    },
    user: session?.user,
  })

  return {
    success: true,
    counts: {
      movements: movementsCount,
      custody: custodyCount,
      users: usersCount,
      settings: settingsRestored,
    },
    source: 'cloud',
    timestamp,
  }
}
