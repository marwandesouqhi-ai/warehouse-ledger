export type RawMovement = {
    id?: number | string
    date?: string | number | null
    inv?: string | number | null
    from?: string | null
    to?: string | null
    permit?: string | number | null
    issue?: string | number | null
    item?: string | null
    price?: string | number | null
    qin?: string | number | null
    qout?: string | number | null
    notes?: string | null
}

const ARABIC_DIGITS: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
}

export function normalizeName(value: unknown): string {
    if (value == null) return ''
    return String(value)
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\u0640/g, '')
        .toLowerCase()
}

export function partyKey(value: unknown): string {
    return normalizeName(value)
        .replace(/\u0640/g, '')
        .replace(/\u064B|\u064D|\u064E|\u064F|\u0650|\u0651|\u0652/g, '')
        .replace(/\s*\(.*?\)\s*/g, ' ')
        .replace(/\s+و\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

export function normalizeHeader(value: unknown): string {
    const source = String(value ?? '').trim().toLowerCase()
    return source
        .normalize('NFD')
        .replace(/[\u064B-\u065F]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

export function toArabicDigits(value: string): string {
    return Array.from(value).map((char) => ARABIC_DIGITS[char] ?? char).join('')
}

export function num(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }

    if (typeof value !== 'string') {
        return null
    }

    const trimmed = toArabicDigits(value.trim()).replace(/\s+/g, '')
    if (!trimmed || trimmed === '-') return null

    const sanitized = trimmed.replace(/[^0-9,.-]/g, '')
    if (!sanitized || sanitized === '.' || sanitized === ',') return null

    const hasComma = sanitized.includes(',')
    const hasDot = sanitized.includes('.')

    let normalized = sanitized
    if (hasComma && hasDot) {
        const lastComma = sanitized.lastIndexOf(',')
        const lastDot = sanitized.lastIndexOf('.')
        const decimalIndex = Math.max(lastComma, lastDot)
        const separator = sanitized[decimalIndex]
        const integerPart = sanitized.slice(0, decimalIndex).replace(/[.,]/g, '')
        const decimalPart = sanitized.slice(decimalIndex + 1).replace(/[.,]/g, '')
        normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart
        if (separator === ',') {
            normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart
        }
    } else if (hasComma) {
        const thousandsMatch = /^\d{1,3}(,\d{3})+$/.test(sanitized)
        if (thousandsMatch) {
            normalized = sanitized.replace(/,/g, '')
        } else {
            normalized = sanitized.replace(',', '.')
        }
    } else if (hasDot) {
        normalized = sanitized
    }

    if (!/^[-+]?\d*\.?\d+$/.test(normalized)) {
        return null
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
}

export function parseDate(value: unknown): Date | null {
    if (value == null) return null
    const raw = String(value).trim()
    if (!raw) return null

    const digits = toArabicDigits(raw)
    const patterns = [
        /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
        /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/,
        /^\d{1,2}[./-]\d{1,2}[./-]\d{2}$/,
    ]

    let iso = ''
    if (patterns[0].test(digits)) {
        const [y, m, d] = digits.split(/[/-]/).map(Number)
        iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    } else if (patterns[1].test(digits)) {
        const parts = digits.split(/[./-]/).map(Number)
        if (parts.length === 3) {
            const [d, m, y] = parts
            iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        }
    } else if (patterns[2].test(digits)) {
        const parts = digits.split(/[./-]/).map(Number)
        if (parts.length === 3) {
            const [d, m, y] = parts
            iso = `20${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        }
    }

    if (!iso) return null

    const date = new Date(`${iso}T00:00:00Z`)
    const [year, month, day] = iso.split('-').map(Number)
    if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
    ) {
        return null
    }

    return date
}

export function formatDateForDisplay(date: Date | null | undefined): string {
    if (!date) return ''
    const year = date.getFullYear()
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${year}/${month}/${day}`
}
