/**
 * Safe printing utility for committed content and assets.
 * Fulfills Issue #42: Printing waits for committed content and assets/fonts with a bounded timeout, no arbitrary delays.
 */

export interface SafePrintOptions {
  /**
   * Optional CSS class to add to document.body during printing and remove on afterprint.
   */
  bodyClass?: string
  /**
   * Maximum wait time (in ms) for fonts/assets to be ready before proceeding to print.
   * Defaults to 1500ms.
   */
  timeoutMs?: number
}

/**
 * Ensures fonts and layout are committed before invoking window.print().
 * Automatically cleans up print helper classes once the print dialog finishes.
 */
export async function safePrint(options: SafePrintOptions = {}): Promise<void> {
  const { bodyClass, timeoutMs = 1500 } = options

  if (bodyClass) {
    document.body.classList.add(bodyClass)
  }

  // 1. Wait for document fonts with bounded timeout
  if (typeof document !== 'undefined' && 'fonts' in document && document.fonts && typeof (document.fonts as any).ready?.then === 'function') {
    try {
      await Promise.race([
        (document.fonts as any).ready,
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ])
    } catch {
      // Non-blocking fallback if font readiness fails
    }
  }

  // 2. Wait for React render commit and paint via double requestAnimationFrame
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    } else {
      setTimeout(resolve, 30)
    }
  })

  // 3. Register cleanup on afterprint
  if (bodyClass && typeof window !== 'undefined') {
    const handleAfterPrint = () => {
      document.body.classList.remove(bodyClass)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
    window.addEventListener('afterprint', handleAfterPrint)
  }

  // 4. Trigger print
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print()
  }
}

