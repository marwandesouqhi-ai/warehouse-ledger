import React, { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'

export interface AccessibleDialogProps {
  isOpen: boolean
  onClose: () => void
  titleId?: string
  ariaLabel?: string
  role?: 'dialog' | 'alertdialog'
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeOnEscape?: boolean
  closeOnBackdropClick?: boolean
  backdropClassName?: string
  dialogClassName?: string
  dialogStyle?: React.CSSProperties
  animate?: boolean
  children: React.ReactNode
  id?: string
}

/**
 * Accessible Dialog primitive compliant with WAI-ARIA modal dialog practices:
 * - role="dialog" or "alertdialog"
 * - aria-modal="true"
 * - aria-labelledby or aria-label
 * - Focus trap (Tab / Shift+Tab cycling)
 * - Initial focus on first interactive element or initialFocusRef
 * - Focus restoration to original trigger on close
 * - Escape key dismissal
 * - Inert background semantics (aria-hidden on outside tree)
 * - Motion and prefers-reduced-motion support
 */
export function AccessibleDialog({
  isOpen,
  onClose,
  titleId,
  ariaLabel,
  role = 'dialog',
  initialFocusRef,
  closeOnEscape = true,
  closeOnBackdropClick = true,
  backdropClassName = 'modal-backdrop',
  dialogClassName = 'modal-dialog',
  dialogStyle,
  animate = true,
  children,
  id,
}: AccessibleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const shouldReduceMotion = useReducedMotion()

  // 1. Initial focus, focus restoration, and inert outside elements
  useEffect(() => {
    if (!isOpen) return

    previousActiveElement.current = (document.activeElement as HTMLElement) || null

    // Mark background siblings as aria-hidden while open
    const rootSiblings: HTMLElement[] = []
    const hostElement = backdropRef.current || dialogRef.current
    if (hostElement && hostElement.parentElement) {
      Array.from(hostElement.parentElement.children).forEach((child) => {
        if (child !== hostElement && !child.contains(hostElement)) {
          if (!child.hasAttribute('aria-hidden')) {
            child.setAttribute('aria-hidden', 'true')
            rootSiblings.push(child as HTMLElement)
          }
        }
      })
    }

    // Set initial focus
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
      } else if (dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length > 0) {
          focusable[0].focus()
        } else {
          dialogRef.current.focus()
        }
      }
    }, 25)

    return () => {
      clearTimeout(timer)
      rootSiblings.forEach((child) => {
        child.removeAttribute('aria-hidden')
      })
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus()
      }
    }
  }, [isOpen, initialFocusRef])

  // 2. Keyboard events: Escape dismissal and Tab focus trapping
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && closeOnEscape) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement)

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const firstElement = focusables[0]
        const lastElement = focusables[focusables.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === firstElement || document.activeElement === dialogRef.current) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, closeOnEscape, onClose])

  if (!isOpen) return null

  if (animate) {
    return (
      <motion.div
        ref={backdropRef}
        className={backdropClassName}
        onClick={(e) => {
          if (closeOnBackdropClick && e.target === e.currentTarget) {
            onClose()
          }
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
      >
        <motion.div
          id={id}
          ref={dialogRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-label={ariaLabel}
          tabIndex={-1}
          className={dialogClassName}
          style={dialogStyle}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.97 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
        >
          {children}
        </motion.div>
      </motion.div>
    )
  }

  return (
    <div
      ref={backdropRef}
      className={backdropClassName}
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        id={id}
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={dialogClassName}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
export default AccessibleDialog
