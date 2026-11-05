import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { formatCurrency, resolveCurrencySymbol } from '../../src/lib/currency'
import { getRouteMetadata } from '../../src/lib/routeMetadata'
import { safePrint } from '../../src/lib/printUtils'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { PageLoadingFallback } from '../../src/components/PageLoadingFallback'
import { validateAndClassifyMovementRowsAsync } from '../../src/lib/importRows'

describe('Phase 5: Structure, Performance & Delivery Suite (#7, #10, #11, #13, #14, #15, #16, #40, #41, #42, #9)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  describe('Centralized Currency Formatter (#15)', () => {
    it('formats EGP currency with consistent Arabic symbol and two decimal places by default', () => {
      const formatted = formatCurrency(1250.5, 'EGP')
      expect(formatted).toBe('1,250.50 ج.م')
    })

    it('formats custom currency symbols correctly (USD, EUR, SAR)', () => {
      expect(formatCurrency(500, 'USD')).toBe('500.00 $')
      expect(formatCurrency(350.25, 'EUR')).toBe('350.25 €')
      expect(formatCurrency(1000, 'SAR')).toBe('1,000.00 ر.س')
    })

    it('supports precision override and hiding symbol', () => {
      expect(formatCurrency(1234.567, 'EGP', { precision: 0 })).toBe('1,235 ج.م')
      expect(formatCurrency(1234.5, 'EGP', { showSymbol: false })).toBe('1,234.50')
    })

    it('handles zero, null, undefined and invalid numbers safely without crashing', () => {
      expect(formatCurrency(0, 'EGP')).toBe('0.00 ج.م')
      expect(formatCurrency(null, 'EGP')).toBe('0.00 ج.م')
      expect(formatCurrency(undefined, 'EGP')).toBe('0.00 ج.م')
      expect(formatCurrency(NaN, 'EGP')).toBe('0.00 ج.م')
    })

    it('resolves currency symbols properly', () => {
      expect(resolveCurrencySymbol('egp')).toBe('ج.م')
      expect(resolveCurrencySymbol('USD')).toBe('$')
      expect(resolveCurrencySymbol('KWD')).toBe('KWD')
    })
  })

  describe('Route Metadata & Breadcrumbs Derivation (#16)', () => {
    it('derives correct metadata for root dashboard', () => {
      const meta = getRouteMetadata('/')
      expect(meta.title).toBe('لوحة التحكم والمؤشرات')
      expect(meta.breadcrumbs).toHaveLength(1)
      expect(meta.breadcrumbs[0].label).toBe('الرئيسية')
    })

    it('derives hierarchical metadata and breadcrumb trail for subroutes', () => {
      const suppliersMeta = getRouteMetadata('/purchases/suppliers')
      expect(suppliersMeta.title).toBe('إدارة الموردين والشركات')
      expect(suppliersMeta.breadcrumbs).toHaveLength(3)
      expect(suppliersMeta.breadcrumbs[0].label).toBe('الرئيسية')
      expect(suppliersMeta.breadcrumbs[1].label).toBe('المشتريات والتوريدات')
      expect(suppliersMeta.breadcrumbs[1].to).toBe('/purchases')
      expect(suppliersMeta.breadcrumbs[2].label).toBe('الموردين')
    })

    it('provides clean fallback for unknown routes', () => {
      const unknownMeta = getRouteMetadata('/some/deep/unknown/path')
      expect(unknownMeta.title).toBe('إدارة المخازن')
      expect(unknownMeta.breadcrumbs[1].label).toBe('صفحة غير معروفة')
    })
  })

  describe('Safe Printing with Bounded Asset Waiting (#42)', () => {
    it('waits for layout commitment and calls window.print()', async () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

      await safePrint({ bodyClass: 'test-print-mode' })

      expect(printSpy).toHaveBeenCalledTimes(1)
      expect(document.body.classList.contains('test-print-mode')).toBe(true)

      // Emulate print dialog finish (afterprint)
      window.dispatchEvent(new Event('afterprint'))
      expect(document.body.classList.contains('test-print-mode')).toBe(false)
    })

    it('respects bounded timeout without hanging if font readiness promise never resolves', async () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

      // Mock a hanging fonts.ready
      const hangingFonts = {
        ready: new Promise(() => {}), // never resolves
      }
      Object.defineProperty(document, 'fonts', {
        value: hangingFonts,
        configurable: true,
      })

      // Run safePrint with a 50ms bounded timeout
      await safePrint({ timeoutMs: 50 })
      expect(printSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Chunked Async Import with Progress (#13)', () => {
    it('processes rows in chunks and invokes progress callbacks', async () => {
      const mockRows = Array.from({ length: 50 }, (_, i) => ({
        'الصنف': `صنف تجريبي ${i + 1}`,
        'الوارد': 10,
        'السعر': 100,
        'المورد': 'شركة النصر',
      }))

      const progressSnapshots: number[] = []
      const result = await validateAndClassifyMovementRowsAsync(
        mockRows,
        ({ percent }) => {
          progressSnapshots.push(percent)
        },
        1000,
        15 // chunk size 15
      )

      expect(result.validMovements).toHaveLength(50)
      expect(result.rejectedRows).toHaveLength(0)
      expect(progressSnapshots.length).toBeGreaterThan(1)
      expect(progressSnapshots[progressSnapshots.length - 1]).toBe(100)
    })
  })

  describe('Loading and Error Boundaries (#10)', () => {
    it('PageLoadingFallback renders accessible loading spinner and text', () => {
      render(<PageLoadingFallback />)
      expect(screen.getByText('جارٍ تحميل محتوى الصفحة...')).toBeDefined()
    })

    it('ErrorBoundary catches child errors and renders recovery UI', () => {
      function BuggyComponent(): never {
        throw new Error('Test boundary crash')
      }

      // Suppress console.error in test output for deliberate boundary test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      render(
        <ErrorBoundary>
          <BuggyComponent />
        </ErrorBoundary>
      )

      expect(screen.getByText('تعذر تحميل جزء من الصفحة')).toBeDefined()
      expect(screen.getByText('Test boundary crash')).toBeDefined()
      expect(screen.getByText('إعادة تحميل الواجهة')).toBeDefined()

      consoleErrorSpy.mockRestore()
    })

    it('ErrorBoundary allows manual retry via reset button', () => {
      const handleReset = vi.fn()
      function ProblemChild(): never {
        throw new Error('Crash')
      }

      vi.spyOn(console, 'error').mockImplementation(() => {})

      render(
        <ErrorBoundary onReset={handleReset}>
          <ProblemChild />
        </ErrorBoundary>
      )

      const retryBtn = screen.getByText('إعادة تحميل الواجهة')
      fireEvent.click(retryBtn)
      expect(handleReset).toHaveBeenCalledTimes(1)
    })
  })
})

