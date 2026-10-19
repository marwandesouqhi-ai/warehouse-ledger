import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/settings')>()
  return {
    ...actual,
    saveAppSettingsToCloud: vi.fn().mockImplementation(async (settings) => {
      localStorage.setItem('warehouse-ledger-settings', JSON.stringify(settings))
    }),
  }
})

import {
  exportLocalBackup,
  backupToSupabaseCloud,
  formatBackupTimestamp,
  LAST_LOCAL_BACKUP_KEY,
  validateBackupPayload,
  restoreLocalBackup,
} from '../../src/lib/backup'
import type { Session } from '@supabase/supabase-js'

describe('System Backup Suite', () => {
  const adminSession = {
    user: {
      id: 'admin-uuid-1',
      email: 'marwan-desouky',
      user_metadata: { username: 'marwan-desouky', role: 'admin' },
      app_metadata: { role: 'admin', system_admin: true },
    },
  } as unknown as Session

  const regularSession = {
    user: {
      id: 'editor-uuid-2',
      email: 'editor@example.com',
      user_metadata: { username: 'editor', role: 'editor' },
      app_metadata: { role: 'editor' },
    },
  } as unknown as Session

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('rejects backup execution for non-system admin sessions', async () => {
    await expect(exportLocalBackup(regularSession)).rejects.toThrow(
      'عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).'
    )

    await expect(backupToSupabaseCloud(regularSession)).rejects.toThrow(
      'عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).'
    )

    await expect(exportLocalBackup(null)).rejects.toThrow(
      'عملية النسخ الاحتياطي مقتصرة حصرياً على مدير النظام (System Admin).'
    )
  })

  it('exports local backup file on device when called by System Admin', async () => {
    // Mock URL.createObjectURL and revokeObjectURL
    const createObjectUrlMock = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectUrlMock = vi.fn()
    globalThis.URL.createObjectURL = createObjectUrlMock
    globalThis.URL.revokeObjectURL = revokeObjectUrlMock

    // Seed some custody and movements
    localStorage.setItem(
      'warehouse-ledger-movements',
      JSON.stringify([{ id: 'm-1', item: 'حبر طابعة', qin: '10' }])
    )
    localStorage.setItem(
      'warehouse-ledger-custody-items',
      JSON.stringify([{ id: 'c-1', warehouseId: 'main', name: 'شاشة', quantity: 2, value: 5000 }])
    )

    const result = await exportLocalBackup(adminSession)
    expect(result.success).toBe(true)
    expect(result.counts.movements).toBe(1)
    expect(result.counts.custody).toBe(1)
    expect(result.fileName).toContain('نسخة_احتياطية_شاملة_المخازن_')
    expect(localStorage.getItem(LAST_LOCAL_BACKUP_KEY)).toBeTruthy()
  })

  it('formats backup timestamps correctly in Arabic format', () => {
    expect(formatBackupTimestamp(null)).toBe('لم يتم إجراء نسخ بعد')
    expect(formatBackupTimestamp(undefined)).toBe('لم يتم إجراء نسخ بعد')
    const formatted = formatBackupTimestamp('2026-10-12T10:00:00.000Z')
    expect(formatted).not.toBe('لم يتم إجراء نسخ بعد')
    expect(typeof formatted).toBe('string')
  })

  it('validates backup payload structure correctly', () => {
    // 1. Invalid JSON
    const res1 = validateBackupPayload('not-json')
    expect(res1.valid).toBe(false)
    expect(res1.error).toContain('الملف ليس بتنسيق JSON صحيح')

    // 2. Mismatched app name
    const res2 = validateBackupPayload(JSON.stringify({ app: 'other-app', data: {} }))
    expect(res2.valid).toBe(false)
    expect(res2.error).toContain('رمز التطبيق غير مطابق')

    // 3. Valid payload
    const validJson = JSON.stringify({
      app: 'warehouse-ledger',
      version: '1.0.0',
      backupDate: new Date().toISOString(),
      metadata: { organization: 'جامعة', department: 'مخازن', currency: 'EGP', counts: { movements: 1, custody: 1, users: 1, auditLogs: 0 } },
      data: {
        settings: { organization: 'جامعة', department: 'مخازن', currency: 'EGP' },
        movements: [{ id: 'm-100', item: 'ورق تصوير', qin: '5' }],
        custody: [{ id: 'c-100', warehouseId: 'main', name: 'طابعة ليزر', quantity: 1, value: 3000 }],
        users: [{ id: 'u-1', username: 'admin', role: 'admin' }],
        auditLogs: [],
      },
    })
    const res3 = validateBackupPayload(validJson)
    expect(res3.valid).toBe(true)
    expect(res3.payload?.data.movements.length).toBe(1)
    expect(res3.payload?.data.custody.length).toBe(1)
  })

  it('rejects restore execution for non-system admin sessions', async () => {
    const validPayload = {
      app: 'warehouse-ledger' as const,
      version: '1.0.0' as const,
      backupDate: new Date().toISOString(),
      generator: { role: 'admin' },
      metadata: { organization: 'مؤسسة', department: 'مخازن', currency: 'EGP', counts: { movements: 0, custody: 0, users: 0, auditLogs: 0 } },
      data: {
        settings: { organization: 'مؤسسة', department: 'مخازن', currency: 'EGP' as const },
        movements: [],
        custody: [],
        users: [],
        auditLogs: [],
      },
    }

    await expect(restoreLocalBackup(validPayload, regularSession)).rejects.toThrow(
      'عملية استعادة النسخة الاحتياطية مقتصرة حصرياً على مدير النظام (System Admin).'
    )
  })

  it('successfully restores system data from valid backup payload for System Admin', async () => {
    const payload = {
      app: 'warehouse-ledger' as const,
      version: '1.0.0' as const,
      backupDate: '2026-10-12T09:00:00.000Z',
      generator: { role: 'admin' },
      metadata: { organization: 'جامعة الزقازيق الأهلية', department: 'المخازن', currency: 'EGP', counts: { movements: 1, custody: 1, users: 1, auditLogs: 0 } },
      data: {
        settings: { organization: 'جامعة الزقازيق الأهلية', department: 'المخازن', currency: 'EGP' as const },
        movements: [{ id: 'm-test-1', item: 'كابلات شبكة', qin: '50' } as any],
        custody: [{ id: 'c-test-1', warehouseId: 'main', name: 'سويتش شبكات', quantity: 2, value: 8000 } as any],
        users: [{ id: 'u-admin-test', username: 'admin-test', role: 'admin' } as any],
        auditLogs: [],
      },
    }

    const result = await restoreLocalBackup(payload, adminSession)
    expect(result.success).toBe(true)
    expect(result.counts.movements).toBe(1)
    expect(result.counts.custody).toBe(1)
    expect(result.counts.users).toBe(1)
    expect(result.counts.settings).toBe(true)

    // Verify localStorage has the restored data
    const storedMovements = JSON.parse(localStorage.getItem('warehouse-ledger-movements') || '[]')
    expect(storedMovements.length).toBe(1)
    expect(storedMovements[0].item).toBe('كابلات شبكة')
  })

  it('preserves outward movements with qout, to, permit, and restores custom suppliers', async () => {
    // 1. Seed movements with both inward and outward (disbursement) records
    const testMovements = [
      { id: 'm-in', item: 'طابعة ليزر', qin: '5', price: '2000', from: 'شركة النيل' },
      { id: 'm-out', item: 'طابعة ليزر', qout: '2', to: 'كلية حاسبات', permit: 'DSP-2026-001', issue: '2026-10-15' },
    ]
    localStorage.setItem('warehouse-ledger-movements', JSON.stringify(testMovements))

    const testSuppliers = [
      { id: 'sup-1', name: 'شركة الأهرام للتوريدات', name_key: 'الأهرام', status: 'active' },
    ]
    localStorage.setItem('warehouse_custom_suppliers', JSON.stringify(testSuppliers))

    const createObjectUrlMock = vi.fn().mockReturnValue('blob:mock-url')
    globalThis.URL.createObjectURL = createObjectUrlMock
    globalThis.URL.revokeObjectURL = vi.fn()

    const backupResult = await exportLocalBackup(adminSession)
    expect(backupResult.success).toBe(true)
    expect(backupResult.counts.movements).toBe(2)

    // Clear localStorage to simulate restore on a new browser/machine
    localStorage.clear()

    const payload = {
      app: 'warehouse-ledger' as const,
      version: '1.0.0' as const,
      backupDate: new Date().toISOString(),
      generator: { role: 'admin' },
      metadata: { organization: 'ZNU', department: 'المخازن', currency: 'EGP', counts: { movements: 2, custody: 0, users: 0, auditLogs: 0, suppliers: 1 } },
      data: {
        settings: { organization: 'ZNU', department: 'المخازن', currency: 'EGP' as const },
        movements: testMovements as any,
        custody: [],
        users: [],
        auditLogs: [],
        suppliers: testSuppliers as any,
      },
    }

    const eventsFired: string[] = []
    const trackEvent = (e: Event) => eventsFired.push(e.type)
    window.addEventListener('warehouse-ledger-updated', trackEvent)
    window.addEventListener('custody-changed', trackEvent)
    window.addEventListener('suppliers-changed', trackEvent)

    const restoreResult = await restoreLocalBackup(payload, adminSession)
    expect(restoreResult.success).toBe(true)
    expect(restoreResult.counts.movements).toBe(2)

    // Check restored movements in storage
    const restoredMovements = JSON.parse(localStorage.getItem('warehouse-ledger-movements') || '[]')
    expect(restoredMovements.length).toBe(2)
    const outMv = restoredMovements.find((m: any) => m.id === 'm-out')
    expect(outMv).toBeTruthy()
    expect(outMv.qout).toBe('2')
    expect(outMv.to).toBe('كلية حاسبات')
    expect(outMv.permit).toBe('DSP-2026-001')

    // Check restored suppliers in storage
    const restoredSuppliers = JSON.parse(localStorage.getItem('warehouse_custom_suppliers') || '[]')
    expect(restoredSuppliers.length).toBe(1)
    expect(restoredSuppliers[0].name).toBe('شركة الأهرام للتوريدات')

    // Verify UI synchronization events were fired
    expect(eventsFired).toContain('warehouse-ledger-updated')
    expect(eventsFired).toContain('custody-changed')
    expect(eventsFired).toContain('suppliers-changed')
  })
})

