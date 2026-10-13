import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateLocalUserWithCode,
  addLocalUser,
  authenticateLocalUser,
  clearLocalSession,
  deleteLocalUser,
  getLocalSession,
  loadLocalUsers,
  updateLocalUser,
} from '../../src/lib/localUsers'
import { canEditInventory, checkIsSystemAdmin, getUserRole } from '../../src/lib/supabase'

describe('Local Users and PIN-Based Authentication Suite', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('automatically seeds default system admin marwan-desouky passwordless in code', () => {
    const users = loadLocalUsers()
    expect(users.length).toBeGreaterThanOrEqual(1)

    const admin = users.find((u) => u.username === 'marwan-desouky')
    expect(admin).toBeDefined()
    expect(admin?.role).toBe('admin')
    expect(admin?.password).toBe('')
    expect(admin?.status).toBe('active')
  })

  it('authenticates marwan-desouky with set password successfully', () => {
    const users = loadLocalUsers()
    const admin = users.find((u) => u.username === 'marwan-desouky')!
    updateLocalUser(admin.id, { password: 'DummyTestAdmin.123' })

    const res = authenticateLocalUser('marwan-desouky', 'DummyTestAdmin.123')
    expect(res.user.username).toBe('marwan-desouky')
    expect(res.needsActivation).toBeFalsy()

    const session = getLocalSession()
    expect(session).not.toBeNull()
    expect(session?.user.user_metadata.username).toBe('marwan-desouky')
    expect(session?.user.app_metadata.system_admin).toBe(true)
  })

  it('rejects wrong password or non-existent username', () => {
    expect(() => {
      authenticateLocalUser('marwan-desouky', 'WrongPassword123')
    }).toThrow(/كلمة المرور غير صحيحة/)

    expect(() => {
      authenticateLocalUser('nonexistent-user', 'any-pass')
    }).toThrow(/اسم المستخدم غير مسجل/)
  })

  it('allows adding a user without email (only username, password, pin) and handles PIN activation', () => {
    const newUser = addLocalUser({
      username: 'ahmed_store',
      displayName: 'أحمد أمين المخزن',
      password: 'StorePass.2026',
      role: 'editor',
      activationCode: '654321',
      requireActivation: true,
    })

    expect(newUser.username).toBe('ahmed_store')
    expect(newUser.status).toBe('pending_activation')
    expect(newUser.activationCode).toBe('654321')

    // Logging in while pending activation signals needsActivation
    const authRes = authenticateLocalUser('ahmed_store', 'StorePass.2026')
    expect(authRes.needsActivation).toBe(true)

    // Activating with wrong code fails
    expect(() => {
      activateLocalUserWithCode('ahmed_store', '999999')
    }).toThrow(/كود تأكيد التفعيل غير صحيح/)

    // Activating with correct code succeeds
    const activated = activateLocalUserWithCode('ahmed_store', '654321')
    expect(activated.status).toBe('active')

    // After activation, user logs in directly
    const authAfter = authenticateLocalUser('ahmed_store', 'StorePass.2026')
    expect(authAfter.needsActivation).toBeFalsy()
  })

  it('rejects usernames containing spaces or duplicate usernames', () => {
    expect(() => {
      addLocalUser({
        username: 'invalid user',
        password: 'Pass.123',
        role: 'viewer',
      })
    }).toThrow(/اسم المستخدم يجب ألا يحتوي على مسافات/)

    expect(() => {
      addLocalUser({
        username: 'marwan-desouky',
        password: 'Pass.123',
        role: 'viewer',
      })
    }).toThrow(/مسجل مسبقاً/)
  })

  it('supports updating user details and deleting user', () => {
    const user = addLocalUser({
      username: 'khaled_keeper',
      displayName: 'خالد الكاتب',
      password: 'Pass.123',
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

  it('clears local session on clearLocalSession()', () => {
    const users = loadLocalUsers()
    const admin = users.find((u) => u.username === 'marwan-desouky')!
    updateLocalUser(admin.id, { password: 'DummyTestAdmin.123' })
    authenticateLocalUser('marwan-desouky', 'DummyTestAdmin.123')
    expect(getLocalSession()).not.toBeNull()

    clearLocalSession()
    expect(getLocalSession()).toBeNull()
  })

  it('strictly protects marwan-desouky from deletion and downgrading role', () => {
    const users = loadLocalUsers()
    const admin = users.find((u) => u.username === 'marwan-desouky')
    expect(admin).toBeDefined()
    if (!admin) return

    // Deleting must throw
    expect(() => {
      deleteLocalUser(admin.id)
    }).toThrow(/لا يمكن حذف حساب مدير النظام الأساسي/)

    // Downgrading role must throw
    expect(() => {
      updateLocalUser(admin.id, { role: 'viewer' })
    }).toThrow(/لا يمكن تقليص أو تغيير صلاحية/)

    // Deactivating must throw
    expect(() => {
      updateLocalUser(admin.id, { status: 'pending_activation' })
    }).toThrow(/لا يمكن تعطيل أو تعليق/)
  })

  it('automatically purges deleted account marwandesouqhi@gmail.com from storage', () => {
    // Seed with marwandesouqhi@gmail.com legacy entry
    localStorage.setItem(
      'warehouse-ledger-local-users',
      JSON.stringify([
        {
          id: 'old-marwan-email',
          username: 'marwandesouqhi@gmail.com',
          displayName: 'Old Email Account',
          password: 'Pass',
          role: 'admin',
          activationCode: '0000',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
      ])
    )

    const loaded = loadLocalUsers()
    expect(loaded.some((u) => u.username === 'marwandesouqhi@gmail.com')).toBe(false)
    expect(loaded.some((u) => u.username === 'marwan-desouky')).toBe(true)
  })

  it('automatically saves newly created users to storage and allows immediate seamless login', () => {
    // 1. Create editor user
    const editor = addLocalUser({
      username: 'samir_editor',
      displayName: 'سمير المحرر',
      password: 'SamirPassword123',
      role: 'editor',
      requireActivation: false,
    })
    expect(editor.username).toBe('samir_editor')

    // 2. Verify saved in localStorage
    const savedUsers = loadLocalUsers()
    expect(savedUsers.some((u) => u.username === 'samir_editor')).toBe(true)

    // 3. User logs in immediately without PIN prompt
    const authResult = authenticateLocalUser('samir_editor', 'SamirPassword123')
    expect(authResult.needsActivation).toBeFalsy()
    expect(authResult.user.username).toBe('samir_editor')

    // 4. Session is populated with editor role
    const session = getLocalSession()
    expect(session).not.toBeNull()
    expect(session?.user.user_metadata.role).toBe('editor')

    // 5. Role permissions are enforced correctly
    expect(getUserRole(session as any)).toBe('editor')
    expect(canEditInventory(session as any)).toBe(true)
    expect(checkIsSystemAdmin(session as any)).toBe(false)
  })

  it('strictly enforces role permissions for viewer (read-only) user', () => {
    // 1. Create viewer user
    addLocalUser({
      username: 'tamer_viewer',
      displayName: 'تامر المراقب',
      password: 'TamerPass.99',
      role: 'viewer',
      requireActivation: false,
    })

    // 2. User logs in
    const authResult = authenticateLocalUser('tamer_viewer', 'TamerPass.99')
    expect(authResult.needsActivation).toBeFalsy()

    // 3. Session role check
    const session = getLocalSession()
    expect(getUserRole(session as any)).toBe('viewer')
    expect(canEditInventory(session as any)).toBe(false)
    expect(checkIsSystemAdmin(session as any)).toBe(false)
  })
})
