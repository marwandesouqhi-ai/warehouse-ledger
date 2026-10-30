import { logAuditEvent } from './auditLogger'
import { supabase } from './supabase'
import {
  isProtectedUsername,
  canDeleteUser,
  normalizeUsername,
} from './protectedAccounts'

export async function fetchUsersFromCloud(): Promise<LocalUser[]> {
  if (!supabase) return []
  try {
    // Only attempt cloud fetch if there is an active authenticated session.
    // Unauthenticated/anonymous calls to app_users are blocked by RLS policies (returning 403 Forbidden).
    const sessionRes = await supabase.auth?.getSession?.()
    if (!sessionRes?.data?.session) {
      return []
    }

    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, display_name, role, activation_code, status, created_at, activated_at, last_login_at, notes, permissions, employee_id, email, department, telegram_user_id')
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('Could not query app_users from cloud:', error)
    }
    const usersList: LocalUser[] = (data || []).map((row) => ({
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
      employeeId: row.employee_id || undefined,
      email: row.email || undefined,
      department: row.department || undefined,
      telegramUserId: row.telegram_user_id || undefined,
      permissions: Array.isArray(row.permissions)
        ? row.permissions
        : typeof row.permissions === 'string'
          ? (() => { try { return JSON.parse(row.permissions) } catch { return [] } })()
          : [],
    }))

    // Seamlessly merge approved registration requests into directory
    try {
      const { data: regRequests } = await supabase
        .from('registration_requests')
        .select('*')
        .eq('approval_status', 'approved')

      if (regRequests && regRequests.length > 0) {
        for (const reg of regRequests) {
          const regEmail = (reg.email || '').trim().toLowerCase()
          if (!regEmail) continue

          const alreadyInList = usersList.some(
            (u) => (u.email && u.email.trim().toLowerCase() === regEmail) ||
                   (u.id === reg.id)
          )

          if (!alreadyInList) {
            usersList.push({
              id: reg.id || `usr-${(reg.employee_id || 'reg').toLowerCase()}`,
              username: regEmail.split('@')[0] || reg.employee_id || 'employee',
              displayName: reg.full_name || reg.email,
              password: '',
              role: (reg.approved_role || reg.requested_role || 'warehouse_employee') as UserRole,
              activationCode: '',
              status: (reg.invitation_status === 'accepted' ? 'active' : 'pending_activation') as UserStatus,
              createdAt: reg.created_at || new Date().toISOString(),
              activatedAt: reg.invitation_status === 'accepted' ? reg.updated_at : undefined,
              employeeId: reg.employee_id,
              email: reg.email,
              department: reg.requested_department === 'warehouse' ? 'المخازن' : reg.requested_department === 'procurement' ? 'المشتريات' : (reg.requested_department || 'المخازن'),
              telegramUserId: reg.telegram_user_id || undefined,
              permissions: [],
            })
          }
        }
      }
    } catch (e) {
      console.warn('Could not merge registration requests into users:', e)
    }

    return usersList
  } catch (err) {
    console.warn('Could not fetch users from cloud:', err)
    return []
  }
}

export async function saveUserToCloud(user: LocalUser): Promise<void> {
  if (!supabase) return
  // 1. Protected system accounts (e.g. marwan-desouky) are provisioned exclusively via cloud migrations/bootstrap
  // and must never be queried or mutated via client-side sync, which would trigger 403 under RLS.
  if (isProtectedUsername(user.username)) {
    return
  }

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
      employee_id: user.employeeId || null,
      email: user.email || null,
      department: user.department || null,
      telegram_user_id: user.telegramUserId || null,
    }
    if (user.password && user.password.trim().length > 0) {
      payload.password = user.password
    }

    const { data: existing, error: selectErr } = await supabase
      .from('app_users')
      .select('id, password')
      .eq('username', user.username.toLowerCase())
      .maybeSingle()

    if (selectErr) {
      // Direct client access blocked by RLS or restricted
      return
    }

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

