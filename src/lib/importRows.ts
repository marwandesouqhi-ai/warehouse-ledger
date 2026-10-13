import { normalizeHeader } from './parse'
import type { FixtureMovement } from './fixture'

const columnAliases: Record<keyof Omit<FixtureMovement, 'id'>, string[]> = {
    date: ['date', 'التاريخ', 'تاريخ الوارد', 'تاريخ'],
    inv: ['inv', 'invoice', 'invoice number', 'رقم الفاتورة', 'الفاتورة'],
    from: ['from', 'supplier', 'vendor', 'المورد', 'وارد من'],
    to: ['to', 'recipient', 'receiver', 'المستلم', 'جهة الصرف'],
    permit: ['permit', 'issue permit', 'رقم الاذن', 'اذن الصرف', 'رقم اذن الصرف'],
    issue: ['issue', 'issue date', 'تاريخ الصرف'],
    item: ['item', 'item name', 'الصنف', 'اسم الصنف', 'بيان الصنف'],
    price: ['price', 'unit price', 'سعر الوحدة', 'السعر'],
    qin: ['qin', 'qty in', 'quantity in', 'كمية الوارد', 'الوارد'],
    qout: ['qout', 'qty out', 'quantity out', 'كمية المنصرف', 'المنصرف'],
    notes: ['notes', 'note', 'ملاحظات', 'ملاحظة'],
}

type MovementField = keyof Omit<FixtureMovement, 'id'>

function getCell(row: Record<string, unknown>, field: MovementField): unknown {
    const aliases = new Set(columnAliases[field].map(normalizeHeader))
    const entry = Object.entries(row).find(([header]) => aliases.has(normalizeHeader(header)))
    return entry?.[1]
}

function text(value: unknown): string {
    if (value == null) return ''
    return String(value).trim()
}

function textOrNumber(value: unknown): string | number {
    return typeof value === 'number' ? value : text(value)
}

export function parseMovementRows(rows: Array<Record<string, unknown>>, idBase = Date.now()): FixtureMovement[] {
    if (rows.length === 0) return []

    const hasItemColumn = Object.keys(rows[0]).some((header) =>
        columnAliases.item.some((alias) => normalizeHeader(alias) === normalizeHeader(header)),
    )
    if (!hasItemColumn) {
        throw new Error('لم أجد عمود الصنف. استخدم عنوانًا مثل «الصنف» أو «اسم الصنف» أو item.')
    }

    return rows.flatMap((row, index) => {
        const item = text(getCell(row, 'item'))
        if (!item) return []

        return [{
            id: idBase + index,
            date: text(getCell(row, 'date')),
            inv: textOrNumber(getCell(row, 'inv')),
            from: text(getCell(row, 'from')),
            to: text(getCell(row, 'to')),
            permit: textOrNumber(getCell(row, 'permit')),
            issue: text(getCell(row, 'issue')),
            item,
            price: textOrNumber(getCell(row, 'price')),
            qin: textOrNumber(getCell(row, 'qin')),
            qout: textOrNumber(getCell(row, 'qout')),
            notes: text(getCell(row, 'notes')),
        }]
    })
}

export function movementFingerprint(movement: FixtureMovement): string {
    return [movement.date, movement.inv, movement.from, movement.to, movement.permit, movement.issue,
        movement.item, movement.price, movement.qin, movement.qout, movement.notes]
        .map((value) => String(value ?? '').trim().toLocaleLowerCase())
        .join('\u001f')
}