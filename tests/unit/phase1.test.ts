import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSafeStorage } from '../../src/lib/browserStorage'
import { localDate } from '../../src/lib/localDate'
import { loadMovements, movementStorageKey, persistMovementsLocally } from '../../src/lib/movementStorage'
import { loadInitialRecords } from '../../src/lib/initialRecords'
import { CUSTODY_STORAGE_KEY, loadCustodyItems, resolveDisbursementSources, syncOutwardMovementToCustody, type CustodyItem } from '../../src/lib/custody'

vi.mock('../../src/lib/supabase', () => ({ supabase: null }))

export const stock: CustodyItem = {
  id: 'source-a', warehouseId: 'main', code: 'A', name: 'حاسوب', quantity: 5,
  unit: 'قطعة', unitPrice: 100, value: 500, condition: 'good', category: 'أجهزة إلكترونية وحواسب',
  custodian: 'أمين المخزن', custodyType: 'مستديمة', roomLocation: 'المخزن', acquisitionDate: '2026-01-01',
}

beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_DEMO_MODE', 'false') })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Phase 1 safe startup', () => {
  it('preserves outward-only and mixed saved movements, including metadata, across reloads', () => {
    const records = [
      { id: 'out', item: 'حاسوب', qin: 0, qout: 2, to: 'كلية', permit: 'P1', issue: '2026-11-03', sourceItemId: 'a' },
      { id: 'mixed', item: 'شاشة', qin: 5, qout: 1, to: 'موظف', permit: 'P2', issue: '2026-11-03', extra: 'preserve' },
    ]
    const raw = JSON.stringify(records)
    localStorage.setItem(movementStorageKey, raw)
    expect(loadMovements()).toEqual(records)
    expect(loadMovements()).toEqual(records)
    expect(localStorage.getItem(movementStorageKey)).toBe(raw)
  })
  it('does not overwrite malformed saved movements with an empty fallback', () => {
    localStorage.setItem(movementStorageKey, '{recoverable bytes')
    persistMovementsLocally(loadMovements())
    expect(localStorage.getItem(movementStorageKey)).toBe('{recoverable bytes')
  })
  it('keeps missing and empty stock empty, and never filters or repairs existing records', () => {
    expect(loadCustodyItems()).toEqual([])
    expect(localStorage.getItem(CUSTODY_STORAGE_KEY)).toBeNull()
    const records = [{ ...stock, id: 'demo-user-record', quantity: 0, value: 100 }]
    const raw = JSON.stringify(records)
    localStorage.setItem(CUSTODY_STORAGE_KEY, raw)
    expect(loadCustodyItems()).toEqual(records)
    expect(localStorage.getItem(CUSTODY_STORAGE_KEY)).toBe(raw)
    localStorage.setItem(CUSTODY_STORAGE_KEY, '[]')
    expect(loadCustodyItems()).toEqual([])
  })
  it('initializes demo data only once under an explicit flag, preserving an existing empty store', () => {
    expect(loadInitialRecords('demo-test', [stock])).toEqual([])
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    expect(loadInitialRecords('demo-test', [stock])).toEqual([stock])
    expect(localStorage.getItem('demo-test:demo-initialized:v1')).toBe('true')
    localStorage.removeItem('demo-test')
    expect(loadInitialRecords('demo-test', [stock])).toEqual([])
    localStorage.setItem('already-empty', '[]')
    expect(loadInitialRecords('already-empty', [stock])).toEqual([])
    vi.stubEnv('VITE_DEMO_MODE', 'false')
    expect(loadInitialRecords('demo-test', [stock])).toEqual([])
  })
})

describe('Phase 1 disbursement validation', () => {
  const movement = { sourceItemId: stock.id, sourceWarehouseId: 'main', item: stock.name, qout: 2, destWarehouseId: 'fci' }
  beforeEach(() => localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify([stock])))
  it.each([
    { ...movement, sourceItemId: 'missing' },
    { ...movement, sourceWarehouseId: 'engineering' },
    { ...movement, qout: 6 },
    { ...movement, qout: 0 },
    { ...movement, qout: -1 },
    { ...movement, qout: Number.NaN },
    { ...movement, qout: Infinity },
  ])('rejects an invalid source or quantity without changing saved stock: %j', (invalid) => {
    const before = localStorage.getItem(CUSTODY_STORAGE_KEY)
    expect(() => syncOutwardMovementToCustody(invalid)).toThrow()
    expect(localStorage.getItem(CUSTODY_STORAGE_KEY)).toBe(before)
  })
  it('reserves stock across imported disbursements before any writes, without mutating input', () => {
    const items = [stock]
    expect(() => resolveDisbursementSources(items, [movement, { ...movement, qout: 4 }])).toThrow()
    expect(stock.quantity).toBe(5)
    expect(resolveDisbursementSources(items, [movement, movement])).toHaveLength(2)
  })
  it('never creates destination stock when no source exists', () => {
    localStorage.setItem(CUSTODY_STORAGE_KEY, '[]')
    expect(() => syncOutwardMovementToCustody(movement)).toThrow()
    expect(loadCustodyItems()).toEqual([])
  })
  it('uses the selected ID when source items share a name and remains idempotent on real second application', () => {
    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify([stock, { ...stock, id: 'source-b', quantity: 3, value: 300 }]))
    const request = { ...movement, sourceItemId: 'source-b', custodyApplied: false }
    syncOutwardMovementToCustody(request)
    const once = localStorage.getItem(CUSTODY_STORAGE_KEY)
    expect(loadCustodyItems().find((i) => i.id === stock.id)?.quantity).toBe(5)
    expect(loadCustodyItems().find((i) => i.id === 'source-b')?.quantity).toBe(1)
    expect(request.custodyApplied).toBe(true)
    syncOutwardMovementToCustody(request)
    expect(localStorage.getItem(CUSTODY_STORAGE_KEY)).toBe(once)
  })
  it('accepts legacy names only when they identify one existing source', () => {
    const { sourceItemId: _id, ...legacy } = movement
    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify([stock, { ...stock, id: 'other' }]))
    expect(() => syncOutwardMovementToCustody(legacy)).toThrow()
    localStorage.setItem(CUSTODY_STORAGE_KEY, JSON.stringify([stock]))
    expect(syncOutwardMovementToCustody(legacy).deductedFromSource).toBe(true)
  })
})

describe('Phase 1 storage and dates', () => {
  it('keeps theme writes in memory when storage access is denied', () => {
    const storage = createSafeStorage(() => { throw new Error('denied') })
    expect(storage.getItem('theme')).toBeNull()
    expect(() => storage.setItem('theme', 'dark')).not.toThrow()
    expect(storage.getItem('theme')).toBe('dark')
  })
  it('keeps a newer in-memory value when persistent writes fail', () => {
    const storage = createSafeStorage(() => ({ getItem: () => 'light', setItem: () => { throw new Error('quota') } }))
    storage.setItem('theme', 'dark')
    expect(storage.getItem('theme')).toBe('dark')
  })
  it.each([
    ['2026-11-02T22:30:00Z', '2026-11-03'],
    ['2026-07-02T21:30:00Z', '2026-07-03'],
    ['2026-11-03T20:00:00Z', '2026-11-03'],
  ])('formats Cairo calendar date, including daylight saving: %s', (input, expected) => {
    expect(localDate(input)).toBe(expected)
  })
  it('does not turn invalid dates into today', () => expect(localDate('invalid')).toBe(''))
})
