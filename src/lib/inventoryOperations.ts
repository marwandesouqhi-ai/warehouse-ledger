import { movementFingerprint } from './importRows'
import type { CustodyItem } from './custody'
import type { FixtureMovement } from './fixture'
import { findWarehouseByRecipient, guessCategory, WAREHOUSES } from './custody'
import { localDate } from './localDate'
import { normalizeName, num } from './parse'
import type { InventoryCommand, InventoryEffect, InventoryPlan, InventorySnapshot } from './inventoryTypes'

const precision = 1_000_000
export const amount = (value: number) => Math.round(value * precision) / precision
// Decimal addition/multiplication preserve existing fractional quantities and book values.
// BigInts are calculation-only; snapshots and RPC payloads retain ordinary JSON numbers.
function decimal(value: number): { coefficient: bigint; scale: number } {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e')
  const fraction = mantissa.split('.')[1]?.length || 0
  let coefficient = BigInt(mantissa.replace('.', ''))
  let scale = fraction - Number(exponent)
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0 }
  return { coefficient, scale }
}
function add(a: number, b: number): number {
  const left = decimal(a), right = decimal(b), scale = Math.max(left.scale, right.scale)
  return Number(`${left.coefficient * 10n ** BigInt(scale - left.scale) + right.coefficient * 10n ** BigInt(scale - right.scale)}e-${scale}`)
}
function multiply(a: number, b: number): number {
  const left = decimal(a), right = decimal(b)
  return Number(`${left.coefficient * right.coefficient}e-${left.scale + right.scale}`)
}
const active = (item: CustodyItem) => !item.deletedAt
const id = () => crypto.randomUUID()
const number = (value: unknown) => {
  const result = num(value)
  if (result === null || result < 0) throw new Error('الكمية والقيمة يجب أن تكون أرقاماً غير سالبة.')
  return result
}

