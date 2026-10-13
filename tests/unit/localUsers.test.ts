import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateLocalUserWithCode,
  addLocalUser,
  authenticateLocalUser,
  clearLocalSession,
  deleteLocalUser,
  getLocalSession,
  loadLocalUsers,
  saveLocalUsers,
  updateLocalUser,
  LOCAL_USERS_STORAGE_KEY,
} from '../../src/lib/localUsers'

describe('Local Users Security & Password Storage Hardening Suite', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('1. DEFAULT_ADMIN in code is passwordless and never stores plaintext passwords', () => {
    const users = loadLocalUsers()
    expect(users.length).toBeGreaterThanOrEqual(1)

    const admin = users.find((u) => u.username === 'marwan-desouky')
    expect(admin).toBeDefined()
    expect(admin?.password).toBe('') // Zero plaintext password in code or memory
  })

  it('2. authenticateLocalUser strictly rejects all local authentication attempts', () => {
    expect(() => {
      authenticateLocalUser('marwan-desouky', 'AnyPassword123!')
    }).toThrow(/تم إيقاف تسجيل الدخول المحلي غير الآمن/)

    expect(() => {
      authenticateLocalUser('any_user', 'AnyPassword123!')
    }).toThrow(/تم إيقاف تسجيل الدخول المحلي غير الآمن/)
  })

  it('3. activateLocalUserWithCode strictly rejects PIN-based activation', () => {
    expect(() => {
      activateLocalUserWithCode('ahmed_store', '654321')
    }).toThrow(/تم إلغاء التفعيل عبر الأكواد الثابتة/)
  })

  it('4. saveLocalUsers strips plaintext passwords from localStorage', () => {
    const testUsers = [
      {
        id: 'usr-1',
        username: 'test_user',
        displayName: 'Test User',
        password: 'PlaintextPassword123!', // Provided in memory
        role: 'editor' as const,
        activationCode: '123456',
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      },
    ]

    saveLocalUsers(testUsers)

    const raw = localStorage.getItem(LOCAL_USERS_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('PlaintextPassword123!')

    const reloaded = loadLocalUsers()
    const target = reloaded.find((u) => u.username === 'test_user')
    expect(target).toBeDefined()
    expect(target?.password).toBe('') // Stripped and empty in storage
  })

  it('5. addLocalUser enforces minimum 12-character strong password policy', () => {
    expect(() => {
      addLocalUser({
        username: 'short_pass_user',
        password: 'Short123', // < 12 chars
        role: 'viewer',
      })
    }).toThrow(/كلمة المرور يجب ألا تقل عن 12/)

    const valid = addLocalUser({
      username: 'valid_user',
      password: 'StrongPassword2026!#',
      role: 'viewer',
    })
    expect(valid.username).toBe('valid_user')
  })

  it('6. rejects usernames containing spaces or duplicate usernames', () => {
    expect(() => {
      addLocalUser({
        username: 'invalid user',
        password: 'SecurePassword123!',
        role: 'viewer',
      })
    }).toThrow(/اسم المستخدم يجب ألا يحتوي على مسافات/)

    expect(() => {
      addLocalUser({
        username: 'marwan-desouky',
        password: 'SecurePassword123!',
        role: 'viewer',
      })
    }).toThrow(/مسجل مسبقاً/)
  })

  it('7. supports updating user details and deleting non-admin users', () => {
    const user = addLocalUser({
      username: 'khaled_keeper',
      displayName: 'خالد الكاتب',
      password: 'SecurePassword123!',
      role: 'viewer',
    })

    const updated = updateLocalUser(user.id, {
      displayName: 'خالد المحاسب',
      role: 'editor',
    })
    expect(updated.displayName).toBe('خالد المحاسب')
    expect(updated.role).toBe('editor')

    deleteLocalUser(user.id)
    const users = loadLocalUsers()
    expect(users.find((u) => u.id === user.id)).toBeUndefined()
  })

  it('8. strictly protects the last active system admin from deletion and demoting role', () => {
    const users = loadLocalUsers()
    const admin = users.find((u) => u.username === 'marwan-desouky')
    expect(admin).toBeDefined()
    if (!admin) return

    // Deleting the only active admin must throw
    expect(() => {
      deleteLocalUser(admin.id)
    }).toThrow(/لا يمكن حذف آخر مدير نظام نشط/)

    // Downgrading role of only active admin must throw
    expect(() => {
      updateLocalUser(admin.id, { role: 'viewer' })
    }).toThrow(/لا يمكن تقليص صلاحيات آخر مدير نظام نشط/)

    // Deactivating only active admin must throw
    expect(() => {
      updateLocalUser(admin.id, { status: 'pending_activation' })
    }).toThrow(/لا يمكن تعطيل آخر مدير نظام نشط/)
  })

  it('9. automatically purges deleted account marwandesouqhi@gmail.com from storage', () => {
    localStorage.setItem(
      LOCAL_USERS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'old-marwan-email',
          username: 'marwandesouqhi@gmail.com',
          displayName: 'Old Email Account',
          password: '',
          role: 'admin',
          activationCode: '0000',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
      ])
    )

    const loaded = loadLocalUsers()
    expect(loaded.some((u) => u.username === 'marwandesouqhi@gmail.com')).toBe(false)
  })

  it('10. clears local session on clearLocalSession()', () => {
    clearLocalSession()
    expect(getLocalSession()).toBeNull()
  })
})