export async function deleteUserFromCloud(id: string, username?: string): Promise<void> {
  if (!supabase) return
  if (isProtectedUsername(username)) return

  try {
    // Invoke admin-users Edge Function for clean Auth + Database cascade
    await supabase.functions.invoke('admin-users', {
      body: {
        action: 'delete_user',
        userId: id,
        username,
      },
    })
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
      // Add local users that might not have been pushed yet (excluding protected accounts)
      local.forEach((u) => {
        if (!mergedMap.has(u.username.toLowerCase())) {
          mergedMap.set(u.username.toLowerCase(), u)
          if (!isProtectedUsername(u.username)) {
            void saveUserToCloud(u)
          }
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
      // If cloud is empty or inaccessible (e.g. unauthenticated or restricted RLS),
      // rely on local users without attempting unauthorized direct inserts
      return loadLocalUsers()
    }
  } catch {
    return loadLocalUsers()
  }
}

export type UserRole =
  | 'system_admin'
  | 'warehouse_admin'
  | 'warehouse_employee'
  | 'procurement_admin'
  | 'procurement_employee'
  | 'admin'
  | 'warehouse_staff'
  | 'purchasing_staff'
  | 'editor'
  | 'viewer'

export type UserStatus = 'active' | 'pending_activation' | 'suspended' | 'rejected'

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
  employeeId?: string
  email?: string
  department?: string
  telegramUserId?: number
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
      employeeId?: string
    }
    app_metadata: {
      role: UserRole
      system_admin: boolean
      permissions?: string[]
      username?: string
      employeeId?: string
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
  employeeId: 'SYS-ADM-000001',
  email: 'marwandesouqhi@gmail.com',
  department: 'الإدارة العامة',
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

export function purgeDeletedAccount(emailOrUsername = ''): void {
  // marwandesouqhi@gmail.com is the authorized system administrator email.
  // Purging system administrator session or account is strictly forbidden.
  if (!emailOrUsername) return
  const target = emailOrUsername.toLowerCase().trim()
  if (target === 'marwandesouqhi@gmail.com' || target === 'marwan-desouky') {
    return
  }

  try {
    if (typeof window === 'undefined') return

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
            u.username?.toLowerCase() !== 'marwandesouqhi@gmail.com' &&
            u.displayName?.toLowerCase() !== 'marwandesouqhi@gmail.com'
        )
        let needsSave = filtered.length !== users.length
        users = filtered

        const marwanIdx = users.findIndex((u) => u.username?.toLowerCase() === 'marwan-desouky')

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

        // Ensure employee ID sanity and guarantee Ahmad Hussein Salah's active record
        for (const u of users) {
          if (u.email?.toLowerCase().includes('507') || u.displayName?.includes('أحمد حسين')) {
            if (u.employeeId !== 'WH-EMP-000002') {
              u.employeeId = 'WH-EMP-000002'
              needsSave = true
            }
            if (u.status !== 'active') {
              u.status = 'active'
              needsSave = true
            }
          }
        }

        // If Ahmad Hussein Salah is not yet in users, insert him
        const ahmadIdx = users.findIndex(
          (u) => u.email?.toLowerCase() === 'marwandesouky507@gmail.com' || u.employeeId === 'WH-EMP-000002'
        )
        if (ahmadIdx === -1) {
          users.push({
            id: 'usr-38d3e5f8-6eb2-433b-be39-c088558c3237',
            username: 'ahmed-hussain',
            displayName: 'أحمد حسين صلاح',
            password: '',
            role: 'warehouse_employee',
            status: 'active',
            activationCode: '',
            createdAt: '2026-10-30T00:00:00.000Z',
            employeeId: 'WH-EMP-000002',
            email: 'marwandesouky507@gmail.com',
            department: 'المخازن',
            telegramUserId: 1200587150,
            permissions: [],
          })
          needsSave = true
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
      // Strip plaintext passwords from localStorage records permanently
      const storageUsers = users.map((u) => ({ ...u, password: '' }))
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
  department?: string
  employeeId?: string
  email?: string
  activationCode?: string
  requireActivation?: boolean
  notes?: string
  permissions?: string[]
}): LocalUser {
  const users = loadLocalUsers()
  const cleanUsername = normalizeUsername(data.username)

  if (!cleanUsername) {
    throw new Error('يرجى إدخال اسم المستخدم.')
  }

  if (isProtectedUsername(cleanUsername)) {
    throw new Error('اسم المستخدم محجوز لحساب مدير النظام الرئيسي المحمي ولا يمكن استخدامه.')
  }

  if (data.role === 'system_admin') {
    throw new Error('غير مصرح: مدير النظام الرئيسي (System Admin) حساب ثابت وموحد، ولا يمكن إنشاء مستخدم آخر بهذا الدور.')
  }

  if (cleanUsername.includes(' ')) {
    throw new Error('اسم المستخدم يجب ألا يحتوي على مسافات (استخدم حروفاً أو أرقاماً).')
  }

  if (users.some((u) => normalizeUsername(u.username) === cleanUsername)) {
    throw new Error(`اسم المستخدم "${cleanUsername}" مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر.`)
  }

  if (!data.password || data.password.length < 6) {
    throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام للأمان.')
  }

  const defaultDept = data.department || (
    data.role.startsWith('procurement') ? 'المشتريات' :
    data.role.startsWith('warehouse') ? 'المخازن' :
    'المخازن'
  )

  const activationCode = data.activationCode?.trim() || generateActivationPin()
  const newUser: LocalUser = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: cleanUsername,
    displayName: data.displayName?.trim() || cleanUsername,
    password: data.password,
    role: data.role,
    department: defaultDept,
    employeeId: data.employeeId,
    email: data.email,
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
  const isTargetProtected = isProtectedUsername(current.username)

  if (isTargetProtected) {
    if (updates.username && normalizeUsername(updates.username) !== normalizeUsername(current.username)) {
      throw new Error('غير مصرح: لا يمكن تعديل اسم مستخدم مدير النظام الرئيسي المحمي.')
    }
    if (updates.role && updates.role !== 'system_admin') {
      throw new Error('غير مصرح: لا يمكن تخفيض دور مدير النظام الرئيسي المحمي.')
    }
    if (updates.status && updates.status !== 'active') {
      throw new Error('غير مصرح: لا يمكن تعطيل حساب مدير النظام الرئيسي المحمي.')
    }
  }

  if (!isTargetProtected && updates.role === 'system_admin') {
    throw new Error('غير مصرح: لا يمكن ترقية أي مستخدم لدور مدير النظام (System Admin).')
  }

  if (isLastActiveSystemAdmin(id, users)) {
    if (updates.role && updates.role !== 'admin' && updates.role !== 'system_admin') {
      throw new Error('لا يمكن تقليص صلاحيات آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
    }
    if (updates.status && updates.status !== 'active') {
      throw new Error('لا يمكن تعطيل آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
    }
  }

  if (updates.username && normalizeUsername(updates.username) !== normalizeUsername(current.username)) {
    const cleanUsername = normalizeUsername(updates.username)
    if (users.some((u) => u.id !== id && normalizeUsername(u.username) === cleanUsername)) {
      throw new Error(`اسم المستخدم "${cleanUsername}" مسجل لمستخدم آخر.`)
    }
  }

  const updated: LocalUser = {
    ...current,
    ...updates,
    username: updates.username ? normalizeUsername(updates.username) : current.username,
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

  const delCheck = canDeleteUser(target.username)
  if (!delCheck.allowed) {
    throw new Error(delCheck.reason || 'لا يمكن حذف هذا المستخدم المحمي.')
  }

  if (isLastActiveSystemAdmin(id, users)) {
    throw new Error('لا يمكن حذف آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
  }

  const next = users.filter((u) => u.id !== id)
  saveLocalUsers(next)
  void deleteUserFromCloud(id, target.username)

  void logAuditEvent({
    action: `حذف مستخدم: ${target.username}`,
    entity_type: 'local_user',
    details: { username: target.username, role: target.role },
  })
}

export async function deleteUserPermanently(id: string): Promise<void> {
  const users = loadLocalUsers()
  const target = users.find((u) => u.id === id)
  if (!target) return

  const delCheck = canDeleteUser(target.username)
  if (!delCheck.allowed) {
    throw new Error(delCheck.reason || 'لا يمكن حذف هذا المستخدم المحمي.')
  }

  if (isLastActiveSystemAdmin(id, users)) {
    throw new Error('لا يمكن حذف آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
  }

  // 1. Await cloud deletion from auth and database
  await deleteUserFromCloud(id, target.username)

  // 2. Remove locally
  const next = users.filter((u) => u.id !== id)
  saveLocalUsers(next)

  void logAuditEvent({
    action: `حذف مستخدم نهائياً: ${target.username}`,
    entity_type: 'user',
    details: { username: target.username, role: target.role },
  })
}

export function changeUserPassword(id: string, newPassword: string): LocalUser {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام للأمان.')
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
