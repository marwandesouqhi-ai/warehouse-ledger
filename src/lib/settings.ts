import { supabase } from './supabase'

export type AppSettings = {
  organization: string
  department: string
  currency: 'EGP' | 'SAR' | 'AED' | 'USD'
  logoDataUrl?: string
  logoUrl?: string
}

export const settingsStorageKey = 'warehouse-ledger-settings'
export const logoBackupStorageKey = 'warehouse-ledger-custom-logo'

export const defaultSettings: AppSettings = {
  organization: 'المعهد',
  department: 'قسم المخازن',
  currency: 'EGP',
}

export function loadAppSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(settingsStorageKey)
    const backupLogo = localStorage.getItem(logoBackupStorageKey) || ''
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>
      if (!parsed.logoDataUrl && !parsed.logoUrl && backupLogo) {
        if (backupLogo.startsWith('data:')) {
          parsed.logoDataUrl = backupLogo
        } else {
          parsed.logoUrl = backupLogo
        }
      }
      return { ...defaultSettings, ...parsed }
    }
    if (backupLogo) {
      return {
        ...defaultSettings,
        ...(backupLogo.startsWith('data:') ? { logoDataUrl: backupLogo } : { logoUrl: backupLogo }),
      }
    }
  } catch {
    return defaultSettings
  }

  return defaultSettings
}

export function resolveSettingsWithCloud(
  current: AppSettings,
  cloudSettings?: Partial<AppSettings>
): AppSettings {
  if (!cloudSettings) return current

  // Safeguard: Never let empty/undefined cloud logo overwrite a valid local logo
  const resolvedLogoDataUrl =
    cloudSettings.logoDataUrl && cloudSettings.logoDataUrl.trim()
      ? cloudSettings.logoDataUrl
      : current.logoDataUrl || ''

  const resolvedLogoUrl =
    cloudSettings.logoUrl && cloudSettings.logoUrl.trim()
      ? cloudSettings.logoUrl
      : current.logoUrl || ''

  return {
    ...current,
    ...cloudSettings,
    logoDataUrl: resolvedLogoDataUrl,
    logoUrl: resolvedLogoUrl,
  }
}

export async function fetchAppSettingsFromCloud(): Promise<AppSettings | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle()
    if (error || !data) return null
    return {
      organization: data.organization || defaultSettings.organization,
      department: data.department || defaultSettings.department,
      currency: (data.currency as AppSettings['currency']) || defaultSettings.currency,
      logoUrl: data.logo_url || undefined,
      logoDataUrl: data.logo_data_url || undefined,
    }
  } catch {
    return null
  }
}

export async function saveAppSettingsToCloud(settings: AppSettings): Promise<void> {
  // Always persist locally
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
    const currentLogo = settings.logoDataUrl || settings.logoUrl || ''
    if (currentLogo) {
      localStorage.setItem(logoBackupStorageKey, currentLogo)
    } else {
      localStorage.removeItem(logoBackupStorageKey)
    }
  } catch (err) {
    console.warn('Could not save settings locally:', err)
  }

  // If connected to Supabase, sync to public.app_settings table
  if (supabase) {
    try {
      await supabase.from('app_settings').upsert({
        id: 'default',
        organization: settings.organization,
        department: settings.department,
        currency: settings.currency,
        logo_url: settings.logoUrl || '',
        logo_data_url: settings.logoDataUrl || '',
      })
    } catch (err) {
      console.warn('Could not sync app settings to Supabase table:', err)
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        // Strip large data URLs (base64 images) before saving to cloud metadata
        // to prevent JWT header bloat which exceeds Nginx/Cloudflare HTTP header size limits (>16KB)
        const cloudSafeSettings: Partial<AppSettings> = {
          organization: settings.organization,
          department: settings.department,
          currency: settings.currency,
          logoUrl: settings.logoUrl && !settings.logoUrl.startsWith('data:') ? settings.logoUrl : '',
        }
        await supabase.auth.updateUser({
          data: {
            app_settings: cloudSafeSettings,
          },
        })
      }
    } catch (err) {
      console.warn('Could not sync app settings to Supabase user metadata:', err)
    }
  }
}