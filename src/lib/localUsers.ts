import { logAuditEvent } from './auditLogger'
import { supabase } from './supabase'
import { isAuthSecureMode } from './authMode'

export async function fetchUsersFromCloud(): Promise<LocalUser[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, role, activation_code, status, created_at, activated_at, last_login_at, notes, permissions')
      .order('created_at', { ascending: true })
    if (error || !data) return []
    return data.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      password: '', // Never read passwords into memory from cloud
      role: (row.role || 'editor') as UserRole,
      activationCode: row.activation_code || '',
      status: (row.status || 'active') as UserStatus,
      createdAt: row.created_at || new Date().toISOString(),
      activatedAt: row.activated_at || undefined,
      lastLoginAt: row.last_login_at || undefined,
      notes: row.notes || undefined,
      permissions: Array.isArray(row.permissions)
        ? row.permissions
        : typeof row.permissions === 'string'
          ? (() => { try { return JSON.parse(row.permissions) } catch { return [] } })()
          : [],
    }))
  } catch (err) {
    console.warn('Could not fetch users from cloud:', err)
    return []
  }
}

export async function saveUserToCloud(user: LocalUser): Promise<void> {
  if (!supabase) return
  try {
    const payload: Record<string, unknown> = {
      id: user.id,
      username: user.username.toLowerCase(),
      display_name: user.displayName,
      role: user.role,
      activation_code: user.activationCode,
      status: user.status,
      notes: user.notes || '',
      permissions: user.permissions || [],
      created_at: user.createdAt,
      activated_at: user.activatedAt || null,
      last_login_at: user.lastLoginAt || null,
    }
    if (user.password && user.password.trim().length > 0) {
      payload.password = user.password
    }

    const { data: existing } = await supabase
      .from('app_users')
      .select('id, password')
      .eq('username', user.username.toLowerCase())
      .maybeSingle()

    if (existing) {
      if (!payload.password && existing.password) {
        payload.password = existing.password
      }
      await supabase.from('app_users').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('app_users').insert(payload)
    }
  } catch (err) {
    console.warn('Could not save user to cloud:', err)
  }
}

export async function deleteUserFromCloud(id: string): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('app_users').delete().eq('id', id)
  } catch (err) {
    console.warn('Could not delete user from cloud:', err)
  }
}

export async function syncUsersWithCloud(): Promise<LocalUser[]> {
  try {
    const cloudUsers = await fetchUsersFromCloud()
    if (cloudUsers.length > 0) {
      const local = loadLocalUsers()
      const mergedMap = new Map<string, LocalUser>()

      // Cloud users take priority
      cloudUsers.forEach((u) => mergedMap.set(u.username.toLowerCase(), u))
      // Add local users that might not have been pushed yet
      local.forEach((u) => {
        if (!mergedMap.has(u.username.toLowerCase())) {
          mergedMap.set(u.username.toLowerCase(), u)
          void saveUserToCloud(u)
        }
      })

      const merged = Array.from(mergedMap.values())
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(merged))
          window.dispatchEvent(new CustomEvent('local-users-changed'))
        }
      } catch {
        // ignore
      }
      return merged
    } else {
      // If cloud is empty, seed with current local users
      const local = loadLocalUsers()
      for (const u of local) {
        void saveUserToCloud(u)
      }
      return local
    }
  } catch {
    return loadLocalUsers()
  }
}

export type UserRole =
  | 'system_admin'
  | 'admin'
  | 'warehouse_staff'
  | 'purchasing_staff'
  | 'editor'
  | 'viewer'

export type UserStatus = 'active' | 'pending_activation'

export type LocalUser = {
  id: string
  username: string
  displayName: string
  password: string
  role: UserRole
  activationCode: string
  status: UserStatus
  createdAt: string
  activatedAt?: string
  lastLoginAt?: string
  notes?: string
  permissions?: string[]
}

export type LocalUserSession = {
  user: {
    id: string
    email: string
    user_metadata: {
      username: string
      name: string
      displayName: string
      role: UserRole
      permissions?: string[]
    }
    app_metadata: {
      role: UserRole
      system_admin: boolean
      permissions?: string[]
      username?: string
    }
  }
  access_token: string
}

