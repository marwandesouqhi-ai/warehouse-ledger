import { supabase } from './supabase'

/** Public VAPID key (safe to ship). The private key lives only in the send-push edge function secrets. */
export const VAPID_PUBLIC_KEY =
  'BBfMHvQOXQ3MuzGPYG3krf29jsJrM13AkudetJiIjF7aReM3B-6TMyDMNLV2nTbjd4JPxMRCDExnrT8mnA8gha0'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'enabled' | 'disabled'

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function isIos(): boolean {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
  // iOS only supports Web Push for apps added to the home screen.
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  }
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'الاتصال بالخادم غير متاح.' }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, error: 'لم يتم السماح بالإشعارات من إعدادات المتصفح.' }

    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }))

    const json = sub.toJSON()
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData.session?.user.id
    if (!userId || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: 'تعذر قراءة بيانات الاشتراك.' }
    }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      },
      { onConflict: 'endpoint' },
    )
    if (error) return { ok: false, error: 'تعذر حفظ الاشتراك على الخادم.' }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات.' }
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {
    // ignore
  }
}
