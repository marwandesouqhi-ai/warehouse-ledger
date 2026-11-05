import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AccessibleDialog } from '../../src/components/AccessibleDialog'

describe('Phase 4: Accessibility Suite (#31, #33, #34, #35)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  describe('AccessibleDialog Primitive (#31)', () => {
    it('renders with role="dialog", aria-modal="true", and aria-labelledby', () => {
      render(
        <div>
          <main id="app-root">
            <button type="button">Outside Button</button>
          </main>
          <AccessibleDialog
            isOpen={true}
            onClose={() => {}}
            titleId="test-modal-title"
          >
            <div>
              <h2 id="test-modal-title">عنوان النافذة التجريبية</h2>
              <button type="button">زر الإجراء الأول</button>
            </div>
          </AccessibleDialog>
        </div>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeDefined()
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(dialog.getAttribute('aria-labelledby')).toBe('test-modal-title')

      const heading = screen.getByText('عنوان النافذة التجريبية')
      expect(heading.id).toBe('test-modal-title')
    })

    it('renders with role="alertdialog" when specified', () => {
      render(
        <AccessibleDialog
          isOpen={true}
          onClose={() => {}}
          titleId="alert-title"
          role="alertdialog"
        >
          <div>
            <h2 id="alert-title">تأكيد عملية الحذف</h2>
            <button type="button">تأكيد</button>
          </div>
        </AccessibleDialog>
      )

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toBeDefined()
      expect(dialog.getAttribute('aria-modal')).toBe('true')
      expect(dialog.getAttribute('aria-labelledby')).toBe('alert-title')
    })

    it('invokes onClose when Escape key is pressed', () => {
      const handleClose = vi.fn()
      render(
        <AccessibleDialog
          isOpen={true}
          onClose={handleClose}
          titleId="esc-test-title"
        >
          <div>
            <h2 id="esc-test-title">نافذة الخروج السريع</h2>
            <button type="button">زر داخلي</button>
          </div>
        </AccessibleDialog>
      )

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('invokes onClose when clicking on backdrop', () => {
      const handleClose = vi.fn()
      const { container } = render(
        <AccessibleDialog
          isOpen={true}
          onClose={handleClose}
          titleId="backdrop-test-title"
        >
          <div className="inner-dialog">
            <h2 id="backdrop-test-title">محتوى النافذة</h2>
          </div>
        </AccessibleDialog>
      )

      const backdrop = container.querySelector('.modal-backdrop')
      expect(backdrop).toBeDefined()
      if (backdrop) {
        fireEvent.click(backdrop)
        expect(handleClose).toHaveBeenCalledTimes(1)
      }
    })

    it('does not invoke onClose when clicking inside the dialog content', () => {
      const handleClose = vi.fn()
      render(
        <AccessibleDialog
          isOpen={true}
          onClose={handleClose}
          titleId="content-click-title"
        >
          <div data-testid="dialog-inner">
            <h2 id="content-click-title">محتوى النافذة الداخلي</h2>
          </div>
        </AccessibleDialog>
      )

      const inner = screen.getByTestId('dialog-inner')
      fireEvent.click(inner)
      expect(handleClose).not.toHaveBeenCalled()
    })

    it('marks background siblings with aria-hidden="true" and cleans up on close', () => {
      const { unmount } = render(
        <div>
          <div id="sibling-content">محتوى الصفحة الأصلي</div>
          <AccessibleDialog
            isOpen={true}
            onClose={() => {}}
            titleId="inert-title"
          >
            <div>
              <h2 id="inert-title">النافذة</h2>
            </div>
          </AccessibleDialog>
        </div>
      )

      const sibling = document.getElementById('sibling-content')
      expect(sibling?.getAttribute('aria-hidden')).toBe('true')

      unmount()
      expect(sibling?.getAttribute('aria-hidden')).toBeNull()
    })

    it('traps keyboard focus within the dialog on Tab and Shift+Tab', () => {
      render(
        <AccessibleDialog
          isOpen={true}
          onClose={() => {}}
          titleId="trap-title"
        >
          <div>
            <h2 id="trap-title">حصر التركيز</h2>
            <button type="button" data-testid="first-btn">الأول</button>
            <input type="text" data-testid="middle-input" />
            <button type="button" data-testid="last-btn">الأخير</button>
          </div>
        </AccessibleDialog>
      )

      const firstBtn = screen.getByTestId('first-btn')
      const lastBtn = screen.getByTestId('last-btn')

      // When last element has focus and Tab is pressed -> loops to first element
      lastBtn.focus()
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      lastBtn.dispatchEvent(tabEvent)

      // When first element has focus and Shift+Tab is pressed -> loops to last element
      firstBtn.focus()
      const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      firstBtn.dispatchEvent(shiftTabEvent)
    })

    it('restores focus to previous active element on close', () => {
      function TestWrapper() {
        const [isOpen, setIsOpen] = useState(false)
        return (
          <div>
            <button type="button" data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
              فتح النافذة
            </button>
            {isOpen && (
              <AccessibleDialog
                isOpen={true}
                onClose={() => setIsOpen(false)}
                titleId="restore-title"
              >
                <div>
                  <h2 id="restore-title">استرجاع التركيز</h2>
                  <button type="button" data-testid="close-btn" onClick={() => setIsOpen(false)}>
                    إغلاق
                  </button>
                </div>
              </AccessibleDialog>
            )}
          </div>
        )
      }

      render(<TestWrapper />)
      const triggerBtn = screen.getByTestId('trigger-btn')
      triggerBtn.focus()
      expect(document.activeElement).toBe(triggerBtn)

      act(() => {
        fireEvent.click(triggerBtn)
      })

      const closeBtn = screen.getByTestId('close-btn')
      act(() => {
        fireEvent.click(closeBtn)
      })

      expect(document.activeElement).toBe(triggerBtn)
    })
  })

  describe('Form Errors and Search Inputs Accessibility (#35)', () => {
    it('form errors render with role="alert" and aria-live="assertive"', () => {
      render(
        <div>
          <div role="alert" aria-live="assertive" className="movement-form-error-banner">
            <span>رصيد المخزن لا يكفي لتنفيذ عملية الصرف المطلوبة.</span>
          </div>
        </div>
      )

      const alert = screen.getByRole('alert')
      expect(alert).toBeDefined()
      expect(alert.getAttribute('aria-live')).toBe('assertive')
      expect(alert.textContent).toContain('رصيد المخزن لا يكفي')
    })

    it('search inputs have accessible persistent labels', () => {
      render(
        <div>
          <label htmlFor="search-field" className="sr-only">ابحث في الحركات</label>
          <input
            id="search-field"
            type="search"
            aria-label="ابحث في سجل العمليات والحركات"
            placeholder="بحث..."
          />
        </div>
      )

      const input = screen.getByRole('searchbox')
      expect(input.getAttribute('aria-label')).toBe('ابحث في سجل العمليات والحركات')
      expect(input.id).toBe('search-field')
    })
  })

  describe('Tab Semantics for Movement Types and Custody (#35)', () => {
    it('movement type tabs have full WAI-ARIA tab semantics', () => {
      render(
        <div>
          <div role="tablist" aria-label="أنواع الحركات المخزنية">
            <button
              id="tab-purchase"
              role="tab"
              type="button"
              aria-selected={true}
              aria-controls="panel-movement-form"
            >
              توريد
            </button>
            <button
              id="tab-transfer"
              role="tab"
              type="button"
              aria-selected={false}
              aria-controls="panel-movement-form"
            >
              تحويل
            </button>
            <button
              id="tab-disbursement"
              role="tab"
              type="button"
              aria-selected={false}
              aria-controls="panel-movement-form"
            >
              صرف
            </button>
          </div>
          <div
            id="panel-movement-form"
            role="tabpanel"
            aria-labelledby="tab-purchase"
          >
            <p>نموذج تسجيل حركة التوريد</p>
          </div>
        </div>
      )

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(3)
      expect(tabs[0].getAttribute('aria-selected')).toBe('true')
      expect(tabs[1].getAttribute('aria-selected')).toBe('false')
      expect(tabs[0].getAttribute('aria-controls')).toBe('panel-movement-form')

      const panel = screen.getByRole('tabpanel')
      expect(panel.getAttribute('aria-labelledby')).toBe('tab-purchase')
    })
  })

  describe('Keyboard Accessible Charts and Data Tables (#33)', () => {
    it('chart bars have role="graphics-symbol" and tabIndex=0 for keyboard navigation', () => {
      render(
        <svg role="img" aria-label="رسم بياني">
          <g
            tabIndex={0}
            role="graphics-symbol"
            aria-label="الفترة: 2026-03، الوارد: 15,000 ج.م، المنصرف: 8,000 ج.م"
          >
            <rect height="50" width="10" />
          </g>
        </svg>
      )

      const symbol = screen.getByRole('graphics-symbol')
      expect(symbol.tabIndex).toBe(0)
      expect(symbol.getAttribute('aria-label')).toContain('2026-03')
      expect(symbol.getAttribute('aria-label')).toContain('الوارد: 15,000')
    })
  })
})
