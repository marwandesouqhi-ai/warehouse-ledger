/**
 * src/lib/protectedAccounts.ts
 *
 * Centralized protection logic for fixed System Admin (marwan-desouky) and root admin.
 * Enforces username reservation, NFKC normalization, homoglyph resistance,
 * and immutable role/profile protections.
 */

export const PROTECTED_SYSTEM_ADMIN_USERNAME = 'marwan-desouky'
export const PROTECTED_SYSTEM_ADMIN_SYNTHETIC_EMAIL = 'marwan-desouky@warehouse.local'
export const PROTECTED_SYSTEM_ADMIN_LEGACY_EMAIL = 'marwandesouqhi@gmail.com'
export const PROTECTED_ROOT_ADMIN_USERNAME = 'admin'

export const RESERVED_PROTECTED_USERNAMES: readonly string[] = Object.freeze([
  PROTECTED_SYSTEM_ADMIN_USERNAME,
  PROTECTED_SYSTEM_ADMIN_SYNTHETIC_EMAIL,
  PROTECTED_SYSTEM_ADMIN_LEGACY_EMAIL,
])

/**
 * Normalizes username input:
 * 1. Trims whitespace
 * 2. Converts to lowercase
 * 3. Normalizes via Unicode NFKC
 * 4. Strips invisible/zero-width characters
 * 5. Replaces lookalike dashes (en-dash, em-dash, minus sign) with standard hyphen
 * 6. Maps common Cyrillic/Greek homoglyphs to Latin equivalents
 */
export function normalizeUsername(input: string | null | undefined): string {
  if (!input) return ''

  let normalized = String(input)
    .trim()
    .toLowerCase()
    .normalize('NFKC')

  // Remove zero-width and invisible characters
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u202A-\u202E]/g, '')

  // Normalize hyphen variants to standard ASCII hyphen
  normalized = normalized.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')

  // Map common Cyrillic lookalikes to Latin
  const homoglyphs: Record<string, string> = {
    'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y',
    'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
    'α': 'a', 'ο': 'o', 'υ': 'u',
  }
  normalized = normalized.replace(/[асеорхуіјѕԁԛԝαου]/g, (char) => homoglyphs[char] || char)

  return normalized
}

/**
 * Checks if the given username/email matches the protected System Admin account.
 */
export function isProtectedUsername(usernameOrEmail: string | null | undefined): boolean {
  if (!usernameOrEmail) return false
  const clean = normalizeUsername(usernameOrEmail)

  for (const reserved of RESERVED_PROTECTED_USERNAMES) {
    if (clean === normalizeUsername(reserved)) {
      return true
    }
  }

  // Also check if synthetic email format matches
  if (clean.endsWith('@warehouse.local')) {
    const prefix = clean.replace(/@warehouse\.local$/, '')
    if (prefix === PROTECTED_SYSTEM_ADMIN_USERNAME) {
      return true
    }
  }

  return false
}

/**
 * Checks if username is the default root admin ('admin').
 * Retains protection from deletion & demotion without being hidden.
 */
export function isRootAdmin(usernameOrEmail: string | null | undefined): boolean {
  if (!usernameOrEmail) return false
  const clean = normalizeUsername(usernameOrEmail)
  return clean === PROTECTED_ROOT_ADMIN_USERNAME || clean === `${PROTECTED_ROOT_ADMIN_USERNAME}@warehouse.local`
}

/**
 * Validates whether a user can be deleted.
 */
export function canDeleteUser(targetUsername: string): { allowed: boolean; reason?: string } {
  if (isProtectedUsername(targetUsername)) {
    return {
      allowed: false,
      reason: 'حساب مدير النظام الرئيسي (marwan-desouky) محمي بشكل كامل ودائم، ولا يمكن حذفه نهائياً من النظام.',
    }
  }
  if (isRootAdmin(targetUsername)) {
    return {
      allowed: false,
      reason: 'حساب المشرف الرئيسي (admin) محمي من الحذف.',
    }
  }
  return { allowed: true }
}

/**
 * Validates whether target user fields can be modified.
 */
export function canModifyUser(
  targetUsername: string,
  callerUsername: string,
  _isCallerSystemAdmin: boolean,
  updatedFields: {
    username?: string
    role?: string
    status?: string
    permissions?: unknown
    password?: string
  }
): { allowed: boolean; reason?: string } {
  const isTargetProtected = isProtectedUsername(targetUsername)
  const isCallerSelf = normalizeUsername(callerUsername) === normalizeUsername(targetUsername)

  if (isTargetProtected) {
    if (!isCallerSelf) {
      return {
        allowed: false,
        reason: 'لا يمكن تعديل بيانات حساب مدير النظام الرئيسي إلا بواسطة صاحب الحساب نفسه.',
      }
    }

    // Even caller himself cannot change his core protected role or username
    if (updatedFields.username && normalizeUsername(updatedFields.username) !== PROTECTED_SYSTEM_ADMIN_USERNAME) {
      return {
        allowed: false,
        reason: 'لا يمكن تغيير اسم مستخدم مدير النظام الرئيسي المحمي.',
      }
    }
    if (updatedFields.role && updatedFields.role !== 'system_admin') {
      return {
        allowed: false,
        reason: 'لا يمكن تخفيض دور مدير النظام الرئيسي المحمي.',
      }
    }
    if (updatedFields.status && updatedFields.status !== 'active') {
      return {
        allowed: false,
        reason: 'لا يمكن تعطيل حساب مدير النظام الرئيسي المحمي.',
      }
    }
  }

  // Prevent demoting root admin if not allowed
  if (isRootAdmin(targetUsername) && updatedFields.role && updatedFields.role !== 'admin' && updatedFields.role !== 'system_admin') {
    return {
      allowed: false,
      reason: 'لا يمكن تخفيض صلاحيات المشرف الرئيسي (admin).',
    }
  }

  // Enforce sole system admin rule: nobody else can be created as or promoted to system_admin
  if (!isTargetProtected && updatedFields.role === 'system_admin') {
    return {
      allowed: false,
      reason: 'لا يمكن تعيين أو ترقية مستخدم آخر لدور مدير النظام (System Admin). يمكن منح صلاحيات إضافية محددة بدلاً من ذلك.',
    }
  }

  return { allowed: true }
}
