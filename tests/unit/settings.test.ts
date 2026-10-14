import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        from: vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                        data: {
                            id: 'default',
                            organization: 'جامعة الزقازيق الأهلية',
                            department: 'المخازن',
                            currency: 'EGP',
                        },
                        error: null,
                    }),
                }),
            }),
        }),
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
    },
}))

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
        vi.clearAllMocks()
    })

    it('returns default settings when storage is empty', () => {
        const settings = loadAppSettings()
        expect(settings.organization).toBe(defaultSettings.organization)
        expect(settings.department).toBe(defaultSettings.department)
        expect(settings.currency).toBe('EGP')
        expect(settings.logoDataUrl).toBeUndefined()
        expect(settings.logoUrl).toBeUndefined()
    })

    it('automatically migrates obsolete placeholder name "المعهد" to "جامعة الزقازيق الأهلية"', () => {
        localStorage.setItem(
            settingsStorageKey,
            JSON.stringify({
                organization: 'المعهد',
                department: 'قسم المخازن',
                currency: 'EGP',
            })
        )

        const loaded = loadAppSettings()
        expect(loaded.organization).toBe('جامعة الزقازيق الأهلية')
        expect(loaded.department).toBe('المخازن')
    })

    it('saves settings and backup logo key into localStorage', async () => {
        const testLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        const newSettings: AppSettings = {
            organization: 'جامعة الزقازيق الأهلية',
            department: 'المخازن الهندسية',
            currency: 'EGP',
            logoDataUrl: testLogo,
        }

        await saveAppSettingsToCloud(newSettings)

        // Verify primary storage
        const stored = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}')
        expect(stored.organization).toBe('جامعة الزقازيق الأهلية')
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
                organization: 'جامعة الزقازيق الأهلية',
                department: 'إدارة المخازن',
                currency: 'SAR',
            })
        )
        localStorage.setItem(logoBackupStorageKey, testLogo)

        const loaded = loadAppSettings()
        expect(loaded.organization).toBe('جامعة الزقازيق الأهلية')
        expect(loaded.currency).toBe('SAR')
        expect(loaded.logoDataUrl).toBe(testLogo)
    })

    it('resolveSettingsWithCloud does not erase local logo if cloud has empty logo', () => {
        const current: AppSettings = {
            organization: 'جامعة الزقازيق الأهلية',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: 'data:image/png;base64,LOCAL_LOGO_DATA',
        }

        const cloud: Partial<AppSettings> = {
            organization: 'جامعة الزقازيق الأهلية - فرع العاشر',
            department: 'المخازن المركزية',
            logoDataUrl: '', // empty in cloud
        }

        const resolved = resolveSettingsWithCloud(current, cloud)
        expect(resolved.organization).toBe('جامعة الزقازيق الأهلية - فرع العاشر')
        expect(resolved.department).toBe('المخازن المركزية')
        // Must preserve the local logo
        expect(resolved.logoDataUrl).toBe('data:image/png;base64,LOCAL_LOGO_DATA')
    })

    it('resolveSettingsWithCloud updates logo when cloud provides a new valid logo', () => {
        const current: AppSettings = {
            organization: 'جامعة الزقازيق الأهلية',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: 'data:image/png;base64,LOCAL_LOGO_DATA',
        }

        const cloud: Partial<AppSettings> = {
            organization: 'جامعة الزقازيق الأهلية',
            logoDataUrl: 'data:image/png;base64,NEW_CLOUD_LOGO_DATA',
        }

        const resolved = resolveSettingsWithCloud(current, cloud)
        expect(resolved.logoDataUrl).toBe('data:image/png;base64,NEW_CLOUD_LOGO_DATA')
    })

    it('clears backup logo key when logo is explicitly removed', async () => {
        localStorage.setItem(logoBackupStorageKey, 'data:image/png;base64,OLD')
        const emptyLogoSettings: AppSettings = {
            organization: 'جامعة الزقازيق الأهلية',
            department: 'المخازن',
            currency: 'EGP',
            logoDataUrl: '',
            logoUrl: '',
        }

        await saveAppSettingsToCloud(emptyLogoSettings)
        expect(localStorage.getItem(logoBackupStorageKey)).toBeNull()
    })
})
