import { logAuditEvent } from './auditLogger'
import { supabase } from './supabase'
import type { PersistenceOutcome } from './settings'
import {
  isProtectedUsername,
  canDeleteUser,
  normalizeUsername,
  PROTECTED_SYSTEM_ADMIN_LEGACY_EMAIL,
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

export async function saveUserToCloud(user: LocalUser): Promise<PersistenceOutcome> {
  if (!supabase) throw new Error('خدمة حفظ المستخدمين غير متاحة.')
  // 1. Protected system accounts (e.g. marwan-desouky) are provisioned exclusively via cloud migrations/bootstrap
  // and must never be queried or mutated via client-side sync, which would trigger 403 under RLS.
  if (isProtectedUsername(user.username)) {
    return { status: 'saved_to_cloud' }
  }

  try {
    const payload: Record<string, unknown> = {
      id: user.id,
      username: user.username.toLowerCase(),
      display_name: user.displayName,
      role: user.role,
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

    const { data: existing, error: selectErr } = await supabase
      .from('app_users')
      .select('id')
      .eq('username', user.username.toLowerCase())
      .maybeSingle()

    if (selectErr) {
      return { status: 'saved_locally', error: `خطأ في قراءة بيانات المستخدم سحابياً: ${selectErr.message}` }
    }

    if (existing) {
      const { error: updateErr } = await supabase.from('app_users').update(payload).eq('id', existing.id)
      if (updateErr) {
        return { status: 'saved_locally', error: `تعذر تحديث بيانات المستخدم سحابياً: ${updateErr.message}` }
      }
    } else {
      const { error: insertErr } = await supabase.from('app_users').insert(payload)
      if (insertErr) {
        return { status: 'saved_locally', error: `تعذر إضافة المستخدم سحابياً: ${insertErr.message}` }
      }
    }
    return { status: 'saved_to_cloud' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'تعذر حفظ المستخدم في السحابة'
    console.warn('Could not save user to cloud:', err)
    return { status: 'saved_locally', error: msg }
  }
}

export async function deleteUserFromCloud(id: string, username?: string, email?: string): Promise<void> {
  if (!supabase) throw new Error('خدمة حذف المستخدمين غير متاحة.')
  if (isProtectedUsername(username)) throw new Error('لا يمكن حذف الحساب المحمي.')
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action: 'delete_user', userId: id, username, email },
  })
  if (error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const detail: unknown = await context.clone().json().catch(() => null)
      if (detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string') {
        throw new Error(detail.error)
      }
    }
    throw error
  }
  if (!data?.success) throw new Error(data?.error || 'تعذر تأكيد حذف المستخدم.')

}

export async function syncUsersWithCloud(): Promise<LocalUser[]> {
  if (!supabase) throw new Error('خدمة المستخدمين غير متاحة.')
  const users: LocalUser[] = []
  for (let page = 1; ; page++) {
    let { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'list_users', page, perPage: 100 } })
    // The edge function can answer 503/network errors while it cold-starts; retry once before giving up.
    if (error) {
      await new Promise((resolve) => setTimeout(resolve, 900))
      ;({ data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'list_users', page, perPage: 100 } }))
    }
    if (error) throw error
    if (!data?.success || !Array.isArray(data.users)) throw new Error('تعذر تحميل المستخدمين.')
    users.push(...data.users.map((u: LocalUser) => ({ ...u, password: '', activationCode: '' })))
    if (data.users.length < 100) break
  }
  saveLocalUsers(users)
  return users
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
  if (target === PROTECTED_SYSTEM_ADMIN_LEGACY_EMAIL || target === 'marwan-desouky') {
    return
  }

  try {
    if (typeof window === 'undefined') return

    localStorage.removeItem(LOCAL_USERS_STORAGE_KEY)
    sessionStorage.removeItem(LOCAL_USERS_STORAGE_KEY)

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
  // Generate a cryptographically random 6-digit numeric activation code
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return String(100000 + (buf[0] % 900000))
  }
  return String(100000 + Math.floor(Math.random() * 900000))
}

let directoryUsers: LocalUser[] = []
export function loadLocalUsers(): LocalUser[] {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(LOCAL_USERS_STORAGE_KEY)
    sessionStorage.removeItem(LOCAL_USERS_STORAGE_KEY)
  }
  return directoryUsers.map((u) => ({ ...u }))
}
export function saveLocalUsers(users: LocalUser[]): void {
  loadLocalUsers()
  directoryUsers = users.map((u) => ({ ...u, password: '' }))
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

  // Auto-allocate unique employeeId if not provided
  let allocatedEmpId = data.employeeId
  if (!allocatedEmpId) {
    const prefix = (data.role === 'warehouse_admin' || data.role === 'admin') ? 'WH-ADM'
      : data.role === 'procurement_admin' ? 'PUR-ADM'
      : data.role === 'procurement_employee' ? 'PUR-EMP'
      : data.role === 'viewer' ? 'WH-VIE'
      : 'WH-EMP'
    let maxNum = 0
    for (const u of users) {
      if (u.employeeId && u.employeeId.toUpperCase().startsWith(`${prefix}-`)) {
        const m = u.employeeId.match(/(\d+)$/)
        if (m) {
          const n = parseInt(m[1], 10)
          if (n > maxNum) maxNum = n
        }
      }
    }
    allocatedEmpId = `${prefix}-${String(maxNum + 1).padStart(6, '0')}`
  }

  const randomIdSuffix =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : `${Date.now()}`
  const newUser: LocalUser = {
    id: `usr-${Date.now()}-${randomIdSuffix}`,
    username: cleanUsername,
    displayName: data.displayName?.trim() || cleanUsername,
    password: data.password,
    role: data.role,
    department: defaultDept,
    employeeId: allocatedEmpId,
    email: data.email,
    activationCode: '',
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

export async function deleteUserPermanently(id: string, selectedUser?: LocalUser): Promise<void> {
  const users = loadLocalUsers()
  const target = selectedUser?.id === id ? selectedUser : users.find((u) => u.id === id)
  if (!target) throw new Error('تعذر العثور على بيانات المستخدم المطلوب حذفه.')

  const delCheck = canDeleteUser(target.username)
  if (!delCheck.allowed) {
    throw new Error(delCheck.reason || 'لا يمكن حذف هذا المستخدم المحمي.')
  }

  if (isLastActiveSystemAdmin(id, users)) {
    throw new Error('لا يمكن حذف آخر مدير نظام نشط في المؤسسة دون تعيين مدير بديل أولاً.')
  }

  // 1. Await cloud deletion from auth and database
  await deleteUserFromCloud(id, target.username, target.email)

  const remainingUsers = await syncUsersWithCloud()
  if (remainingUsers.some((u) => u.id === id || u.username.toLowerCase() === target.username.toLowerCase())) {
    throw new Error('الخادم ما زال يعرض الحساب بعد طلب الحذف؛ لم يتم تأكيد الحذف.')
  }
  // 2. The directory was just replaced with the authoritative server list by syncUsersWithCloud(), so nothing is left to
  //    remove locally. (Writing back a list captured before the sync would resurrect already-deleted accounts.)

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
        // Security hardened: strictly respect signed app_metadata, never forge roles from user_metadata or unverified username
        const appMetaRole = u.app_metadata?.role
        const isSysAdmin = appMetaRole === 'system_admin' || u.app_metadata?.system_admin === true
        if (isSysAdmin) {
          sess.user.app_metadata.role = 'system_admin'
          sess.user.app_metadata.system_admin = true
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
  const isSysAdmin = user.role === 'system_admin'
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
