import type { CustodyItem } from './custody'
import type { InventoryEffect } from './inventoryTypes'
import { normalizeName, num, parseDate } from './parse'
import { findWarehouseByRecipient } from './custody'

export type DerivedMovement = {
  id: number | string | undefined; item: string; supplier?: string; recipient?: string; permit?: string
  received_on: Date | null; issued_on: Date | null; item_key: string; unit_price: number | null
  qty_in: number | null; qty_out: number | null; total: number | null; balance: number; rem: number
  status: 'pending' | 'part' | 'full' | 'over'; issued_value: number | null; remaining_value: number; available_before: number
}
export type MovementSummary = {
  rows: number; distinct_items: number; total_value: number; qty_in: number; qty_out: number
  issued_value: number; remaining_value: number; pending_rows: number; status_counts: Record<string, number>; stock_units: number
}
const round = (value: number) => Number(value.toFixed(6))
function base(raw: Record<string, unknown>, index: number): DerivedMovement {
  const unitPrice = num(raw.price), incoming = num(raw.qin), outgoing = num(raw.qout)
  return { id: typeof raw.id === 'string' || typeof raw.id === 'number' ? raw.id : index, item: String(raw.item || ''),
    supplier: raw.from ? String(raw.from) : undefined, recipient: raw.to ? String(raw.to) : undefined, permit: raw.permit ? String(raw.permit) : undefined,
    received_on: parseDate(raw.date), issued_on: parseDate(raw.issue), item_key: normalizeName(raw.item), unit_price: unitPrice,
    qty_in: incoming, qty_out: outgoing, total: unitPrice != null && incoming != null ? unitPrice * incoming : null,
    balance: 0, rem: incoming || 0, status: 'pending', issued_value: 0, remaining_value: 0, available_before: 0 }
}
/** Running weighted valuation and receipt allocation, partitioned by item and warehouse. */
export function deriveLedger(input: Array<Record<string, unknown>>) {
  const source = input.filter((row) => !row.deletedAt)
  const rows = source.map(base)
  const balances = new Map<string, { quantity: number; value: number; receipts: { row: DerivedMovement; remaining: number }[] }>()
  const account = (warehouse: string, item: string) => {
    const key = `${warehouse}\u001f${item}`
    if (!balances.has(key)) balances.set(key, { quantity: 0, value: 0, receipts: [] })
    return balances.get(key)!
  }
  const order = source.map((raw, index) => ({ raw, row: rows[index], index }))
    .sort((a, b) => ((a.row.received_on || a.row.issued_on)?.getTime() || 0) - ((b.row.received_on || b.row.issued_on)?.getTime() || 0) || a.index - b.index)
  for (const { raw, row } of order) {
    const incoming = Math.max(0, row.qty_in || 0), outgoing = Math.max(0, row.qty_out || 0)
    const stock = account(String(raw.sourceWarehouseId || 'main'), row.item_key)
    if (incoming > 0) {
      stock.quantity += incoming; stock.value += row.total || 0
      stock.receipts.push({ row, remaining: incoming })
    }
    const recordedAvailable = num(raw.sourceQuantityBefore)
    if (outgoing > 0 && stock.quantity === 0 && stock.receipts.length === 0 && recordedAvailable != null) {
      stock.quantity = recordedAvailable
      stock.value = num(raw.sourceValueBefore) || 0
    }
    row.available_before = recordedAvailable ?? round(stock.quantity)
    if (outgoing > 0) {
      const valid = outgoing <= row.available_before
      const cost = stock.quantity > 0 ? stock.value / stock.quantity : row.unit_price || 0
      const recordedEffect = Array.isArray(raw.inventoryEffects) ? (raw.inventoryEffects as InventoryEffect[]).find((effect) => effect.itemId === raw.sourceItemId && effect.quantity < 0) : undefined
      row.issued_value = recordedEffect ? -recordedEffect.value : round(cost * outgoing)
      stock.quantity = round(stock.quantity - outgoing)
      stock.value = round(stock.value - (row.issued_value || 0))
      let remaining = outgoing
      for (const receipt of stock.receipts) {
        const used = Math.min(receipt.remaining, remaining)
        receipt.remaining = round(receipt.remaining - used); remaining = round(remaining - used)
        receipt.row.rem = receipt.remaining
        if (remaining <= 0) break
      }
      row.status = valid ? 'full' : 'over'
      const target = raw.destType === 'custodian' ? `custodian:${String(raw.custodianName || raw.to)}` : String(raw.destWarehouseId || findWarehouseByRecipient(String(raw.to || ''))?.id || '')
      if (target && target !== String(raw.sourceWarehouseId || 'main')) {
        const destination = account(target, row.item_key)
        destination.quantity = round(destination.quantity + outgoing)
        destination.value = round(destination.value + (row.issued_value || 0))
      }
    }
    row.balance = round(stock.quantity)
  }
  for (const stock of balances.values()) {
    for (const receipt of stock.receipts) {
      receipt.row.remaining_value = stock.quantity > 0 ? round(receipt.remaining * stock.value / stock.quantity) : 0
      if (receipt.row.status !== 'over') receipt.row.status = receipt.remaining <= 0 ? 'full' : receipt.remaining < (receipt.row.qty_in || 0) ? 'part' : 'pending'
    }
  }
  return { rows, balances }
}
export function deriveMovement(raw: Record<string, unknown>, index: number, ledger?: Array<Record<string, unknown>>): DerivedMovement {
  if (ledger) return deriveLedger(ledger).rows.find((row) => String(row.id) === String(raw.id)) || deriveLedger([raw]).rows[0]
  return { ...deriveLedger([raw]).rows[0], id: typeof raw.id === 'string' || typeof raw.id === 'number' ? raw.id : index }
}
export function deriveSummary(input: Array<Record<string, unknown>>, currentItems?: CustodyItem[]): MovementSummary {
  const { rows, balances } = deriveLedger(input)
  const sum = (select: (row: DerivedMovement) => number) => Number(rows.reduce((total, row) => total + select(row), 0).toFixed(3))
  const status_counts: Record<string, number> = {}
  for (const row of rows) status_counts[row.status] = (status_counts[row.status] || 0) + 1
  return { rows: rows.length, distinct_items: new Set(rows.map((row) => row.item_key)).size,
    total_value: sum((row) => row.total || 0), qty_in: sum((row) => row.qty_in || 0), qty_out: sum((row) => row.qty_out || 0),
    issued_value: sum((row) => row.issued_value || 0), remaining_value: Number((currentItems ? currentItems.filter((item) => !item.deletedAt).reduce((total, item) => total + Number(item.value), 0) : [...balances.values()].reduce((total, entry) => total + entry.value, 0)).toFixed(3)),
    stock_units: Number((currentItems ? currentItems.filter((item) => !item.deletedAt).reduce((total, item) => total + Number(item.quantity), 0) : [...balances.values()].reduce((total, entry) => total + entry.quantity, 0)).toFixed(3)),
    pending_rows: rows.filter((row) => row.rem > 0).length, status_counts }
}
