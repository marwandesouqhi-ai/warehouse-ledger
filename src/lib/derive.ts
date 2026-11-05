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

export function deriveMovement(
    raw: Record<string, unknown>,
    index: number,
    ledgerBalance?: number,
    availableStock?: number
): DerivedMovement {
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

    if (qtyOut != null && qtyOut > 0) {
        if (availableStock !== undefined) {
            // Evaluated within cumulative ledger: check against available stock
            if (qtyOut > availableStock) status = 'over'
            else status = 'full'
        } else if (qtyIn != null && qtyIn > 0) {
            // Combined row where receipt and issue are on same row
            if (qtyOut > qtyIn) status = 'over'
            else if (rem <= 0) status = 'full'
            else status = 'part'
        } else {
            // Pure outward movement without ledger context
            if (ledgerBalance !== undefined && ledgerBalance < 0) status = 'over'
            else status = 'full'
        }
    } else if (qtyIn != null && qtyIn > 0) {
        status = 'pending'
    }

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
        balance: ledgerBalance !== undefined ? ledgerBalance : 0,
        rem,
        status,
        issued_value: issuedValue,
        remaining_value: remainingValue,
    }
}

export function deriveSummary(rows: Array<Record<string, unknown>>): MovementSummary {
    const itemStock = new Map<string, number>()
    const itemPrices = new Map<string, number>()

    const withBalance = rows.map((row, index) => {
        const item = String(row.item ?? '')
        const itemKey = normalizeName(item)
        const qin = num(row.qin) ?? 0
        const qout = num(row.qout) ?? 0
        const price = num(row.price)

        if (price != null && qin > 0) {
            itemPrices.set(itemKey, price)
        }

        const prevStock = itemStock.get(itemKey) ?? 0
        const availableStock = prevStock + qin
        const newBalance = availableStock - qout
        itemStock.set(itemKey, newBalance)

        return deriveMovement(row, index, newBalance, availableStock)
    })

    const total_value = withBalance.reduce((sum, row) => sum + (row.total ?? 0), 0)
    const qty_in = withBalance.reduce((sum, row) => sum + (row.qty_in ?? 0), 0)
    const qty_out = withBalance.reduce((sum, row) => sum + (row.qty_out ?? 0), 0)
    const issued_value = withBalance.reduce((sum, row) => {
        if (row.issued_value != null) return sum + row.issued_value
        const knownPrice = itemPrices.get(row.item_key) ?? 0
        return sum + ((row.qty_out ?? 0) * knownPrice)
    }, 0)

    // Strictly conserve total value: remaining value equals total receipt value minus issued value
    const remaining_value = Math.max(0, total_value - issued_value)
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
