import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/auditLogger', () => ({
  logAuditEvent: vi.fn(async () => undefined),
}))

describe('dialogs: notify / confirmDialog', () => {
  afterEach(async () => {
    const { setDialogHostReady } = await import('../../src/lib/dialogs')
    setDialogHostReady(false)
    vi.restoreAllMocks()
  })

  it('falls back to the native dialogs when no host is mounted', async () => {
    const { notify, confirmDialog } = await import('../../src/lib/dialogs')
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    notify('رسالة')
    expect(alertSpy).toHaveBeenCalledWith('رسالة')
    await expect(confirmDialog('متأكد؟')).resolves.toBe(true)
    expect(confirmSpy).toHaveBeenCalledWith('متأكد؟')
  })

  it('dispatches toast and confirm events when the host is mounted and resolves from the decision', async () => {
    const { notify, confirmDialog, setDialogHostReady, TOAST_EVENT, CONFIRM_EVENT } = await import('../../src/lib/dialogs')
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    setDialogHostReady(true)

    const toasts: Array<{ message: string; tone: string }> = []
    const onToast = (event: Event) => toasts.push((event as CustomEvent).detail)
    window.addEventListener(TOAST_EVENT, onToast)
    notify('حدث خطأ أثناء الحفظ')
    notify('يرجى تعبئة الحقول')
    notify('تم', 'success')
    window.removeEventListener(TOAST_EVENT, onToast)

    expect(alertSpy).not.toHaveBeenCalled()
    expect(toasts.map((t) => t.tone)).toEqual(['error', 'warning', 'success'])

    const onConfirm = (event: Event) => (event as CustomEvent).detail.resolve(false)
    window.addEventListener(CONFIRM_EVENT, onConfirm)
    await expect(confirmDialog('حذف؟', { danger: true })).resolves.toBe(false)
    window.removeEventListener(CONFIRM_EVENT, onConfirm)
  })
})

describe('clientErrorReporter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('logs unexpected errors once, ignores harmless ones and rate-limits bursts', async () => {
    const { logAuditEvent } = await import('../../src/lib/auditLogger')
    const { reportClientError } = await import('../../src/lib/clientErrorReporter')
    const logSpy = vi.mocked(logAuditEvent)
    logSpy.mockClear()

    reportClientError(new Error('boom-1'), { source: 'test' })
    reportClientError(new Error('boom-1'), { source: 'test' }) // duplicate within the dedupe window
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toMatchObject({ event_type: 'client_error', severity: 'warning' })

    reportClientError(new Error('ResizeObserver loop completed with undelivered notifications'), { source: 'test' })
    reportClientError("NotAllowedError: Failed to execute 'writeText' on 'Clipboard'", { source: 'test' })
    expect(logSpy).toHaveBeenCalledTimes(1)

    for (let i = 2; i <= 10; i++) reportClientError(new Error(`boom-${i}`), { source: 'test' })
    expect(logSpy.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('never reports critical severity (would trigger instant Telegram alerts)', async () => {
    const { logAuditEvent } = await import('../../src/lib/auditLogger')
    const { reportClientError } = await import('../../src/lib/clientErrorReporter')
    const logSpy = vi.mocked(logAuditEvent)
    logSpy.mockClear()
    reportClientError(new Error('another failure'), { source: 'test' })
    expect(logSpy.mock.calls.every(([entry]) => entry.severity !== 'critical')).toBe(true)
  })
})

describe('accessScopedFetch: expired session signal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits znu-session-invalid on a 401 from the data API, but not for audit/log endpoints', async () => {
    vi.resetModules()
    const { accessScopedFetch, prepareAccessContext } = await import('../../src/lib/accessContext')
    prepareAccessContext({ user: { id: 'u-401', app_metadata: { role: 'system_admin' } } } as never)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 401 }))
    const signals: number[] = []
    const onInvalid = () => signals.push(1)
    window.addEventListener('znu-session-invalid', onInvalid)

    await accessScopedFetch('https://example.supabase.co/rest/v1/audit_logs?select=*')
    expect(signals.length).toBe(0)

    await accessScopedFetch('https://example.supabase.co/rest/v1/movements?select=*')
    expect(signals.length).toBe(1)

    // cooldown: a burst of 401s produces a single signal
    await accessScopedFetch('https://example.supabase.co/rest/v1/custody_items?select=*')
    expect(signals.length).toBe(1)

    window.removeEventListener('znu-session-invalid', onInvalid)
  })
})