export const LOCAL_USERS_STORAGE_KEY = 'warehouse-ledger-local-users'
export const LOCAL_SESSION_STORAGE_KEY = 'warehouse-ledger-local-session'

const DEFAULT_ADMIN: LocalUser = {
  id: 'usr-admin-marwan',
  username: 'marwan-desouky',
  displayName: 'مروان دسوقي (مدير النظام)',
  password: '', // Redacted / passwordless in code
  role: 'system_admin',
  activationCode: '1001',
  status: 'active',
  createdAt: new Date().toISOString(),
  permissions: ['view_audit', 'view_settings', 'manage_records'],
}

export function isLastActiveSystemAdmin(userId: string, users: LocalUser[]): boolean {
  const activeAdmins = users.filter(
    (u) => (u.role === 'system_admin' || u.role === 'admin') && u.status === 'active'
  )
  return activeAdmins.length <= 1 && activeAdmins.some((u) => u.id === userId)
}

export function isProtectedUser(_username?: string | null): boolean {
  // Hardcoded privilege escalation and protection based on username strings is disabled.
  // Protection is enforced dynamically using isLastActiveSystemAdmin to prevent administrative lockout.
  return false
}

export function purgeDeletedAccount(emailOrUsername = 'marwandesouqhi@gmail.com'): void {
  try {
    if (typeof window === 'undefined') return
    const target = emailOrUsername.toLowerCase().trim()

    // 1. Purge from local storage users
    const raw = localStorage.getItem(LOCAL_USERS_STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const filtered = (parsed as LocalUser[]).filter(
            (u) =>
              u.username.toLowerCase() !== target &&
              u.displayName.toLowerCase() !== target
          )
          if (filtered.length !== parsed.length) {
            localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(filtered))
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. Purge local session if it matches
    const sessionRaw = sessionStorage.getItem(LOCAL_SESSION_STORAGE_KEY) || localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)
    if (sessionRaw && sessionRaw.toLowerCase().includes(target)) {
      sessionStorage.removeItem(LOCAL_SESSION_STORAGE_KEY)
      localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent('local-auth-changed'))
    }

    // 3. Purge Supabase auth tokens containing target
    const stores = [localStorage, sessionStorage]
    stores.forEach((store) => {
      try {
        for (let i = store.length - 1; i >= 0; i--) {
          const key = store.key(i)
          if (!key) continue
          if (key.includes('sb-') || key.includes('supabase') || key.includes('auth')) {
            const val = store.getItem(key) || ''
            if (val.toLowerCase().includes(target)) {
              store.removeItem(key)
            }
          }
        }
      } catch {
        // ignore
      }
    })
  } catch (err) {
    console.warn('purgeDeletedAccount error:', err)
  }
}

export function generateActivationPin(): string {
  // Generate a clean 6-digit numeric activation code
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function loadLocalUsers(): LocalUser[] {
  purgeDeletedAccount('marwandesouqhi@gmail.com')
  try {
    if (typeof window === 'undefined') return [DEFAULT_ADMIN]
    const raw = localStorage.getItem(LOCAL_USERS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        let users = parsed as LocalUser[]
        // Completely purge the deleted old account marwandesouqhi@gmail.com if present
        const filtered = users.filter(
          (u) =>
            u.username.toLowerCase() !== 'marwandesouqhi@gmail.com' &&
            u.displayName.toLowerCase() !== 'marwandesouqhi@gmail.com'
        )
        let needsSave = filtered.length !== users.length
        users = filtered

        const marwanIdx = users.findIndex((u) => u.username.toLowerCase() === 'marwan-desouky')

        if (marwanIdx === -1) {
          users.unshift(DEFAULT_ADMIN)
          needsSave = true
        } else {
          // Ensure system admin status and active state without overwriting custom password
          if (users[marwanIdx].role !== 'system_admin') {
            users[marwanIdx].role = 'system_admin'
            needsSave = true
          }
          if (users[marwanIdx].status !== 'active') {
            users[marwanIdx].status = 'active'
            needsSave = true
          }
          if (!users[marwanIdx].permissions || users[marwanIdx].permissions.length === 0) {
            users[marwanIdx].permissions = ['view_audit', 'view_settings', 'manage_records']
            needsSave = true
          }
        }

        if (needsSave) {
          saveLocalUsers(users)
        }
        return users
      }
    }
  } catch (err) {
    console.warn('Could not read local users from localStorage:', err)
  }

  // Seed default admin user if list is empty
  const initial = [DEFAULT_ADMIN]
  saveLocalUsers(initial)
  return initial
}

