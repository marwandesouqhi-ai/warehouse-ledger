/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Zero-Cost Leaked Password Protection via HaveIBeenPwned (k-Anonymity Model)
 * ════════════════════════════════════════════════════════════════════════════════
 * Implements the exact same security standard as Supabase Pro's Leaked Password Protection
 * completely free of charge using the official, anonymous HaveIBeenPwned Range API.
 *
 * Privacy Guarantee (k-Anonymity):
 * - The password is NEVER sent over the network.
 * - Only the first 5 characters of the SHA-1 hash are transmitted.
 * - Mathematical impossibility for the remote server to know or reconstruct the password.
 */

/**
 * Computes uppercase hex SHA-1 of a UTF-8 string.
 */
export async function sha1Hex(str: string): Promise<string> {
  const buffer = new TextEncoder().encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export interface PwnedCheckResult {
  pwned: boolean
  count?: number
  error?: string
}

/**
 * Checks if a candidate password has appeared in known data breaches.
 * Non-blocking fallback: if network is down or API times out, returns { pwned: false }
 * to prevent locking users out when offline.
 */
export async function checkLeakedPassword(password: string): Promise<PwnedCheckResult> {
  if (!password || password.length === 0) {
    return { pwned: false }
  }

  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3500)

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true', // Prevents response length side-channel analysis
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      return { pwned: false }
    }

    const text = await res.text()
    const lines = text.split('\r\n')

    for (const line of lines) {
      const [lineSuffix, countStr] = line.split(':')
      if (lineSuffix && lineSuffix.trim() === suffix) {
        const count = parseInt(countStr || '1', 10)
        return { pwned: true, count }
      }
    }

    return { pwned: false }
  } catch {
    // Fail safely open if network or rate-limited to avoid blocking login/reset
    return { pwned: false }
  }
}
