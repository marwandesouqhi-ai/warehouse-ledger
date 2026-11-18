import { describe, expect, it } from 'vitest'
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from '../../src/lib/pushNotifications'

describe('push notifications helpers', () => {
  it('decodes the VAPID public key into a 65-byte uncompressed P-256 point', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })

  it('handles url-safe base64 without padding', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
  })
})