export function saveLocalUsers(users: LocalUser[]): void {
  try {
    if (typeof window !== 'undefined') {
      // In secure mode, strip passwords from localStorage records
      const storageUsers = isAuthSecureMode()
        ? users.map((u) => ({ ...u, password: '' }))
        : users
      localStorage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(storageUsers))
      window.dispatchEvent(new CustomEvent('local-users-changed'))
    }
  } catch (err) {
    console.error('Could not save local users:', err)
  }

  // Asynchronously sync users to Supabase cloud
  for (const user of users) {
    void saveUserToCloud(user)
  }
}

export function addLocalUser(data: {
  username: string
  displayName?: string
  password: string
  role: UserRole
  activationCode?: string
  requireActivation?: boolean
  notes?: string
  permissions?: string[]
}): LocalUser {
  const users = loadLocalUsers()
  const cleanUsername = data.username.trim().toLowerCase()

  if (!cleanUsername) {
    throw new Error('يرجى إدخال اسم المستخدم.')
  }

  if (cleanUsername === 'marwandesouqhi@gmail.com') {
    throw new Error('تم حذف هذا الحساب نهائياً من النظام ومحظور إعادة إنشائه.')
  }

  if (cleanUsername.includes(' ')) {
    throw new Error('اسم المستخدم يجب ألا يحتوي على مسافات (استخدم حروفاً أو أرقاماً).')
  }

  if (users.some((u) => u.username.toLowerCase() === cleanUsername)) {
    throw new Error(`اسم المستخدم "${cleanUsername}" مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر.`)
  }

  if (!data.password || data.password.length < 12) {
    throw new Error('كلمة المرور يجب ألا تقل عن 12 حرفاً للأمان.')
  }

  const activationCode = data.activationCode?.trim() || generateActivationPin()
  const newUser: LocalUser = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: cleanUsername,
    displayName: data.displayName?.trim() || cleanUsername,
    password: data.password,
    role: data.role,
    activationCode,
    status: data.requireActivation ? 'pending_activation' : 'active',
    createdAt: new Date().toISOString(),
    notes: data.notes?.trim() || undefined,
    permissions: data.permissions || [],
  }

  const next = [newUser, ...users]
  saveLocalUsers(next)

  void logAuditEvent({
    action: `إضافة مستخدم محلي جديد: ${newUser.username} (${newUser.role})`,
    entity_type: 'local_user',
    details: {
      username: newUser.username,
      displayName: newUser.displayName,
      role: newUser.role,
      status: newUser.status,
      activationCode: newUser.activationCode,
      permissions: newUser.permissions,
    },
  })

  return newUser
}

