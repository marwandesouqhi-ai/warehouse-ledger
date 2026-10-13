/**
 * src/lib/permissions.ts
 *
 * مركز واحد لكل منطق الصلاحيات والأدوار في النظام.
 * كل الدوال هنا pure functions — لا side effects، لا استدعاءات خارجية.
 *
 * قواعد التوافق الرجعي:
 * - الأدوار القديمة (admin, editor, viewer) تبقى صالحة بدون أي تحديث في قاعدة البيانات
 * - التحويل يتم وقت القراءة فقط داخل normalizeRole()
 * - القيم المخزنة في app_users أو localStorage لا تتغير
 */

import type { Session } from '@supabase/supabase-js'
import type { LocalUserSession } from './localUsers'

// ─── الأنواع الجديدة ──────────────────────────────────────────────────────────

/**
 * الدور الفعلي المحسوب — يختلف عن القيمة المخزنة في قاعدة البيانات
 * القيم القديمة (admin, editor, viewer) تبقى للتوافق الرجعي
 */
export type EffectiveRole =
  | 'system_admin'     // مدير النظام — موثق عبر app_metadata فقط
  | 'admin'            // أدمن عادي — يشوف كل شيء ما عدا audit/users/settings
  | 'warehouse_staff'  // موظف مخازن — صفحات المخازن والعهدة والمنصرف
  | 'purchasing_staff' // موظف مشتريات — صفحات المشتريات فقط
  | 'editor'           // محرر (توافق رجعي) — يعمل كـ warehouse_staff عند القراءة
  | 'viewer'           // مشاهد — قراءة فقط

/**
 * الصلاحيات الإضافية — يمنحها السيستم أدمن لأي مستخدم بصرف النظر عن دوره
 */
export type Permission =
  | 'view_audit'       // عرض سجل العمليات
  | 'view_settings'    // عرض وتعديل الإعدادات
  | 'manage_records'   // تعديل وحذف السجلات

/**
 * نطاق المشتريات — نطاق الوحدة بالكامل
 */
export type PurchasesScope = 'all'
export const PURCHASES_SCOPE: PurchasesScope = 'all'

// ─── الأسماء العربية للأدوار ──────────────────────────────────────────────────

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  system_admin: 'مدير النظام',
  admin: 'أدمن',
  warehouse_staff: 'موظف مخازن',
  purchasing_staff: 'موظف مشتريات',
  editor: 'محرر مخزن',
  viewer: 'مشاهد (قراءة)',
}

/** الأدوار التي يمكن للسيستم أدمن اختيارها لأي مستخدم */
export const ASSIGNABLE_ROLES: Array<{ value: EffectiveRole; label: string }> = [
  { value: 'admin', label: 'أدمن' },
  { value: 'warehouse_staff', label: 'موظف مخازن' },
  { value: 'purchasing_staff', label: 'موظف مشتريات' },
  { value: 'editor', label: 'محرر مخزن' },
  { value: 'viewer', label: 'مشاهد (قراءة فقط)' },
]

/** تعريفات الصلاحيات الإضافية بأسمائها العربية */
export const PERMISSION_LABELS: Record<Permission, string> = {
  view_audit: 'عرض سجل العمليات والتدقيق',
  view_settings: 'عرض وتعديل إعدادات المؤسسة',
  manage_records: 'تعديل وحذف السجلات والحركات',
}

// ─── مصفوفة الوصول للراوتس ────────────────────────────────────────────────────

const ROUTE_ACCESS: Record<string, EffectiveRole[]> = {
  '/':          ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor', 'viewer'],
  '/purchases': ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor'],
  '/custody':   ['system_admin', 'admin', 'warehouse_staff', 'editor'],
  '/reports':   ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor'],
  '/imports':   ['system_admin', 'admin', 'purchasing_staff'],
  '/quality':   ['system_admin', 'admin', 'warehouse_staff', 'editor'],
  '/audit':     ['system_admin'],   // يُفتح أيضاً بصلاحية view_audit
  '/users':     ['system_admin'],
  '/settings':  ['system_admin'],   // يُفتح أيضاً بصلاحية view_settings
  // إعادة توجيه من الراوتس القديمة — يُعامل نفس /purchases
  '/movements': ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor'],
}

