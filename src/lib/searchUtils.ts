/**
 * Universal Arabic & Multilingual Search Utility
 * Normalizes text to handle Arabic orthographic variations (alef variants, teh marbuta,
 * alef maksura, hamzas, tashkeel/diacritics, tatweel) and case insensitivity.
 */

export function normalizeSearchText(text: unknown): string {
    if (text == null) return ''
    return String(text)
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel / harakat
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ـ/g, '') // remove tatweel
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Checks if the given fields match the search query.
 * Matches multi-word queries where all search terms must be present across the fields.
 */
export function matchesSearch(fields: unknown[], query: string): boolean {
    const cleanQuery = normalizeSearchText(query)
    if (!cleanQuery) return true

    const normalizedTargets = fields
        .filter((f) => f != null)
        .map((f) => normalizeSearchText(f))
        .join(' ')

    const queryWords = cleanQuery.split(' ').filter(Boolean)
    return queryWords.every((word) => normalizedTargets.includes(word))
}
