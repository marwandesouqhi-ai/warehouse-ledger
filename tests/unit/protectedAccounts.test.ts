import { describe, it, expect } from 'vitest'
import {
  normalizeUsername,
  isProtectedUsername,
  isRootAdmin,
  canDeleteUser,
  canModifyUser,
  RESERVED_PROTECTED_USERNAMES,
} from '../../src/lib/protectedAccounts'

describe('Protected System Admin Account & Username Normalization Suite', () => {
  describe('Username Normalization & Homoglyph Resistance', () => {
    it('normalizes whitespace and case', () => {
      expect(normalizeUsername('  Marwan-Desouky  ')).toBe('marwan-desouky')
    })

    it('strips zero-width and invisible formatting characters', () => {
      const withZeroWidth = 'mar\u200Bwan-\uFEFFdesouky\u200E'
      expect(normalizeUsername(withZeroWidth)).toBe('marwan-desouky')
    })

    it('normalizes lookalike hyphens (en-dash, em-dash, minus) to ASCII hyphen', () => {
      expect(normalizeUsername('marwan\u2013desouky')).toBe('marwan-desouky') // en-dash
      expect(normalizeUsername('marwan\u2014desouky')).toBe('marwan-desouky') // em-dash
      expect(normalizeUsername('marwan\u2212desouky')).toBe('marwan-desouky') // minus sign
    })

    it('converts Cyrillic homoglyphs to Latin equivalents', () => {
      // Cyrillic 'а' (U+0430) and 'е' (U+0435) and 'о' (U+043E)
      const cyrillicSpoof = 'm\u0430rw\u0430n-d\u0435s\u043Euky'
      expect(normalizeUsername(cyrillicSpoof)).toBe('marwan-desouky')
    })
  })

  describe('isProtectedUsername verification', () => {
    it('identifies canonical system admin username and aliases', () => {
      expect(isProtectedUsername('marwan-desouky')).toBe(true)
      expect(isProtectedUsername('MARWAN-DESOUKY')).toBe(true)
      expect(isProtectedUsername('marwan-desouky@warehouse.local')).toBe(true)
      expect(isProtectedUsername('marwandesouqhi@gmail.com')).toBe(true)
    })

    it('detects homoglyphs and hidden spaces targeting marwan-desouky', () => {
      expect(isProtectedUsername(' m\u0430rwan-desouky ')).toBe(true)
      expect(isProtectedUsername('marwan\u2013desouky@warehouse.local')).toBe(true)
    })

    it('returns false for regular users and distinct names', () => {
      expect(isProtectedUsername('marwan_user')).toBe(false)
      expect(isProtectedUsername('desouky')).toBe(false)
      expect(isProtectedUsername('storekeeper')).toBe(false)
      expect(isProtectedUsername('admin')).toBe(false)
    })

    it('ensures all entries in RESERVED_PROTECTED_USERNAMES are protected', () => {
      for (const item of RESERVED_PROTECTED_USERNAMES) {
        expect(isProtectedUsername(item)).toBe(true)
      }
    })
  })

  describe('isRootAdmin verification', () => {
    it('identifies admin username and its synthetic email', () => {
      expect(isRootAdmin('admin')).toBe(true)
      expect(isRootAdmin('ADMIN')).toBe(true)
      expect(isRootAdmin('admin@warehouse.local')).toBe(true)
      expect(isRootAdmin('marwan-desouky')).toBe(false)
      expect(isRootAdmin('other')).toBe(false)
    })
  })

  describe('canDeleteUser rules', () => {
    it('strictly forbids deleting marwan-desouky', () => {
      const result = canDeleteUser('marwan-desouky')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('محمي بشكل كامل ودائم')
    })

    it('strictly forbids deleting admin', () => {
      const result = canDeleteUser('admin')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('محمي من الحذف')
    })

    it('allows deleting regular users', () => {
      const result = canDeleteUser('regular_worker')
      expect(result.allowed).toBe(true)
    })
  })

  describe('canModifyUser rules', () => {
    it('blocks another admin from modifying marwan-desouky', () => {
      const check = canModifyUser(
        'marwan-desouky',
        'admin',
        true,
        { role: 'admin' }
      )
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain('إلا بواسطة صاحب الحساب نفسه')
    })

    it('forbids marwan-desouky himself from demoting his own role', () => {
      const check = canModifyUser(
        'marwan-desouky',
        'marwan-desouky',
        true,
        { role: 'editor' }
      )
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain('لا يمكن تخفيض دور مدير النظام')
    })

    it('forbids marwan-desouky himself from renaming his core username', () => {
      const check = canModifyUser(
        'marwan-desouky',
        'marwan-desouky',
        true,
        { username: 'marwan-new' }
      )
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain('لا يمكن تغيير اسم مستخدم مدير النظام')
    })

    it('forbids promoting any other user to system_admin (sole system admin rule)', () => {
      const check = canModifyUser(
        'ahmed_staff',
        'marwan-desouky',
        true,
        { role: 'system_admin' }
      )
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain('لا يمكن تعيين أو ترقية مستخدم آخر لدور مدير النظام')
    })

    it('forbids demoting root admin', () => {
      const check = canModifyUser(
        'admin',
        'marwan-desouky',
        true,
        { role: 'editor' }
      )
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain('لا يمكن تخفيض صلاحيات المشرف الرئيسي')
    })

    it('allows valid changes to regular users', () => {
      const check = canModifyUser(
        'ahmed_staff',
        'marwan-desouky',
        true,
        { role: 'purchasing_staff' }
      )
      expect(check.allowed).toBe(true)
    })
  })
})