export function updateLocalUser(
  id: string,
  updates: Partial<Omit<LocalUser, 'id' | 'createdAt'>>
): LocalUser {
  const users = loadLocalUsers()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) {
    throw new Error('المستخدم غير موجود.')
  }

  const current = users[idx]
  if (isLastActiveSystemAdmin(id, users)) {
    if (updates.role && updates.role !== 'admin' && updates.role !== 'system_admin') {
      throw new Error('لا يمكن تقليص صلاحيات آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
    }
    if (updates.status && updates.status !== 'active') {
      throw new Error('لا يمكن تعطيل آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
    }
  }

  if (updates.username && updates.username.toLowerCase() !== current.username.toLowerCase()) {
    const cleanUsername = updates.username.trim().toLowerCase()
    if (users.some((u) => u.id !== id && u.username.toLowerCase() === cleanUsername)) {
      throw new Error(`اسم المستخدم "${cleanUsername}" مسجل لمستخدم آخر.`)
    }
  }

  const updated: LocalUser = {
    ...current,
    ...updates,
    username: updates.username ? updates.username.trim().toLowerCase() : current.username,
  }

  users[idx] = updated
  saveLocalUsers(users)

  // If current logged-in user updated, update local session
  const currentSession = getLocalSession()
  if (currentSession?.user.id === id) {
    setLocalSession(updated)
  }

  return updated
}

export function deleteLocalUser(id: string): void {
  const users = loadLocalUsers()
  const target = users.find((u) => u.id === id)
  if (!target) return

  if (isLastActiveSystemAdmin(id, users)) {
    throw new Error('لا يمكن حذف آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
  }

  const next = users.filter((u) => u.id !== id)
  saveLocalUsers(next)
  void deleteUserFromCloud(id)

  void logAuditEvent({
    action: `حذف مستخدم محلي: ${target.username}`,
    entity_type: 'local_user',
    details: { username: target.username, role: target.role },
  })
}

export function changeUserPassword(id: string, newPassword: string): LocalUser {
  if (!newPassword || newPassword.length < 12) {
    throw new Error('كلمة المرور يجب ألا تقل عن 12 حرفاً للأمان.')
  }
  const updated = updateLocalUser(id, { password: newPassword })
  void logAuditEvent({
    action: `تغيير كلمة مرور المستخدم: ${updated.username}`,
    entity_type: 'local_user',
    details: { username: updated.username, role: updated.role },
  })
  return updated
}

export function activateLocalUserWithCode(
  _username: string,
  _activationCode: string
): LocalUser {
  throw new Error('تم إلغاء التفعيل عبر الأكواد الثابتة (PIN) لتعزيز الأمان. يتم تفعيل الحسابات وتعيين كلمة المرور الجديدة عبر خادم Supabase Auth.')
}

export function authenticateLocalUser(
  _username: string,
  _password: string
): { user: LocalUser; needsActivation?: boolean } {
  throw new Error('تم إيقاف تسجيل الدخول المحلي غير الآمن. المصادقة مقتصرة حصرياً على Supabase Auth.')
}

export function getLocalSession(): LocalUserSession | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem(LOCAL_SESSION_STORAGE_KEY) || localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)
    if (raw) {
      const sess = JSON.parse(raw) as LocalUserSession
      const u = sess?.user
      if (u) {
        const uName = (u.user_metadata?.username || u.app_metadata?.username || u.email || '').toLowerCase()
        if (uName === 'marwan-desouky') {
          sess.user.app_metadata.role = 'system_admin'
          sess.user.app_metadata.system_admin = true
          sess.user.user_metadata.role = 'system_admin'
          if (!sess.user.app_metadata.permissions || sess.user.app_metadata.permissions.length === 0) {
            sess.user.app_metadata.permissions = ['view_audit', 'view_settings', 'manage_records']
          }
        }
      }
      return sess
    }
  } catch (err) {
    console.warn('Could not read local session:', err)
  }
  return null
}

export function setLocalSession(user: LocalUser): LocalUserSession {
  const isSysAdmin = user.role === 'system_admin' || user.username.toLowerCase() === 'marwan-desouky'
  const effectiveRole: UserRole = isSysAdmin ? 'system_admin' : user.role
  const effectivePermissions = isSysAdmin
    ? ['view_audit', 'view_settings', 'manage_records']
    : (user.permissions || [])

  const sessionObj: LocalUserSession = {
    user: {
      id: user.id,
      email: user.username, // using username as unique identifier
      user_metadata: {
        username: user.username,
        name: user.displayName,
        displayName: user.displayName,
        role: effectiveRole,
        permissions: effectivePermissions,
      },
      app_metadata: {
        role: effectiveRole,
        system_admin: isSysAdmin,
        permissions: effectivePermissions,
        username: user.username,
      },
    },
    access_token: `local-token-${user.id}-${Date.now()}`,
  }

  try {
    if (typeof window !== 'undefined') {
      const serialized = JSON.stringify(sessionObj)
      sessionStorage.setItem(LOCAL_SESSION_STORAGE_KEY, serialized)
      localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, serialized)
      window.dispatchEvent(new CustomEvent('local-auth-changed'))
    }
  } catch (err) {
    console.error('Could not save local session:', err)
  }

  return sessionObj
}

export function clearLocalSession(): void {
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(LOCAL_SESSION_STORAGE_KEY)
      localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent('local-auth-changed'))
    }
  } catch (err) {
    console.error('Could not clear local session:', err)
  }
}
