/**
 * Centralized currency formatter for the Warehouse Ledger application.
 * Fulfills Issue #15: One currency formatter with consistent precision across screens.
 */

export type SupportedCurrency = 'EGP' | 'USD' | 'EUR' | 'SAR' | 'AED' | string

export interface FormatCurrencyOptions {
  /**
   * Number of decimal places. Defaults to 2 for nonzero amounts with decimals, or 0 for clean integers.
   * If strictly specified, forces exact decimal places.
   */
  precision?: number
  /**
   * Whether to include the currency symbol/code. Defaults to true.
   */
  showSymbol?: boolean
  /**
   * Custom fallback for NaN or undefined values. Defaults to '0.00'.
   */
  fallback?: string
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EGP: 'ج.م',
  'ج.م': 'ج.م',
  'ج.م.': 'ج.م',
  USD: '$',
  EUR: '€',
  SAR: 'ر.س',
  AED: 'د.إ',
}

/**
 * Formats a monetary number consistently with Arabic locale digits and standard Egyptian Pound / foreign currencies.
 *
 * @param value The monetary value to format
 * @param currency The currency code (defaults to 'EGP' / 'ج.م')
 * @param options Precision and formatting options
 * @returns Formatted currency string (e.g. "1,250.00 ج.م")
 */
export function formatCurrency(
  value: number | string | null | undefined,
  currency: string = 'EGP',
  options: FormatCurrencyOptions = {}
): string {
  const numericVal = typeof value === 'number' ? value : Number(value)

  if (value === null || value === undefined || isNaN(numericVal)) {
    return options.fallback ?? `0.00 ${resolveCurrencySymbol(currency)}`
  }

  const { precision, showSymbol = true } = options

  // Determine decimal fraction digits:
  // If precision is explicitly set, use it. Otherwise, default to 2 decimal places.
  const fractionDigits = precision !== undefined ? precision : 2

  const formattedNumber = numericVal.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })

  if (!showSymbol) {
    return formattedNumber
  }

  const symbol = resolveCurrencySymbol(currency)
  return `${formattedNumber} ${symbol}`
}

/**
 * Resolves currency code to friendly Arabic symbol or standard symbol.
 */
export function resolveCurrencySymbol(currency: string = 'EGP'): string {
  const upper = currency.trim().toUpperCase()
  return CURRENCY_SYMBOLS[upper] || CURRENCY_SYMBOLS[currency.trim()] || currency.trim() || 'ج.م'
}

