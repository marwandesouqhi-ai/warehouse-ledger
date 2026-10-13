import { beforeEach, describe, expect, it } from 'vitest'
import {
    defaultSettings,
    loadAppSettings,
    logoBackupStorageKey,
    resolveSettingsWithCloud,
    saveAppSettingsToCloud,
    settingsStorageKey,
    type AppSettings,
} from '../../src/lib/settings'

describe('Settings and Logo Persistence Suite', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns default settings when storage is empty', () => {
        const settings = loadAppSettings()
        expect(settings.organization).toBe(defaultSettings.organization)
        expect(settings.department).toBe(defaultSettings.department)
        expect(settings.currency).toBe('EGP')
        expect(settings.logoDataUrl).toBeUndefined()
        expect(settings.logoUrl).toBeUndefined()
    })

    it('saves settings and backup logo key into localStorage', async () => {
        const testLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        const newSettings: AppSettings = {
            organization: 'كلية الهندسة',
            department: 'المخازن الهندسية',
            currency: 'EGP',
            logoDataUrl: testLogo,
        }

        await saveAppSettingsToCloud(newSettings)

        // Verify primary storage
        const stored = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}')
        expect(stored.organization).toBe('كلية الهندسة')
        expect(stored.logoDataUrl).toBe(testLogo)

        // Verify backup logo storage
        expect(localStorage.getItem(logoBackupStorageKey)).toBe(testLogo)
    })

    it('restores logo from backup key if primary settings key lost the logo', () => {
        const testLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        // Simulate a scenario where primary settings has no logo, but backup key has it
        localStorage.setItem(
            settingsStorageKey,
            JSON.stringify({
                organization: 'المعهد التكنولوجي',
                department: 'إدارة المخازن',
                currency: 'SAR',
            })
        )
        localStorage.setItem(logoBackupStorageKey, testLogo)

        const loaded = loadAppSettings()
        expect(loaded.organization).toBe('المعهد التكنولوجي')
        expect(loaded.currency).toBe('SAR')
        expect(loaded.logoDataUrl).toBe(testLogo)
    })

    it('resolveSettingsWithCloud does not erase local logo if cloud has empty logo', () => {
        const current: AppSettings = {
            organization: 'المعهد',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: 'data:image/png;base64,LOCAL_LOGO_DATA',
        }

        const cloud: Partial<AppSettings> = {
            organization: 'المعهد المحدث',
            department: 'المخازن المركزية',
            logoDataUrl: '', // empty in cloud
        }

        const resolved = resolveSettingsWithCloud(current, cloud)
        expect(resolved.organization).toBe('المعهد المحدث')
        expect(resolved.department).toBe('المخازن المركزية')
        // Must preserve the local logo
        expect(resolved.logoDataUrl).toBe('data:image/png;base64,LOCAL_LOGO_DATA')
    })

    it('resolveSettingsWithCloud updates logo when cloud provides a new valid logo', () => {
        const current: AppSettings = {
            organization: 'المعهد',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: 'data:image/png;base64,LOCAL_LOGO_DATA',
        }

        const cloud: Partial<AppSettings> = {
            organization: 'المعهد',
            logoDataUrl: 'data:image/png;base64,NEW_CLOUD_LOGO_DATA',
        }

        const resolved = resolveSettingsWithCloud(current, cloud)
        expect(resolved.logoDataUrl).toBe('data:image/png;base64,NEW_CLOUD_LOGO_DATA')
    })

    it('clears backup logo key when logo is explicitly removed', async () => {
        localStorage.setItem(logoBackupStorageKey, 'data:image/png;base64,OLD')
        const emptyLogoSettings: AppSettings = {
            organization: 'المعهد',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: '',
            logoUrl: '',
        }

        await saveAppSettingsToCloud(emptyLogoSettings)
        expect(localStorage.getItem(logoBackupStorageKey)).toBeNull()
    })
})