// ─── الدوال الأساسية ──────────────────────────────────────────────────────────

/**
 * normalizeRole — تحويل الدور المخزن إلى الدور الفعلي وقت القراءة.
 *
 * ⚠️ لا يعتمد أبداً على اسم المستخدم لتصعيد الصلاحيات.
 *
 * @param storedRole - الدور المخزن في app_users أو app_metadata
 * @param _username - اختياري (لا يُستخدم لتحديد الصلاحية لمنع تصعيد الصلاحيات بالاسم)
 * @param _extraPermissions - الصلاحيات الإضافية الممنوحة للمستخدم
 */
export function normalizeRole(
  storedRole: string,
  _username?: string,
  _extraPermissions?: string[]
): EffectiveRole {
  // دور system_admin مخزن صراحةً
  if (storedRole === 'system_admin') return 'system_admin'

  // أدوار جديدة صريحة
  if (storedRole === 'warehouse_staff') return 'warehouse_staff'
  if (storedRole === 'purchasing_staff') return 'purchasing_staff'

  // أدوار قديمة — توافق رجعي
  if (storedRole === 'admin') return 'admin'
  if (storedRole === 'editor') return 'editor'
  if (storedRole === 'viewer') return 'viewer'

  // fallback
  return 'viewer'
}

/**
 * getEffectiveRole — استخراج الدور الفعلي من الجلسة الحالية.
 *
 * أمان: يعتمد حصرياً على app_metadata الموقعة من السيرفر، ويتجاهل تماماً user_metadata
 * واسم المستخدم لمنع أي تصعيد صلاحيات.
 */
export function getEffectiveRole(
  session: Session | LocalUserSession | null | undefined
): EffectiveRole {
  if (!session) return 'viewer'

  const user = 'user' in session ? session.user : null
  if (!user) return 'viewer'

  const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata) || {}
  const rawEmail = (user as { email?: string }).email || ''
  const cleanUsername = String(appMeta.username || rawEmail.replace(/@warehouse\.local$/i, '')).trim()

  // 1. فحص راية system_admin أو role الموقعة في app_metadata
  if (appMeta.system_admin === true || appMeta.role === 'system_admin') return 'system_admin'

  // 2. استخراج الدور من app_metadata فقط (ممنوع user_metadata وممنوع الاعتماد على اسم المستخدم)
  const storedRole: string = (appMeta.role as string) || 'viewer'

  // الصلاحيات الإضافية من app_metadata فقط
  const permissions: string[] = Array.isArray(appMeta.permissions)
    ? (appMeta.permissions as string[])
    : []

  return normalizeRole(storedRole, cleanUsername, permissions)
}

/**
 * getExtraPermissions — استخراج الصلاحيات الإضافية من الجلسة.
 *
 * أمان: يقرأ حصرياً من app_metadata الموثوقة.
 */
export function getExtraPermissions(
  session: Session | LocalUserSession | null | undefined
): Permission[] {
  if (!session) return []
  const user = 'user' in session ? session.user : null
  if (!user) return []

  const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata) || {}
  const raw = appMeta.permissions
  if (!Array.isArray(raw)) return []

  return raw.filter((p): p is Permission =>
    p === 'view_audit' || p === 'view_settings' || p === 'manage_records'
  )
}

/**
 * isSystemAdmin — هل الجلسة الحالية لسيستم أدمن؟
 *
 * يستبدل checkIsSystemAdmin القديم (مع إصلاح الـ bug).
 */
export function isSystemAdmin(
  session: Session | LocalUserSession | null | undefined
): boolean {
  return getEffectiveRole(session) === 'system_admin'
}

/**
 * can — هل المستخدم يملك الصلاحية المطلوبة؟
 *
 * السيستم أدمن يملك كل الصلاحيات دائماً.
 * الصلاحيات الإضافية تُفتح بصرف النظر عن الدور.
 */
