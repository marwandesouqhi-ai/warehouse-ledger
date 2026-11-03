import { describe, expect, it } from 'vitest'
import { planInventoryOperation } from '../../src/lib/inventoryOperations'
import type { InventorySnapshot } from '../../src/lib/inventoryTypes'
import type { FixtureMovement } from '../../src/lib/fixture'

export const emptyInventory = (): InventorySnapshot => ({ schemaVersion: 2, revision: 0, items: [], movements: [], appliedOperations: [] })
export const purchase = (overrides: Partial<FixtureMovement> = {}): FixtureMovement => ({ id: crypto.randomUUID(), date: '2026-11-03', inv: 'INV1', from: 'مورد', to: '', permit: '', issue: '', item: 'حاسوب', price: 10, qin: 10, qout: 0, notes: '', ...overrides })
const total = (state: InventorySnapshot) => [state.items.reduce((sum, item) => sum + item.quantity, 0), state.items.reduce((sum, item) => sum + item.value, 0)]

describe('Phase 2 inventory planner', () => {
  it('conserves total quantity and exact value on partial and full transfers without mutating input', () => {
    let state = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: purchase({ qin: 3, price: 0.333333 }) }).next
    const before = JSON.stringify(state)
    const source = state.items[0]
    const plan = planInventoryOperation(state, { kind: 'transfer', sourceItemId: source.id, targetWarehouseId: 'fci', quantity: 1 })
    expect(JSON.stringify(state)).toBe(before)
    expect(total(plan.next)[0]).toBe(3)
    expect(total(plan.next)[1]).toBeCloseTo(0.999999, 6)
    expect(plan.next.items.find((item) => item.id === source.id)?.value).toBe(0.666666)
    state = planInventoryOperation(plan.next, { kind: 'transfer', sourceItemId: source.id, targetWarehouseId: 'fci', quantity: 2, permit: 'second' }).next
    expect(total(state)[0]).toBe(3)
    expect(total(state)[1]).toBeCloseTo(0.999999, 6)
    expect(state.items.find((item) => item.id === source.id)).toMatchObject({ quantity: 0, value: 0 })
  })
  it('preserves pre-existing sub-micro book values and fractional stock without rounding them away', () => {
    const original = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: purchase({ qin: 3, price: 0.1000001 }) }).next
    expect(total(original)[1]).toBe(0.3000003)
    const partial = planInventoryOperation(original, { kind: 'transfer', sourceItemId: original.items[0].id, targetWarehouseId: 'fci', quantity: 1 }).next
    expect(total(partial)[1]).toBe(0.3000003)
    const full = planInventoryOperation(partial, { kind: 'transfer', sourceItemId: original.items[0].id, targetWarehouseId: 'fci', quantity: 2, permit: 'remaining' }).next
    expect(total(full)[1]).toBe(0.3000003)
    const fractional = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: purchase({ qin: 0.3, price: 10 }) }).next
    const moved = planInventoryOperation(fractional, { kind: 'transfer', sourceItemId: fractional.items[0].id, targetWarehouseId: 'fci', quantity: 0.1 }).next
    expect(moved.items[0].quantity).toBe(0.2)
  })
  it('applies only the net purchase edit after part of the stock was transferred', () => {
    const row = purchase()
    const first = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: row }).next
    const moved = planInventoryOperation(first, { kind: 'transfer', sourceItemId: first.items[0].id, targetWarehouseId: 'fci', quantity: 3 }).next
    const edited = planInventoryOperation(moved, { kind: 'edit', movementId: row.id, movement: { ...moved.movements[0], qin: 12 } }).next
    expect(edited.items.find((item) => item.warehouseId === 'main')?.quantity).toBe(9)
    expect(total(edited)).toEqual([12, 120])
    expect(edited.movements).toHaveLength(2)
    const cancelled = planInventoryOperation(edited, { kind: 'delete', movementId: moved.movements[1].id }).next
    expect(total(cancelled)).toEqual([12, 120])
    expect(cancelled.items.find((item) => item.warehouseId === 'main')?.quantity).toBe(12)
    expect(cancelled.movements[1].deletedAt).toBeTruthy()
    expect(cancelled.movements[1].inventoryEffects).toEqual(moved.movements[1].inventoryEffects)
  })
  it('adjusts a transfer by its net difference and reuses its destination lot', () => {
    const first = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: purchase() }).next
    const moved = planInventoryOperation(first, { kind: 'transfer', sourceItemId: first.items[0].id, targetWarehouseId: 'fci', quantity: 3 }).next
    const row = moved.movements[1]
    const next = planInventoryOperation(moved, { kind: 'edit', movementId: row.id, movement: { ...row, qout: 4 } }).next
    expect(next.items).toHaveLength(2)
    expect(next.items.find((item) => item.warehouseId === 'main')?.quantity).toBe(6)
    expect(next.items.find((item) => item.warehouseId === 'fci')?.quantity).toBe(4)
    expect(total(next)).toEqual([10, 100])
  })
  it('rejects unsafe reversal and legacy reversal without changing the original state', () => {
    const row = purchase()
    const first = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: row }).next
    const moved = planInventoryOperation(first, { kind: 'transfer', sourceItemId: first.items[0].id, targetWarehouseId: 'fci', quantity: 3 }).next
    const before = JSON.stringify(moved)
    expect(() => planInventoryOperation(moved, { kind: 'delete', movementId: row.id })).toThrow(/لم تتغير/)
    expect(JSON.stringify(moved)).toBe(before)
    const legacy = { ...first, movements: [{ ...row, inventoryEffects: undefined }] }
    expect(() => planInventoryOperation(legacy, { kind: 'delete', movementId: row.id })).toThrow(/حركة قديمة/)
  })
  it('is idempotent on actual second application and rejects duplicate purchase fingerprints', () => {
    const row = purchase(), operationId = crypto.randomUUID()
    const first = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: row }, operationId).next
    const second = planInventoryOperation(first, { kind: 'purchase', movement: row }, operationId)
    expect(second.next).toBe(first)
    expect(second.itemChanges).toEqual([])
    expect(() => planInventoryOperation(first, { kind: 'purchase', movement: { ...row, id: crypto.randomUUID() } })).toThrow(/مسجلة بالفعل/)
    const withSecond = planInventoryOperation(first, { kind: 'purchase', movement: purchase({ inv: 'INV2', qin: 1 }) }).next
    expect(() => planInventoryOperation(withSecond, { kind: 'edit', movementId: withSecond.movements[1].id, movement: { ...withSecond.movements[1], inv: row.inv, qin: row.qin } })).toThrow(/حركة أخرى/)

  })
  it('retains explicit acquisition dates, structured previous images, and historical notes', () => {
    const first = planInventoryOperation(emptyInventory(), { kind: 'purchase', movement: purchase({ date: '2020-02-03' }) }).next
    const item = first.items[0]
    const next = planInventoryOperation(first, { kind: 'item_save', item: { ...item, notes: 'ملاحظات أصلية', condition: 'maintenance' }, note: 'فحص موثق' }).next
    expect(next.items[0].acquisitionDate).toBe('2020-02-03')
    expect(next.items[0].history?.at(-1)?.description).toBe('فحص موثق')
    expect(next.items[0].history?.at(-1)?.beforeItems?.[0].condition).toBe('good')
  })
})
