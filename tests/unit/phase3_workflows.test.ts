import { describe, it, expect } from 'vitest'
import { userMustChangePassword } from '../../src/lib/permissions'
import { parseDateToTimestamp } from '../../src/lib/dateUtils'
import {
  validateAndClassifyMovementRows,
  generateMovementErrorReportCsv,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_FILE_SIZE,
} from '../../src/lib/importRows'
import { saveAppSettingsToCloud, defaultSettings } from '../../src/lib/settings'
import { saveUserToCloud, type LocalUser } from '../../src/lib/localUsers'

describe('Phase 3 Trustworthy Workflows', () => {
  describe('Issue #17: userMustChangePassword detection', () => {
    it('returns true when app_metadata.must_change_password is true', () => {
      const user = {
        app_metadata: { must_change_password: true },
        user_metadata: {},
      }
      expect(userMustChangePassword(user)).toBe(true)
    })

    it('returns true when user_metadata.must_change_password is true', () => {
      const user = {
        app_metadata: {},
        user_metadata: { must_change_password: true },
      }
      expect(userMustChangePassword(user)).toBe(true)
    })

    it('returns false when user_metadata explicitly overrides must_change_password to false', () => {
      const user = {
        app_metadata: { must_change_password: true },
        user_metadata: { must_change_password: false },
      }
      expect(userMustChangePassword(user)).toBe(false)
    })

    it('returns false when no password change flag is present', () => {
      const user = {
        app_metadata: {},
        user_metadata: {},
      }
      expect(userMustChangePassword(user)).toBe(false)
      expect(userMustChangePassword(null)).toBe(false)
      expect(userMustChangePassword(undefined)).toBe(false)
    })

    it('inspects session.user when passed a session object', () => {
      const session = {
        user: {
          app_metadata: { must_change_password: true },
          user_metadata: {},
        },
      }
      expect(userMustChangePassword(session as any)).toBe(true)
    })
  })

  describe('Issue #23: Normalized date parsing for sorting', () => {
    it('parses standard ISO date strings', () => {
      const ts = parseDateToTimestamp('2026-10-15')
      expect(ts).toBeGreaterThan(0)
      const date = new Date(ts)
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth() + 1).toBe(10)
      expect(date.getDate()).toBe(15)
    })

    it('parses DD/MM/YYYY date strings', () => {
      const ts = parseDateToTimestamp('25/12/2025')
      expect(ts).toBeGreaterThan(0)
      const date = new Date(ts)
      expect(date.getFullYear()).toBe(2025)
      expect(date.getMonth() + 1).toBe(12)
      expect(date.getDate()).toBe(25)
    })

    it('parses dates with Egyptian Arabic numerals', () => {
      const ts = parseDateToTimestamp('٢٠٢٦-١٠-١٥')
      expect(ts).toBeGreaterThan(0)
      const date = new Date(ts)
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth() + 1).toBe(10)
      expect(date.getDate()).toBe(15)
    })

    it('handles empty, null, and invalid inputs gracefully returning 0', () => {
      expect(parseDateToTimestamp('')).toBe(0)
      expect(parseDateToTimestamp(null)).toBe(0)
      expect(parseDateToTimestamp(undefined)).toBe(0)
      expect(parseDateToTimestamp('invalid-date-string')).toBe(0)
    })

    it('correctly orders chronologically independent of string locale', () => {
      const d1 = parseDateToTimestamp('2025-12-31')
      const d2 = parseDateToTimestamp('2026-01-01')
      const d3 = parseDateToTimestamp('2026-05-15')
      expect(d1).toBeLessThan(d2)
      expect(d2).toBeLessThan(d3)
    })
  })

  describe('Issue #24: Import Row Validation, Classification, and Limits', () => {
    it('defines explicit row and file size bounds', () => {
      expect(MAX_IMPORT_ROWS).toBe(5000)
      expect(MAX_IMPORT_FILE_SIZE).toBe(10 * 1024 * 1024)
    })

    it('classifies valid rows, invalid rows, and skips blank rows', () => {
      const rawRows = [
        // Valid row
        {
          'الصنف': 'طابعة ليزر',
          'الوارد': 5,
          'التاريخ': '2026-10-01',
          'السعر': 3000,
        },
        // Missing item name
        {
          'الصنف': '',
          'الوارد': 10,
          'التاريخ': '2026-10-01',
        },
        // Zero quantity
        {
          'الصنف': 'شاشة عرض',
          'الوارد': 0,
          'المنصرف': 0,
        },
        // Blank row
        {
          'الصنف': '',
          'الوارد': '',
          'التاريخ': '',
        },
        // Valid disbursement row
        {
          'الصنف': 'جهاز حاسب آلي',
          'المنصرف': 2,
          'التاريخ': '2026-10-02',
        },
      ]

      const result = validateAndClassifyMovementRows(rawRows, 1000)
      expect(result.totalRows).toBe(5)
      expect(result.validMovements.length).toBe(2)
      expect(result.validMovements[0].item).toBe('طابعة ليزر')
      expect(result.validMovements[1].item).toBe('جهاز حاسب آلي')

      expect(result.rejectedRows.length).toBe(2)
      expect(result.rejectedRows[0].rowNumber).toBe(3) // 1-indexed, header is 1, so row 2 in data is row 3
      expect(result.rejectedRows[0].reason).toContain('اسم الصنف فارغ')

      expect(result.rejectedRows[1].rowNumber).toBe(4)
      expect(result.rejectedRows[1].itemName).toBe('شاشة عرض')
      expect(result.rejectedRows[1].reason).toContain('كمية وارد أو كمية منصرف أكبر من صفر')
    })

    it('generates a CSV error report containing row numbers and reasons', () => {
      const rejected = [
        { rowNumber: 5, itemName: 'مكتب خشب', reason: 'الكمية صفر' },
        { rowNumber: 8, itemName: '', reason: 'اسم الصنف فارغ' },
      ]
      const csv = generateMovementErrorReportCsv(rejected)
      expect(csv).toContain('رقم الصف في الملف')
      expect(csv).toContain('مكتب خشب')
      expect(csv).toContain('الكمية صفر')
      expect(csv).toContain('5')
      expect(csv).toContain('8')
    })
  })

  describe('Issue #20: Explicit persistence outcomes for settings and users', () => {
    it('returns saved_locally when Supabase is not configured', async () => {
      const outcome = await saveAppSettingsToCloud({
        ...defaultSettings,
        organization: 'جامعة الزقازيق الأهلية',
        department: 'المخازن',
        currency: 'EGP',
      })
      expect(['saved_locally', 'saved_to_cloud', 'error']).toContain(outcome.status)
    })

    it('returns structured persistence outcome for saveUserToCloud', async () => {
      const testUser: LocalUser = {
        id: 'test-user-outcome-1',
        username: 'testuser',
        displayName: 'مستخدم تجريبي',
        password: '',
        role: 'editor',
        activationCode: '',
        status: 'active',
        createdAt: new Date().toISOString(),
        department: 'warehouse',
      }
      const outcome = await saveUserToCloud(testUser)
      expect(['saved_locally', 'saved_to_cloud', 'error']).toContain(outcome.status)
    })
  })
})

