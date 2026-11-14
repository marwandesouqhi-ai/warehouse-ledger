import { normalizeHeader } from './parse'
import type { FixtureMovement } from './fixture'
import { sanitizeSpreadsheetCell } from './security'

export type CoreMovementField =
    | 'date'
    | 'inv'
    | 'from'
    | 'to'
    | 'permit'
    | 'issue'
    | 'item'
    | 'price'
    | 'qin'
    | 'qout'
    | 'notes'

const columnAliases: Record<CoreMovementField, string[]> = {
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

type MovementField = CoreMovementField

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

export type RowValidationError = {
    rowNumber: number
    itemName?: string
    reason: string
    rawData?: Record<string, unknown>
}

export type MovementImportValidationResult = {
    validMovements: FixtureMovement[]
    rejectedRows: RowValidationError[]
    totalRows: number
}

export const MAX_IMPORT_ROWS = 5000
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function validateAndClassifyMovementRows(
    rows: Array<Record<string, unknown>>,
    idBase = Date.now()
): MovementImportValidationResult {
    const validMovements: FixtureMovement[] = []
    const rejectedRows: RowValidationError[] = []

    rows.forEach((row, index) => {
        const rowNumber = index + 2 // 1-indexed, header is row 1
        // If entirely blank row, skip
        const values = Object.values(row).map(v => text(v)).filter(Boolean)
        if (values.length === 0) return

        const item = text(getCell(row, 'item'))
        if (!item) {
            rejectedRows.push({
                rowNumber,
                reason: 'اسم الصنف فارغ أو غير محدد',
                rawData: row,
            })
            return
        }

        const qin = Number(getCell(row, 'qin')) || 0
        const qout = Number(getCell(row, 'qout')) || 0
        if (qin <= 0 && qout <= 0) {
            rejectedRows.push({
                rowNumber,
                itemName: item,
                reason: 'يجب تحديد كمية وارد أو كمية منصرف أكبر من صفر',
                rawData: row,
            })
            return
        }

        validMovements.push({
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
        })
    })

    return {
        validMovements,
        rejectedRows,
        totalRows: rows.length,
    }
}

export function generateMovementErrorReportCsv(rejectedRows: RowValidationError[]): string {
    const header = '\uFEFFرقم الصف في الملف,اسم الصنف,سبب الرفض'
    const lines = rejectedRows.map(
        (r) =>
            `${r.rowNumber},"${sanitizeSpreadsheetCell(r.itemName || '—').replace(/"/g, '""')}","${sanitizeSpreadsheetCell(r.reason).replace(/"/g, '""')}"`
    )
    return [header, ...lines].join('\r\n')
}

/**
 * Requirement #13: Asynchronous chunked parser with progress for large datasets.
 * Prevents main thread jank and yields control between chunks.
 */
export async function validateAndClassifyMovementRowsAsync(
    rows: Array<Record<string, unknown>>,
    onProgress?: (progress: { processed: number; total: number; percent: number }) => void,
    idBase = Date.now(),
    chunkSize = 250
): Promise<MovementImportValidationResult> {
    const total = rows.length
    if (total === 0) {
        return { validMovements: [], rejectedRows: [], totalRows: 0 }
    }

    const validMovements: FixtureMovement[] = []
    const rejectedRows: RowValidationError[] = []

    for (let i = 0; i < total; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize)
        const subResult = validateAndClassifyMovementRows(chunk, idBase + i)

        // Adjust row numbers to match global position
        subResult.rejectedRows.forEach((rej) => {
            rej.rowNumber = rej.rowNumber + i
        })

        validMovements.push(...subResult.validMovements)
        rejectedRows.push(...subResult.rejectedRows)

        if (onProgress) {
            const processed = Math.min(i + chunkSize, total)
            onProgress({ processed, total, percent: Math.round((processed / total) * 100) })
        }

        if (i + chunkSize < total) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
    }

    return {
        validMovements,
        rejectedRows,
        totalRows: total,
    }
}