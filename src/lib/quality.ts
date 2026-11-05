import { num, parseDate } from './parse'

export type QualityFinding = {
    id: string
    level: 'warn' | 'error' | 'info'
    rule: string
    message: string
}

export function evaluateQuality(
    row: Record<string, unknown>,
    currentDate = new Date(),
    availableStock?: number
): QualityFinding[] {
    const findings: QualityFinding[] = []
    const receivedOn = parseDate(row.date)
    const issuedOn = parseDate(row.issue)
    const qtyIn = num(row.qin)
    const qtyOut = num(row.qout)
    const unitPrice = num(row.price)

    if (receivedOn && receivedOn > currentDate) {
        findings.push({ id: `${row.id ?? 'row'}-future`, level: 'warn', rule: 'future', message: 'Received date is in the future.' })
    }

    if (issuedOn && receivedOn && issuedOn < receivedOn) {
        findings.push({ id: `${row.id ?? 'row'}-order`, level: 'warn', rule: 'order', message: 'Issue date is earlier than receipt date.' })
    }

    if (issuedOn && !(qtyOut != null && qtyOut > 0) && (qtyOut == null || qtyOut === 0)) {
        findings.push({ id: `${row.id ?? 'row'}-noqty`, level: 'warn', rule: 'noqty', message: 'Issue date exists but quantity out is missing or zero.' })
    }

    if ((qtyOut ?? 0) > 0 && (!row.to || !row.permit)) {
        findings.push({ id: `${row.id ?? 'row'}-noto`, level: 'warn', rule: 'noto', message: 'Issue quantity exists without a recipient or permit.' })
    }

    if (qtyOut != null && qtyOut > 0) {
        if (availableStock !== undefined) {
            // Ledger context: check if disbursement exceeds available stock
            if (qtyOut > availableStock) {
                findings.push({ id: `${row.id ?? 'row'}-over`, level: 'error', rule: 'over', message: 'Issued quantity exceeds available warehouse stock.' })
            }
        } else if (qtyIn != null && qtyIn > 0 && qtyOut > qtyIn) {
            // Single-row context where both in and out are on same row
            findings.push({ id: `${row.id ?? 'row'}-over`, level: 'error', rule: 'over', message: 'Issued quantity exceeds received quantity.' })
        }
    }

    if (row.date && !receivedOn) {
        findings.push({ id: `${row.id ?? 'row'}-baddate`, level: 'error', rule: 'baddate', message: 'Receipt date could not be parsed.' })
    }

    if (row.issue && !issuedOn) {
        findings.push({ id: `${row.id ?? 'row'}-baddate-issued`, level: 'error', rule: 'baddate', message: 'Issue date could not be parsed.' })
    }

    if ((row.price != null && row.price !== '') && unitPrice == null) {
        findings.push({ id: `${row.id ?? 'row'}-nonum`, level: 'error', rule: 'nonum', message: 'Price or quantity is not numeric.' })
    }

    if ((row.qin != null && row.qin !== '') && qtyIn == null) {
        findings.push({ id: `${row.id ?? 'row'}-nonum`, level: 'error', rule: 'nonum', message: 'Price or quantity is not numeric.' })
    }

    if ((row.qout != null && row.qout !== '') && qtyOut == null) {
        findings.push({ id: `${row.id ?? 'row'}-nonum`, level: 'error', rule: 'nonum', message: 'Price or quantity is not numeric.' })
    }

    if (typeof row.price === 'string' && row.price.trim() !== '' && unitPrice != null) {
        findings.push({ id: `${row.id ?? 'row'}-ptext`, level: 'info', rule: 'ptext', message: 'Price was stored as text and converted.' })
    }

    if (!row.inv || String(row.inv).trim() === '') {
        findings.push({ id: `${row.id ?? 'row'}-noinv`, level: 'info', rule: 'noinv', message: 'No invoice number was provided.' })
    }

    return findings
}

export function evaluateLedgerQuality(
    rows: Array<Record<string, unknown>>,
    currentDate = new Date()
): Array<{ row: Record<string, unknown>; findings: QualityFinding[] }> {
    const itemStock = new Map<string, number>()

    return rows.map((row) => {
        const item = String(row.item ?? '').trim().toLowerCase()
        const qin = num(row.qin) ?? 0
        const qout = num(row.qout) ?? 0

        const prevStock = itemStock.get(item) ?? 0
        const availableStock = prevStock + qin

        const findings = evaluateQuality(row, currentDate, availableStock)

        itemStock.set(item, availableStock - qout)
        return { row, findings }
    })
}

export function summarizeQuality(rows: Array<Record<string, unknown>>, currentDate = new Date()): Record<string, number> {
    const counts: Record<string, number> = {
        future: 0,
        order: 0,
        noqty: 0,
        noto: 0,
        over: 0,
        baddate: 0,
        nonum: 0,
        ptext: 0,
        noinv: 0,
    }

    const ledgerResults = evaluateLedgerQuality(rows, currentDate)
    for (const { findings } of ledgerResults) {
        for (const finding of findings) {
            if (finding.rule in counts) {
                counts[finding.rule] += 1
            }
        }
    }

    return counts
}
