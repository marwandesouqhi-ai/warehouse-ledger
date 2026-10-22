import { supabase } from './supabase'

export type AppSettings = {
  organization: string
  department: string
  currency: 'EGP' | 'SAR' | 'AED' | 'USD'
  logoDataUrl?: string
  logoUrl?: string
  organizationCode?: string
  systemName?: string
}

export const settingsStorageKey = 'warehouse-ledger-settings'
export const logoBackupStorageKey = 'warehouse-ledger-custom-logo'

export const defaultSettings: AppSettings = {
  organization: 'جامعة الزقازيق الأهلية',
  department: 'المخازن',
  currency: 'EGP',
  organizationCode: 'ZNU',
  systemName: 'ZNU-Warehouse-Ledger',
}

export function getSystemDisplayName(settings?: Partial<AppSettings> | null): string {
  if (settings?.systemName?.trim()) return settings.systemName.trim()
  const code =
    settings?.organizationCode?.trim() ||
    (settings?.organization?.includes('الزقازيق') ? 'ZNU' : '')
  return code ? `${code}-Warehouse-Ledger` : 'ZNU-Warehouse-Ledger'
}

export function loadAppSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(settingsStorageKey)
    const backupLogo = localStorage.getItem(logoBackupStorageKey) || ''
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>

      // Migrate obsolete placeholder names to the designated institution
      if (!parsed.organization || parsed.organization === 'المعهد' || parsed.organization === 'معهد التكنولوجيا') {
        parsed.organization = defaultSettings.organization
      }
      if (!parsed.department || parsed.department === 'قسم المخازن' || parsed.department === 'المخزن الهندسي') {
        parsed.department = defaultSettings.department
      }

      if (!parsed.logoDataUrl && !parsed.logoUrl && backupLogo) {
        if (backupLogo.startsWith('data:')) {
          parsed.logoDataUrl = backupLogo
        } else {
          parsed.logoUrl = backupLogo
        }
      }
      const loaded = { ...defaultSettings, ...parsed }
      // Keep local storage up to date if migrated
      localStorage.setItem(settingsStorageKey, JSON.stringify(loaded))
      return loaded
    }
    if (backupLogo) {
      const loaded = {
        ...defaultSettings,
        ...(backupLogo.startsWith('data:') ? { logoDataUrl: backupLogo } : { logoUrl: backupLogo }),
      }
      localStorage.setItem(settingsStorageKey, JSON.stringify(loaded))
      return loaded
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

  let resolvedOrg = cloudSettings.organization || current.organization || defaultSettings.organization
  if (resolvedOrg === 'المعهد' || resolvedOrg === 'معهد التكنولوجيا') {
    resolvedOrg = current.organization && current.organization !== 'المعهد' && current.organization !== 'معهد التكنولوجيا'
      ? current.organization
      : defaultSettings.organization
  }

  let resolvedDept = cloudSettings.department || current.department || defaultSettings.department
  if (resolvedDept === 'قسم المخازن' || resolvedDept === 'المخزن الهندسي') {
    resolvedDept = current.department && current.department !== 'قسم المخازن' && current.department !== 'المخزن الهندسي'
      ? current.department
      : defaultSettings.department
  }

  const resolved: AppSettings = {
    ...current,
    ...cloudSettings,
    organization: resolvedOrg,
    department: resolvedDept,
    logoDataUrl: resolvedLogoDataUrl,
    logoUrl: resolvedLogoUrl,
  }

  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify(resolved))
    const currentLogo = resolved.logoDataUrl || resolved.logoUrl || ''
    if (currentLogo) {
      localStorage.setItem(logoBackupStorageKey, currentLogo)
    }
  } catch {
    // ignore
  }

  return resolved
}

export async function fetchAppSettingsFromCloud(): Promise<AppSettings | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle()
    if (error || !data) return null

    let org = data.organization || defaultSettings.organization
    if (org === 'المعهد' || org === 'معهد التكنولوجيا') {
      org = defaultSettings.organization
    }

    let dept = data.department || defaultSettings.department
    if (dept === 'قسم المخازن' || dept === 'المخزن الهندسي') {
      dept = defaultSettings.department
    }

    return {
      organization: org,
      department: dept,
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('settings-changed'))
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