/** Pure planner: never mutates input; only final net effects are validated on edits. */
export function planInventoryOperation(state: InventorySnapshot, command: InventoryCommand, operationId: string = id(), at = new Date().toISOString()): InventoryPlan {
  if (state.appliedOperations.includes(operationId)) {
    return { id: operationId, kind: command.kind, beforeRevision: state.revision, event: { id: operationId, at, kind: command.kind, title: '', description: '', effects: [] }, next: state, itemChanges: [], movementChanges: [] }
  }
  const items = state.items.map((item) => ({ ...item }))
  const movements = state.movements.map((movement) => ({ ...movement }))
  const effects: InventoryEffect[] = []
  const touched = new Set<string>()
  const movementIds = new Set<string>()
  let eventMovementId: string | undefined
  const change = (itemId: string, quantity: number, value: number) => {
    const item = items.find((entry) => entry.id === itemId && active(entry))
    if (!item) throw new Error('الصنف المطلوب غير موجود. حدّث البيانات ثم أعد المحاولة.')
    item.quantity = add(Number(item.quantity), quantity)
    item.value = add(Number(item.value), value)
    effects.push({ itemId, quantity, value })
    touched.add(itemId)
  }
  const applyMovement = (movement: FixtureMovement, previousEffects?: InventoryEffect[]): InventoryEffect[] => {
    const start = effects.length
    const incoming = movement.qin === '' ? 0 : number(movement.qin)
    const outgoing = movement.qout === '' ? 0 : number(movement.qout)
    const price = movement.price === '' ? 0 : number(movement.price)
    if (incoming > 0 && outgoing > 0) throw new Error('سجل الوارد والصرف كحركتين منفصلتين للحفاظ على أثر كل عملية.')
    if (!movement.item.trim() || incoming + outgoing <= 0) throw new Error('حدد صنفاً وكمية حركة أكبر من صفر.')
    if (incoming > 0) {
      const matches = items.filter((item) => active(item) && item.warehouseId === 'main' && item.custodyType !== 'شخصية' && normalizeName(item.name) === normalizeName(movement.item))
      if (matches.length > 1) throw new Error('يوجد أكثر من سجل مطابق للصنف؛ يلزم تحديد السجل قبل التوريد.')
      let item = matches[0]
      if (!item) {
        item = { id: id(), warehouseId: 'main', code: '', name: movement.item.trim(), category: guessCategory(movement.item), custodian: 'أمين المخزن الرئيسي', quantity: 0, unit: 'قطعة', condition: 'good', custodyType: 'مستديمة', roomLocation: '', acquisitionDate: movement.date || localDate(at), value: 0, unitPrice: price }
        items.push(item)
      }
      change(item.id, incoming, multiply(incoming, price))
    }
    if (outgoing > 0) {
      const sourceWarehouseId = movement.sourceWarehouseId || 'main'
      const sources = items.filter((item) => active(item) && item.warehouseId === sourceWarehouseId && (movement.sourceItemId ? item.id === movement.sourceItemId : item.custodyType !== 'شخصية' && normalizeName(item.name) === normalizeName(movement.item)))
      if (sources.length !== 1) throw new Error('اختر صنفاً محدداً موجوداً في المخزن المصدر.')
      const source = sources[0]
      movement.item = source.name
      movement.sourceQuantityBefore = Number(source.quantity)
      movement.sourceValueBefore = Number(source.value)
      if (outgoing > Number(source.quantity) || Number(source.quantity) <= 0) throw new Error('الرصيد المتاح غير كافٍ للصرف.')
      const personal = movement.destType === 'custodian'
      const targetWarehouseId = personal ? sourceWarehouseId : (movement.destWarehouseId || findWarehouseByRecipient(movement.to)?.id)
      if (!targetWarehouseId || !WAREHOUSES.some((warehouse) => warehouse.id === targetWarehouseId)) throw new Error('حدد المخزن المستلم.')
      if (!personal && targetWarehouseId === sourceWarehouseId) throw new Error('لا يمكن الصرف إلى نفس المستودع المصدر.')
      if (personal && !(movement.custodianName || movement.to).trim()) throw new Error('حدد اسم المستلم.')
      const transferredValue = outgoing === Number(source.quantity) ? Number(source.value) : amount(Number(source.value) * outgoing / Number(source.quantity))
      // Each issue gets its own destination lot, preserving source identity and reversal provenance.
      const previousDestinationId = previousEffects?.filter((effect) => effect.quantity > 0).at(-1)?.itemId
      let destination = items.find((item) => item.id === previousDestinationId && item.id !== source.id && item.warehouseId === targetWarehouseId && normalizeName(item.name) === normalizeName(source.name) && (personal ? item.custodyType === 'شخصية' && item.custodian === movement.custodianName : item.custodyType !== 'شخصية'))
      if (!destination) {
        destination = { ...source, id: id(), warehouseId: targetWarehouseId, quantity: 0, value: 0, history: [], version: undefined, deletedAt: undefined,
          custodyType: personal ? 'شخصية' : source.custodyType, custodian: movement.custodianName || '', roomLocation: movement.to || '', notes: '', acquisitionDate: source.acquisitionDate }
        items.push(destination)
      }
      change(source.id, -outgoing, -transferredValue)
      change(destination.id, outgoing, transferredValue)
      movement.sourceItemId = source.id
      movement.destWarehouseId = targetWarehouseId
      movement.price = outgoing > 0 ? transferredValue / outgoing : price
    }
    return effects.slice(start)
  }
  if (command.kind === 'purchase' || command.kind === 'disbursement' || command.kind === 'transfer') {
    const movement: FixtureMovement = command.kind === 'transfer' ? {
      id: id(), date: localDate(at), inv: '', from: '', to: command.targetWarehouseId, permit: command.permit || '', issue: localDate(at),
      item: items.find((item) => item.id === command.sourceItemId)?.name || '', price: 0, qin: 0, qout: command.quantity, notes: command.note || '',
      sourceItemId: command.sourceItemId, sourceWarehouseId: items.find((item) => item.id === command.sourceItemId)?.warehouseId,
      destWarehouseId: command.targetWarehouseId, destType: 'warehouse', custodianName: command.custodian,
    } : { ...command.movement }
    movement.requestFingerprint = movementFingerprint(movement)
    const existing = movements.find((entry) => !entry.deletedAt && (String(entry.id) === String(movement.id) || (entry.requestFingerprint || movementFingerprint(entry)) === movement.requestFingerprint))
    if (existing) throw new Error('الحركة مسجلة بالفعل؛ استخدم رقم عملية جديد لحركة جديدة.')
    movement.inventoryEffects = applyMovement(movement)
    movement.custodyApplied = true
    movements.push(movement)
    movementIds.add(String(movement.id)); eventMovementId = String(movement.id)
    if (command.kind === 'transfer' && command.location) {
      const destination = items.find((item) => item.id === movement.inventoryEffects!.at(-1)?.itemId)
      if (destination) destination.roomLocation = command.location
    }
  } else if (command.kind === 'edit' || command.kind === 'delete') {
    const index = movements.findIndex((entry) => String(entry.id) === String(command.movementId) && !entry.deletedAt)
    if (index < 0) throw new Error('الحركة غير موجودة.')
    const previous = movements[index]
    if (command.kind === 'edit' && (command.movement.version ?? 0) !== (previous.version ?? 0)) throw new Error('تغيرت الحركة أثناء التعديل. حدّث البيانات أولاً.')
    if (command.kind === 'delete' && command.expectedVersion !== undefined && command.expectedVersion !== (previous.version ?? 0)) throw new Error('تغيرت الحركة قبل الإلغاء. راجع البيانات الحالية أولاً.')
    if (!previous.inventoryEffects?.length) throw new Error('هذه حركة قديمة بلا أثر مخزني موثق. يلزم مراجعة الرصيد قبل تعديلها أو إلغائها؛ لم تتغير أي بيانات.')
    for (const effect of previous.inventoryEffects) change(effect.itemId, -effect.quantity, -effect.value)
    if (command.kind === 'delete') {
      movements[index] = { ...previous, deletedAt: at }
    } else {
      const updated = { ...previous, ...command.movement, id: previous.id }
      updated.requestFingerprint = movementFingerprint(updated)
      if (movements.some((entry) => !entry.deletedAt && String(entry.id) !== String(previous.id) && (entry.requestFingerprint || movementFingerprint(entry)) === updated.requestFingerprint)) throw new Error('توجد حركة أخرى بنفس البيانات؛ لم تتغير أي أرصدة.')
      updated.inventoryEffects = applyMovement(updated, previous.inventoryEffects)
      updated.custodyApplied = true
      movements[index] = updated
    }
    movementIds.add(String(previous.id)); eventMovementId = String(previous.id)
  } else if (command.kind === 'item_delete') {
    const item = items.find((entry) => entry.id === command.itemId && active(entry))
    if (!item) throw new Error('الصنف غير موجود.')
    if (command.expectedVersion !== undefined && command.expectedVersion !== (item.version ?? 0)) throw new Error('تغير الصنف قبل الأرشفة. راجع البيانات الحالية أولاً.')
    item.deletedAt = at; touched.add(item.id)
  } else if (command.kind === 'item_save' || command.kind === 'import') {
    const updates = command.kind === 'item_save' ? [command.item] : command.items
    for (const update of updates) {
      const index = items.findIndex((item) => item.id === update.id)
      if (index >= 0 && (update.version ?? 0) !== (items[index].version ?? 0)) throw new Error('تغير السجل أثناء التعديل. حدّث البيانات أولاً.')
      if (index >= 0) items[index] = { ...items[index], ...update, history: items[index].history }
      else items.push({ ...update, history: [] })
      touched.add(update.id)
    }
  }
  const event = { id: operationId, at, kind: command.kind, title: command.kind === 'purchase' ? 'توريد مخزني' : command.kind === 'delete' ? 'إلغاء حركة وتسوية أثرها' : command.kind === 'edit' ? 'تعديل حركة وتسوية الفرق' : command.kind === 'transfer' || command.kind === 'disbursement' ? 'صرف ونقل عهدة' : 'تحديث سجل عهدة',
    description: command.kind === 'item_save' ? command.note || 'تحديث بيانات الصنف' : command.kind === 'transfer' ? `نقل ${command.quantity} وحدة إلى ${command.targetWarehouseId} ${command.permit || ''}` : 'movement' in command ? `${command.movement.item} — ${command.movement.permit || command.movement.inv || ''}` : 'عملية موثقة مع حفظ الأرصدة السابقة',
    beforeItems: state.items.filter((item) => touched.has(item.id)).map(({ history: _history, ...item }) => item),
    beforeMovements: state.movements.filter((movement) => movementIds.has(String(movement.id))), movementId: eventMovementId, effects }
  const itemChanges = [...touched].map((itemId) => {
    const item = items.find((entry) => entry.id === itemId)!
    const previous = state.items.find((entry) => entry.id === itemId)
    if (!Number.isFinite(Number(item.quantity)) || !Number.isFinite(Number(item.value)) || Number(item.quantity) < 0 || Number(item.value) < 0 || (Number(item.quantity) === 0 && Number(item.value) !== 0)) {
      throw new Error('تعذر تسوية الحركة دون رصيد أو قيمة سالبة. قد يكون المخزون قد استُخدم؛ لم تتغير أي بيانات.')
    }
    if (Number(item.quantity) > 0) item.unitPrice = amount(Number(item.value) / Number(item.quantity))
    item.version = (previous?.version ?? 0) + 1
    item.history = [...(previous?.history || []), event]
    return { expectedVersion: previous ? previous.version ?? 0 : null, after: item }
  })
  const movementChanges = [...movementIds].map((movementId) => {
    const movement = movements.find((entry) => String(entry.id) === movementId)!
    const previous = state.movements.find((entry) => String(entry.id) === movementId)
    movement.version = (previous?.version ?? 0) + 1
    return { expectedVersion: previous ? previous.version ?? 0 : null, after: movement }
  })
  return { id: operationId, kind: command.kind, beforeRevision: state.revision, event,
    next: { schemaVersion: 2, revision: state.revision + 1, items, movements, appliedOperations: [...state.appliedOperations, operationId] }, itemChanges, movementChanges }
}
