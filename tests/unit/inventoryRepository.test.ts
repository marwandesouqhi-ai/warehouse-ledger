import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeInventoryOperation, persistInventoryPlan, retryInventoryOperation } from '../../src/lib/inventoryRepository'
import { cacheCloudInventory, readInventoryState, inventoryStorageKey, writeInventoryState } from '../../src/lib/inventoryStorage'
import { planInventoryOperation } from '../../src/lib/inventoryOperations'
import { saveCustodyItems } from '../../src/lib/custody'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
const row = () => ({ id: crypto.randomUUID(), date: '2026-11-03', inv: 'INV1', from: 'مورد', to: '', permit: '', issue: '', item: 'حاسوب', price: 10, qin: 10, qout: 0, notes: '' })
beforeEach(() => { localStorage.clear(); mocks.rpc.mockReset().mockResolvedValue({ data: { success: true }, error: null }) })

describe('Phase 2 operation repository', () => {
  it('commits ledger and stock together, leaving legacy bytes intact, with changed-record CAS payloads', async () => {
    const original = '[]'
    localStorage.setItem('warehouse-ledger-movements', original)
    localStorage.setItem('warehouse-ledger-custody-items', original)
    const state = await executeInventoryOperation({ kind: 'purchase', movement: row() })
    expect(state.movements).toHaveLength(1)
    expect(state.items[0].quantity).toBe(10)
    expect(JSON.parse(localStorage.getItem(inventoryStorageKey)!).movements).toHaveLength(1)
    expect(localStorage.getItem('warehouse-ledger-movements')).toBe(original)
    expect(localStorage.getItem('warehouse-ledger-custody-items')).toBe(original)
    expect(mocks.rpc).toHaveBeenCalledWith('apply_inventory_operation', expect.objectContaining({ p_items: [expect.objectContaining({ expectedVersion: null })] }))
  })
  it('keeps stock and ledger unchanged on RPC failure and retries the exact operation after an ambiguous result', async () => {
    const command = { kind: 'purchase' as const, movement: row() }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    await expect(executeInventoryOperation(command)).rejects.toThrow(/timeout/)
    expect(readInventoryState().items).toEqual([])
    expect(readInventoryState().movements).toEqual([])
    const firstPayload = mocks.rpc.mock.calls[0][1]
    await executeInventoryOperation({ ...command, movement: { ...command.movement, id: crypto.randomUUID() } })
    expect(mocks.rpc.mock.calls[1][1]).toEqual(firstPayload)
    expect(readInventoryState().items[0].quantity).toBe(10)
    await retryInventoryOperation(firstPayload.p_operation_id)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
  it('serializes concurrent operations and increments expected versions', async () => {
    await Promise.all([executeInventoryOperation({ kind: 'purchase', movement: row() }), executeInventoryOperation({ kind: 'purchase', movement: { ...row(), inv: 'INV2' } })])
    expect(readInventoryState().items[0].quantity).toBe(20)
    expect(mocks.rpc.mock.calls[1][1].p_items[0].expectedVersion).toBe(1)
  })
  it('does not let a delayed cloud refresh change an in-flight operation revision', async () => {
    mocks.rpc.mockImplementationOnce(async () => {
      cacheCloudInventory([])
      return { data: { success: true }, error: null }
    })
    await executeInventoryOperation({ kind: 'purchase', movement: row() })
    expect(readInventoryState().items[0].quantity).toBe(10)
  })
  it('does not overwrite a newer cross-tab snapshot after waiting for cloud', async () => {
    mocks.rpc.mockImplementationOnce(async () => {
      const current = readInventoryState()
      writeInventoryState({ ...current, revision: current.revision + 1, appliedOperations: ['other-tab'] })
      return { data: { success: true }, error: null }
    })
    await expect(executeInventoryOperation({ kind: 'purchase', movement: row() })).rejects.toThrow(/نافذة أخرى/)
    expect(readInventoryState().appliedOperations).toEqual(['other-tab'])
    expect(readInventoryState().movements).toEqual([])
  })
  it('loading cloud data and local persistence issue no cloud writes', () => {
    const plan = planInventoryOperation(readInventoryState(), { kind: 'purchase', movement: row() })
    cacheCloudInventory(plan.next.items, plan.next.movements)
    saveCustodyItems(plan.next.items)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not mutate supplied item objects even when cloud quantity changes', async () => {
    const plan = planInventoryOperation(readInventoryState(), { kind: 'purchase', movement: row() })
    const before = JSON.stringify(plan)
    await persistInventoryPlan(plan)
    expect(JSON.stringify(plan)).toBe(before)
  })
})
