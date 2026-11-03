import { supabase } from './supabase'
import { planInventoryOperation } from './inventoryOperations'
import { readInventoryState, writeInventoryState } from './inventoryStorage'
import type { InventoryCommand, InventoryPlan } from './inventoryTypes'

let queue: Promise<unknown> = Promise.resolve()
export async function persistInventoryPlan(plan: InventoryPlan): Promise<InventoryPlan> {
  if (!supabase || (!plan.itemChanges.length && !plan.movementChanges.length)) return plan
  const { data, error } = await supabase.rpc('apply_inventory_operation', {
    p_operation_id: plan.id, p_kind: plan.kind, p_items: plan.itemChanges, p_movements: plan.movementChanges, p_event: plan.event,
  })
  if (error) throw new Error(`لم تُحفظ العملية السحابية: ${error.message}. يلزم توفر ترحيل المخزون وتحديث الأرصدة؛ لم يُستخدم الحفظ القديم.`)
  if (!data?.success) throw new Error('لم يؤكد الخادم حفظ عملية المخزون.')
  return plan
}
export function executeInventoryOperation(command: InventoryCommand, operationId?: string) {
  const execute = async () => {
    const state = readInventoryState()
    const request = command.kind === 'purchase' || command.kind === 'disbursement'
      ? { ...command, movement: { ...command.movement, id: undefined, version: undefined, custodyApplied: undefined, inventoryEffects: undefined } } : command
    const signature = JSON.stringify(request)
    const requestKey = `warehouse-ledger-operation-request:${signature}`
    const savedId = localStorage.getItem(requestKey)
    operationId = operationId || (savedId && !state.appliedOperations.includes(savedId) ? savedId : crypto.randomUUID())
    if (state.appliedOperations.includes(operationId)) return state
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith('warehouse-ledger-pending-operation:')) {
        const pendingId = key.slice('warehouse-ledger-pending-operation:'.length)
        if (pendingId !== operationId && !state.appliedOperations.includes(pendingId)) throw new Error(`توجد عملية غير مؤكدة (${pendingId}). يلزم إعادة محاولتها أو مراجعتها قبل إنشاء عملية أخرى.`)
      }
    }
    localStorage.setItem(requestKey, operationId)
    const pendingKey = `warehouse-ledger-pending-operation:${operationId}`
    const pending = localStorage.getItem(pendingKey)
    const plan: InventoryPlan = pending ? JSON.parse(pending) : planInventoryOperation(state, command, operationId)
    if (plan.beforeRevision !== state.revision) throw new Error('تغير الرصيد منذ إعداد العملية. راجع العملية المعلقة قبل إعادة المحاولة.')
    // Durable exact request enables safe replay after an ambiguous network response.
    localStorage.setItem(pendingKey, JSON.stringify(plan))
    await persistInventoryPlan(plan)
    writeInventoryState(plan.next, state.revision)
    // Compact only the redundant pending plan after its full history and receipt are committed.
    try { localStorage.setItem(pendingKey, JSON.stringify({ id: plan.id, committedRevision: plan.next.revision })) } catch { /* the full recovery plan remains */ }
    return plan.next
  }
  const locked = () => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('warehouse-ledger-inventory', execute)
    : Promise.reject(new Error('المتصفح لا يدعم قفل عمليات المخزون بين النوافذ. استخدم متصفحاً حديثاً واتصالاً آمناً؛ لم تتغير أي بيانات.'))
  const result = queue.then(locked)
  queue = result.catch(() => undefined)
  return result
}

export function retryInventoryOperation(operationId: string) {
  return executeInventoryOperation({ kind: 'import', items: [] }, operationId)
}