export function can(
  session: Session | LocalUserSession | null | undefined,
  permission: Permission
): boolean {
  const role = getEffectiveRole(session)

  // السيستم أدمن يملك كل شيء
  if (role === 'system_admin') return true

  // فحص الصلاحيات الإضافية
  const extra = getExtraPermissions(session)
  if (extra.includes(permission)) return true

  return false
}

/**
 * canCreatePurchase — هل المستخدم يستطيع إضافة فاتورة شراء؟
 */
export function canCreatePurchase(
  session: Session | LocalUserSession | null | undefined
): boolean {
  const role = getEffectiveRole(session)
  return ['system_admin', 'admin', 'purchasing_staff'].includes(role)
}

/**
 * canCreateDisbursement — هل المستخدم يستطيع إنشاء إذن صرف؟
 */
export function canCreateDisbursement(
  session: Session | LocalUserSession | null | undefined
): boolean {
  const role = getEffectiveRole(session)
  return ['system_admin', 'admin', 'warehouse_staff'].includes(role)
}

/**
 * canViewPage — هل المستخدم يملك صلاحية عرض صفحة معينة في الـ nav؟
 */
export function canViewPage(
  session: Session | LocalUserSession | null | undefined,
  page: 'purchases' | 'custody' | 'reports' | 'imports' | 'quality' | 'audit' | 'users' | 'settings'
): boolean {
  const role = getEffectiveRole(session)
  const extra = getExtraPermissions(session)

  switch (page) {
    case 'purchases':
      return ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor'].includes(role)
    case 'custody':
      return ['system_admin', 'admin', 'warehouse_staff', 'editor'].includes(role)
    case 'reports':
      return ['system_admin', 'admin', 'warehouse_staff', 'purchasing_staff', 'editor'].includes(role)
    case 'imports':
      return ['system_admin', 'admin', 'purchasing_staff'].includes(role)
    case 'quality':
      return ['system_admin', 'admin', 'warehouse_staff', 'editor'].includes(role)
    case 'audit':
      return role === 'system_admin' || extra.includes('view_audit')
    case 'users':
      return role === 'system_admin'
    case 'settings':
      return role === 'system_admin' || extra.includes('view_settings')
    default:
      return false
  }
}

/**
 * canAccessRoute — هل المستخدم يملك صلاحية الوصول لمسار معين؟
 *
 * يستخدم في حماية الراوتس (ليس فقط إخفاء الروابط).
 */
export function canAccessRoute(
  session: Session | LocalUserSession | null | undefined,
  path: string
): boolean {
  const role = getEffectiveRole(session)
  const extra = getExtraPermissions(session)

  // نجرد المسار من الـ query string والـ hash
  const cleanPath = path.split('?')[0].split('#')[0]

  // نطابق الراوت (قد يحتوي على segments مثل /purchases/edit/123)
  const baseRoute = Object.keys(ROUTE_ACCESS).find((route) =>
    cleanPath === route || cleanPath.startsWith(route + '/')
  ) || cleanPath

  const allowedRoles = ROUTE_ACCESS[baseRoute]
  if (!allowedRoles) return true // راوت غير معرّف = مسموح (سيتحول 404 بعدين)

  if (allowedRoles.includes(role)) return true

  // فحص الصلاحيات الإضافية للمسارات المحمية
  if (baseRoute === '/audit' && extra.includes('view_audit')) return true
  if (baseRoute === '/settings' && extra.includes('view_settings')) return true

  return false
}

/**
 * getDashboardScope — ماذا يرى المستخدم في لوحة التحكم؟
 */
export function getDashboardScope(
  session: Session | LocalUserSession | null | undefined
): 'full' | 'warehouse_only' | 'purchases_only' {
  const role = getEffectiveRole(session)

  if (role === 'system_admin' || role === 'admin') return 'full'
  if (role === 'purchasing_staff') return 'purchases_only'
  if (role === 'warehouse_staff' || role === 'editor') return 'warehouse_only'
  return 'full' // viewer يرى الكل للقراءة
}
