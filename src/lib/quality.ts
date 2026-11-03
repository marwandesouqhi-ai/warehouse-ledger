import { deriveLedger } from './derive'
import { num, parseDate } from './parse'

export type QualityFinding = {
    id: string
    level: 'warn' | 'error' | 'info'
    rule: string
    message: string
}

export function evaluateQuality(row: Record<string, unknown>, currentDate = new Date(), availableBefore?: number): QualityFinding[] {
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

    if (qtyOut != null && (availableBefore != null || qtyIn != null) && qtyOut > (availableBefore ?? qtyIn ?? 0)) {
        findings.push({ id: `${row.id ?? 'row'}-over`, level: 'error', rule: 'over', message: 'Issued quantity exceeds received quantity.' })
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

    if ((qtyIn ?? 0) > 0 && (!row.inv || String(row.inv).trim() === '')) {
        findings.push({ id: `${row.id ?? 'row'}-noinv`, level: 'info', rule: 'noinv', message: 'No invoice number was provided.' })
    }

    return findings
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

    const activeRows = rows.filter((row) => !row.deletedAt)
    const ledger = deriveLedger(activeRows).rows
    for (const [index, row] of activeRows.entries()) {
        const findings = evaluateQuality(row, currentDate, ledger[index]?.available_before)
        for (const finding of findings) {
            if (finding.rule in counts) {
                counts[finding.rule] += 1
            }
        }
    }

    return counts
}
