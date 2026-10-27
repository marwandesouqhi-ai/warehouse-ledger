import { normalizeName, num, parseDate } from './parse'

export type DerivedMovement = {
    id: number | string | undefined
    item: string
    supplier?: string
    recipient?: string
    permit?: string
    received_on: Date | null
    issued_on: Date | null
    item_key: string
    unit_price: number | null
    qty_in: number | null
    qty_out: number | null
    total: number | null
    balance: number
    rem: number
    status: 'pending' | 'part' | 'full' | 'over'
    issued_value: number | null
    remaining_value: number
}

export type MovementSummary = {
    rows: number
    distinct_items: number
    total_value: number
    qty_in: number
    qty_out: number
    issued_value: number
    remaining_value: number
    pending_rows: number
    status_counts: Record<string, number>
}

export function deriveMovement(raw: Record<string, unknown>, index: number): DerivedMovement {
    const item = String(raw.item ?? '')
    const itemKey = normalizeName(item)
    const supplier = raw.from ? String(raw.from) : undefined
    const recipient = raw.to ? String(raw.to) : undefined
    const permit = raw.permit != null ? String(raw.permit) : undefined

    const unitPrice = num(raw.price)
    const qtyIn = num(raw.qin)
    const qtyOut = num(raw.qout)
    const receivedOn = parseDate(raw.date)
    const issuedOn = parseDate(raw.issue)

    const total = unitPrice != null && qtyIn != null ? unitPrice * qtyIn : null
    const rem = (qtyIn ?? 0) - (qtyOut ?? 0)
    let status: DerivedMovement['status'] = 'pending'
    if (qtyOut != null && qtyOut > (qtyIn ?? 0)) status = 'over'
    else if (rem <= 0) status = 'full'
    else if (qtyOut != null && qtyOut > 0) status = 'part'

    const issuedValue = unitPrice != null && qtyOut != null ? unitPrice * qtyOut : null
    const remainingValue = unitPrice != null ? unitPrice * Math.max(rem, 0) : 0

    return {
        id: typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : index,
        item,
        supplier,
        recipient,
        permit,
        received_on: receivedOn,
        issued_on: issuedOn,
        item_key: itemKey,
        unit_price: unitPrice,
        qty_in: qtyIn,
        qty_out: qtyOut,
        total,
        balance: 0,
        rem,
        status,
        issued_value: issuedValue,
        remaining_value: remainingValue,
    }
}

export function deriveSummary(rows: Array<Record<string, unknown>>): MovementSummary {
    const derived = rows.map((row, index) => deriveMovement(row, index))
    const itemOrder = new Map<string, number>()

    for (const movement of derived) {
        const key = movement.item_key
        itemOrder.set(key, (itemOrder.get(key) ?? 0) + 1)
    }

    const itemBalances = new Map<string, number>()
    const withBalance = derived.map((movement) => {
        const currentKey = movement.item_key
        const currentBalance = (itemBalances.get(currentKey) ?? 0) + ((movement.qty_in ?? 0) - (movement.qty_out ?? 0))
        itemBalances.set(currentKey, currentBalance)
        return { ...movement, balance: currentBalance }
    })

    const total_value = withBalance.reduce((sum, row) => sum + (row.total ?? 0), 0)
    const qty_in = withBalance.reduce((sum, row) => sum + (row.qty_in ?? 0), 0)
    const qty_out = withBalance.reduce((sum, row) => sum + (row.qty_out ?? 0), 0)
    const issued_value = withBalance.reduce((sum, row) => sum + (row.issued_value ?? 0), 0)
    const remaining_value = withBalance.reduce((sum, row) => sum + row.remaining_value, 0)
    const status_counts = withBalance.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1
        return acc
    }, {})

    const pending_rows = withBalance.filter((row) => row.status === 'pending').length

    return {
        rows: withBalance.length,
        distinct_items: new Set(withBalance.map((row) => row.item_key)).size,
        total_value: Number(total_value.toFixed(3)),
        qty_in: Number(qty_in.toFixed(3)),
        qty_out: Number(qty_out.toFixed(3)),
        issued_value: Number(issued_value.toFixed(3)),
        remaining_value: Number(remaining_value.toFixed(3)),
        pending_rows,
        status_counts,
    }
}
