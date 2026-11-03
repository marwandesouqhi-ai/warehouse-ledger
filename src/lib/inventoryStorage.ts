import type { CustodyItem } from './custody'
import type { FixtureMovement } from './fixture'
import type { InventorySnapshot } from './inventoryTypes'

export const inventoryStorageKey = 'warehouse-ledger-inventory-v2'
export function readInventorySnapshot(): InventorySnapshot | null {
  const raw = localStorage.getItem(inventoryStorageKey)
  if (raw === null) return null
  const value = JSON.parse(raw) as InventorySnapshot
  if (value.schemaVersion !== 2 || !Array.isArray(value.items) || !Array.isArray(value.movements) || !Array.isArray(value.appliedOperations)) throw new Error('تعذر قراءة سجل المخزون الموحد. حُفظت البيانات الأصلية دون تغيير.')
  return value
}
function readArray<T>(key: string): T[] {
  const raw = localStorage.getItem(key)
  if (raw === null) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value)) throw new Error('السجل المحلي غير مقروء؛ لم تتم الكتابة فوقه.')
  return value as T[]
}
export function readInventoryState(): InventorySnapshot {
  return readInventorySnapshot() || { schemaVersion: 2, revision: 0, items: readArray<CustodyItem>('warehouse-ledger-custody-items'), movements: readArray<FixtureMovement>('warehouse-ledger-movements'), appliedOperations: [] }
}
export function writeInventoryState(state: InventorySnapshot, expectedRevision?: number): void {
  const current = readInventoryState()
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('تغير المخزون في نافذة أخرى. أعد تحميل البيانات قبل المحاولة.')
  // One atomic storage write holds both ledger and inventory. Legacy stores remain intact.
  localStorage.setItem(inventoryStorageKey, JSON.stringify(state))
  window.dispatchEvent(new Event('inventory-changed'))
  window.dispatchEvent(new Event('custody-changed'))
  window.dispatchEvent(new Event('movements-changed'))
}
export function cacheCloudInventory(items: CustodyItem[], movements?: FixtureMovement[]): void {
  const state = readInventoryState()
  // A delayed read must not change the revision underneath an in-flight mutation/replay.
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key?.startsWith('warehouse-ledger-pending-operation:') && !state.appliedOperations.includes(key.slice('warehouse-ledger-pending-operation:'.length))) return
  }
  const mergedItems = new Map(state.items.map((item) => [item.id, item]))
  for (const item of items) {
    const local = mergedItems.get(item.id)
    if (!local || (item.version ?? 0) >= (local.version ?? 0)) mergedItems.set(item.id, { ...local, ...item, acquisitionDate: item.acquisitionDate || local?.acquisitionDate || '' })
  }
  const mergedMovements = new Map(state.movements.map((movement) => [String(movement.id), movement]))
  for (const movement of movements || []) {
    const local = mergedMovements.get(String(movement.id))
    if (!local || (movement.version ?? 0) >= (local.version ?? 0)) mergedMovements.set(String(movement.id), { ...local, ...movement })
  }
  writeInventoryState({ ...state, revision: state.revision + 1, items: [...mergedItems.values()], movements: [...mergedMovements.values()] }, state.revision)
}
