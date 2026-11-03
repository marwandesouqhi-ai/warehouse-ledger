import { executeInventoryOperation } from './inventoryRepository'
import { supabase } from './supabase'
import type { FixtureMovement } from './fixture'
import { readInventoryState } from './inventoryStorage'

type MovementRow = {
    id: string
    received_on: string
    invoice_number: string
    supplier: string
    recipient: string
    permit: string
    issued_on: string
    item: string
    unit_price: string
    qty_in: string
    qty_out: string
    notes: string
    request_fingerprint?: string
    version?: number
    deleted_at?: string
    source_quantity_before?: number
    source_value_before?: number
    source_item_id?: string
    inventory_effects?: FixtureMovement["inventoryEffects"]
    custody_applied?: boolean
    created_by?: string
    source_warehouse_id?: string
    dest_warehouse_id?: string
    dest_type?: 'warehouse' | 'custodian'
    custodian_name?: string
}

function fromRow(row: MovementRow): FixtureMovement {
    return {
        id: row.id,
        date: row.received_on,
        inv: row.invoice_number,
        from: row.supplier,
        to: row.recipient,
        permit: row.permit,
        issue: row.issued_on,
        item: row.item,
        price: row.unit_price,
        qin: row.qty_in,
        qout: row.qty_out,
        notes: row.notes,
        custodyApplied: row.custody_applied,
        requestFingerprint: row.request_fingerprint || undefined, version: row.version ?? 0, deletedAt: row.deleted_at || undefined, sourceItemId: row.source_item_id || undefined, sourceQuantityBefore: row.source_quantity_before == null ? undefined : Number(row.source_quantity_before), sourceValueBefore: row.source_value_before == null ? undefined : Number(row.source_value_before), inventoryEffects: row.inventory_effects || undefined,
        createdBy: row.created_by,
        sourceWarehouseId: row.source_warehouse_id,
        destWarehouseId: row.dest_warehouse_id,
        destType: row.dest_type,
        custodianName: row.custodian_name,
    }
}

function getClient() {
    if (!supabase) throw new Error('إعداد اتصال Supabase غير موجود.')
    return supabase
}

export async function fetchMovements(_ownerId?: string): Promise<FixtureMovement[]> {
    const { data, error } = await getClient()
        .from('movements')
        .select('*')
        .order('created_at', { ascending: true })

    if (error) throw error
    return (data as MovementRow[]).map(fromRow)
}

export async function saveMovements(movements: FixtureMovement[], _ownerId?: string): Promise<FixtureMovement[]> {
    const result: FixtureMovement[] = []
    for (const movement of movements) {
        const existing = readInventoryState().movements.find((entry) => String(entry.id) === String(movement.id))
        if (existing) { result.push({ ...existing }); continue }
        const row = { ...movement, id: /^[0-9a-f-]{36}$/i.test(String(movement.id)) ? movement.id : crypto.randomUUID() }
        const state = await executeInventoryOperation({ kind: Number(row.qin) > 0 ? 'purchase' : 'disbursement', movement: row })
        result.push(state.movements.find((entry) => String(entry.id) === String(row.id))!)
    }
    return result
}

export async function updateMovement(movement: FixtureMovement, _ownerId?: string): Promise<FixtureMovement> {
    const result = await executeInventoryOperation({ kind: 'edit', movementId: movement.id, movement })
    return result.movements.find((entry) => String(entry.id) === String(movement.id))!
}
export async function deleteMovement(movementId: string | number, _ownerId?: string): Promise<void> {
    await executeInventoryOperation({ kind: 'delete', movementId })
}
