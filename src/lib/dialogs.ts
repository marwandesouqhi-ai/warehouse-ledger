// In-app replacements for window.alert / window.confirm.
// `notify` shows a non-blocking toast; `confirmDialog` resolves to true/false from a modal.
// Both fall back to the native dialogs when the <DialogHost /> is not mounted (tests, early boot).

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export type ToastDetail = { id: number; message: string; tone: ToastTone }

export type ConfirmOptions = {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Use for destructive actions: highlights the confirm button in the danger colour. */
  danger?: boolean
}

export type ConfirmDetail = {
  message: string
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export const TOAST_EVENT = 'znu-toast'
export const CONFIRM_EVENT = 'znu-confirm'

let hostReady = false
let toastId = 0

export function setDialogHostReady(value: boolean) {
  hostReady = value
}

function inferTone(message: string): ToastTone {
  if (/خطأ|تعذر|فشل|غير مصرح|مقتصر|محمي|لا يمكن/.test(message)) return 'error'
  if (/يرجى|يجب|حجم الملف|تأكد/.test(message)) return 'warning'
  return 'info'
}

export function notify(message: string, tone?: ToastTone): void {
  if (typeof window === 'undefined') return
  if (!hostReady) {
    window.alert(message)
    return
  }
  const detail: ToastDetail = { id: ++toastId, message, tone: tone ?? inferTone(message) }
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }))
}

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (!hostReady) return Promise.resolve(window.confirm(message))
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmDetail>(CONFIRM_EVENT, { detail: { message, options, resolve } }))
  })
}
