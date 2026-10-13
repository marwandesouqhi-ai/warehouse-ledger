import { supabase } from './supabase'
import type { FixtureMovement } from './fixture'
import { movementFingerprint } from './importRows'

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
        createdBy: row.created_by,
        sourceWarehouseId: row.source_warehouse_id,
        destWarehouseId: row.dest_warehouse_id,
        destType: row.dest_type,
        custodianName: row.custodian_name,
    }
}

function toRow(movement: FixtureMovement, ownerId?: string) {
    const isUuid = ownerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)
    const validOwnerId = isUuid ? ownerId : '5b7feb88-f6e9-47e3-a4cf-bb7b614661ca'

    const idStr = String(movement.id ?? '')
    const isIdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr)

    const row: Record<string, unknown> = {
        owner_id: validOwnerId,
        received_on: String(movement.date ?? ''),
        invoice_number: String(movement.inv ?? ''),
        supplier: String(movement.from ?? ''),
        recipient: String(movement.to ?? ''),
        permit: String(movement.permit ?? ''),
        issued_on: String(movement.issue ?? ''),
        item: movement.item,
        unit_price: String(movement.price ?? ''),
        qty_in: String(movement.qin ?? ''),
        qty_out: String(movement.qout ?? ''),
        notes: movement.notes ?? '',
        fingerprint: movementFingerprint(movement),
        ...(movement.custodyApplied !== undefined ? { custody_applied: movement.custodyApplied } : {}),
        ...(movement.createdBy ? { created_by: movement.createdBy } : {}),
        ...(movement.sourceWarehouseId ? { source_warehouse_id: movement.sourceWarehouseId } : {}),
        ...(movement.destWarehouseId ? { dest_warehouse_id: movement.destWarehouseId } : {}),
        ...(movement.destType ? { dest_type: movement.destType } : {}),
        ...(movement.custodianName ? { custodian_name: movement.custodianName } : {}),
    }

    if (isIdUuid) {
        row.id = idStr
    }

    return row
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

export async function saveMovements(movements: FixtureMovement[], ownerId?: string): Promise<FixtureMovement[]> {
    if (movements.length === 0) return []

    const rows = movements.map((movement) => toRow(movement, ownerId))
    const { data, error } = await getClient()
        .from('movements')
        .upsert(rows, {
            onConflict: 'fingerprint',
            ignoreDuplicates: true,
        })
        .select('*')

    if (error) throw error
    return (data as MovementRow[]).map(fromRow)
}

export async function updateMovement(movement: FixtureMovement, _ownerId?: string): Promise<FixtureMovement> {
    if (!supabase) return movement

    const client = getClient()
    const idStr = String(movement.id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr)

    if (isUuid) {
        const { data, error } = await client
            .from('movements')
            .update({
                received_on: String(movement.date ?? ''),
                invoice_number: String(movement.inv ?? ''),
                supplier: String(movement.from ?? ''),
                recipient: String(movement.to ?? ''),
                permit: String(movement.permit ?? ''),
                issued_on: String(movement.issue ?? ''),
                item: movement.item,
                unit_price: String(movement.price ?? ''),
                qty_in: String(movement.qin ?? ''),
                qty_out: String(movement.qout ?? ''),
                notes: movement.notes,
                fingerprint: movementFingerprint(movement),
            })
            .eq('id', movement.id)
            .select('*')
            .single()

        if (error) {
            if (error.code === '23505') {
                throw new Error('توجد حركة أخرى بنفس هذه البيانات بالضبط.')
            }
            throw error
        }
        return fromRow(data as MovementRow)
    }

    return movement
}

export async function deleteMovement(movementId: string | number, _ownerId?: string): Promise<void> {
    if (!supabase) return

    const client = getClient()
    const idStr = String(movementId)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr)

    if (isUuid) {
        const { error } = await client
            .from('movements')
            .delete()
            .eq('id', movementId)

        if (error) throw error
    }
}