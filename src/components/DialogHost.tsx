import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

import {
  CONFIRM_EVENT,
  TOAST_EVENT,
  setDialogHostReady,
  type ConfirmDetail,
  type ToastDetail,
  type ToastTone,
} from '../lib/dialogs'

const TOAST_ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

/** Renders the toasts and the confirmation modal used by `notify` and `confirmDialog`. Mount once at the app root. */
export default function DialogHost() {
  const [toasts, setToasts] = useState<ToastDetail[]>([])
  const [pending, setPending] = useState<ConfirmDetail | null>(null)
  const queue = useRef<ConfirmDetail[]>([])
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  useEffect(() => {
    setDialogHostReady(true)

    const onToast = (event: Event) => {
      const toast = (event as CustomEvent<ToastDetail>).detail
      setToasts((current) => [...current.slice(-3), toast])
      window.setTimeout(() => dismissToast(toast.id), toast.tone === 'error' ? 8000 : 5000)
    }
    const onConfirm = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmDetail>).detail
      setPending((current) => {
        if (current) {
          queue.current.push(detail)
          return current
        }
        return detail
      })
    }

    window.addEventListener(TOAST_EVENT, onToast)
    window.addEventListener(CONFIRM_EVENT, onConfirm)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      window.removeEventListener(CONFIRM_EVENT, onConfirm)
      setDialogHostReady(false)
    }
  }, [dismissToast])

  const settle = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value)
      return queue.current.shift() ?? null
    })
  }, [])

  useEffect(() => {
    if (!pending) return
    // Destructive actions start on "cancel" so a stray Enter never deletes anything.
    ;(pending.options.danger ? cancelRef : confirmRef).current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        settle(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [pending, settle])

  return (
    <>
      <div className="znu-toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = TOAST_ICONS[toast.tone]
          return (
            <div key={toast.id} className={`znu-toast ${toast.tone}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{toast.message}</span>
              <button type="button" className="znu-toast-close" onClick={() => dismissToast(toast.id)} aria-label="إغلاق الإشعار">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>

      {pending && (
        <div className="modal-backdrop" style={{ zIndex: 1300 }} onClick={() => settle(false)}>
          <div
            className="modal-dialog modal-dialog-confirm modal-dialog-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="znu-confirm-title"
            aria-describedby="znu-confirm-message"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div>
                  <h3 id="znu-confirm-title" className="m-0">{pending.options.title || 'تأكيد الإجراء'}</h3>
                </div>
              </div>
            </div>
            <div className="modal-confirm-body">
              <p id="znu-confirm-message" style={{ margin: 0 }}>{pending.message}</p>
            </div>
            <div className="modal-confirm-actions">
              <button ref={cancelRef} type="button" className="secondary-btn" onClick={() => settle(false)}>
                {pending.options.cancelLabel || 'إلغاء'}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="primary-btn"
                style={pending.options.danger ? { background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' } : undefined}
                onClick={() => settle(true)}
              >
                {pending.options.confirmLabel || 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
