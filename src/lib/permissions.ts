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
 * القيم القديمة (admin, editor, viewer, warehouse_staff, purchasing_staff) تبقى للتوافق الرجعي
 */
export type EffectiveRole =
  | 'system_admin'         // مدير النظام — موثق عبر app_metadata فقط
  | 'warehouse_admin'      // أدمن المخازن — عرض وطباعة وتصدير فقط
  | 'warehouse_employee'   // موظف مخازن — عمليات المخازن والعهدة والمنصرف
  | 'procurement_admin'    // أدمن المشتريات — عرض وطباعة وتصدير فقط
  | 'procurement_employee' // موظف مشتريات — فواتير الشراء والطلبات المحددة
  | 'admin'                // أدمن عام — يشوف كل شيء ما عدا audit/users/settings
  | 'warehouse_staff'      // موظف مخازن (توافق رجعي)
  | 'purchasing_staff'     // موظف مشتريات (توافق رجعي)
  | 'editor'               // محرر (توافق رجعي) — يعمل كـ warehouse_staff عند القراءة
  | 'viewer'               // مشاهد — قراءة فقط

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

export type BusinessDepartment = 'warehouse' | 'procurement'
type AccessSession = Session | LocalUserSession | string | null | undefined

export function canReadDepartment(session: AccessSession, department: BusinessDepartment): boolean {
  if (!session) return false
  const role = getEffectiveRole(session)
  if (['system_admin', 'admin', 'viewer'].includes(role)) return true
  return department === 'warehouse'
    ? ['warehouse_admin', 'warehouse_employee', 'warehouse_staff', 'editor'].includes(role)
    : ['procurement_admin', 'procurement_employee', 'purchasing_staff'].includes(role)
}

export function canAddDepartment(session: AccessSession, department: BusinessDepartment): boolean {
  return department === 'warehouse' ? canCreateDisbursement(session) : canCreatePurchase(session)
}

export function canModifyRecords(session: AccessSession): boolean {
  return getEffectiveRole(session) === 'system_admin'
}

export function canPrintOrExport(session: AccessSession, department: BusinessDepartment): boolean {
  return canReadDepartment(session, department)
}

// ─── الأسماء العربية للأدوار ──────────────────────────────────────────────────

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  system_admin: 'مدير النظام الرئيسي',
  warehouse_admin: 'أدمن قسم المخازن',
  warehouse_employee: 'موظف مخازن',
  procurement_admin: 'أدمن قسم المشتريات',
  procurement_employee: 'موظف مشتريات',
  admin: 'أدمن عام',
  warehouse_staff: 'موظف مخازن',
  purchasing_staff: 'موظف مشتريات',
  editor: 'محرر مخزن',
  viewer: 'مشاهد (قراءة)',
}

/** الأدوار التي يمكن للسيستم أدمن اختيارها لأي مستخدم */
export const ASSIGNABLE_ROLES: Array<{ value: EffectiveRole; label: string; department?: string }> = [
  { value: 'warehouse_employee', label: 'موظف مخازن', department: 'المخازن' },
  { value: 'warehouse_admin', label: 'أدمن قسم المخازن', department: 'المخازن' },
  { value: 'procurement_employee', label: 'موظف مشتريات', department: 'المشتريات' },
  { value: 'procurement_admin', label: 'أدمن قسم المشتريات', department: 'المشتريات' },
  { value: 'admin', label: 'أدمن عام' },
  { value: 'warehouse_staff', label: 'موظف مخازن (توافق)' },
  { value: 'purchasing_staff', label: 'موظف مشتريات (توافق)' },
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

const ALL_ROLES: EffectiveRole[] = ['system_admin', 'admin', 'viewer', 'warehouse_admin', 'warehouse_employee', 'warehouse_staff', 'editor', 'procurement_admin', 'procurement_employee', 'purchasing_staff']
const WAREHOUSE_ROLES = ALL_ROLES.filter(r => !['procurement_admin', 'procurement_employee', 'purchasing_staff'].includes(r))
const PROCUREMENT_ROLES = ALL_ROLES.filter(r => !['warehouse_admin', 'warehouse_employee', 'warehouse_staff', 'editor'].includes(r))
const ROUTE_ACCESS: Record<string, EffectiveRole[]> = {
  '/': ALL_ROLES, '/reports': ALL_ROLES, '/notifications': ALL_ROLES,
  '/support': ALL_ROLES, '/financial-reports': ALL_ROLES, '/budget': ALL_ROLES,
  '/custody': WAREHOUSE_ROLES, '/requests': WAREHOUSE_ROLES,
  '/analytics': WAREHOUSE_ROLES, '/asset-history': WAREHOUSE_ROLES, '/quality': WAREHOUSE_ROLES,
  '/purchases': PROCUREMENT_ROLES, '/suppliers': PROCUREMENT_ROLES,
  '/quotes': PROCUREMENT_ROLES, '/contracts': PROCUREMENT_ROLES,
  '/movements': ALL_ROLES, '/imports': ALL_ROLES,
  '/audit': ['system_admin'], '/users': ['system_admin'], '/settings': ['system_admin'],
  '/telegram-bot': ['system_admin'], '/chatbot-admin': ['system_admin'],
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

  // أدوار الهيكل الجديد للأقسام
  if (storedRole === 'warehouse_admin') return 'warehouse_admin'
  if (storedRole === 'warehouse_employee') return 'warehouse_employee'
  if (storedRole === 'procurement_admin') return 'procurement_admin'
  if (storedRole === 'procurement_employee') return 'procurement_employee'

  // أدوار موجودة صريحة
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
  session: Session | LocalUserSession | string | null | undefined
): EffectiveRole {
  if (!session) return 'viewer'
  if (typeof session === 'string') return normalizeRole(session)

  const user = (typeof session === 'object' && 'user' in session) ? session.user : null
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
  session: Session | LocalUserSession | string | null | undefined
): Permission[] {
  if (!session || typeof session === 'string') return []
  const user = (typeof session === 'object' && 'user' in session) ? session.user : null
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
  session: Session | LocalUserSession | string | null | undefined,
  permission: Permission
): boolean {
  const role = getEffectiveRole(session)

  // السيستم أدمن يملك كل شيء
  if (role === 'system_admin') return true

  // فحص الصلاحيات الإضافية

  // The role matrix is authoritative. Legacy extra grants cannot turn a
  // read-only administrator or an add-only employee into an editor.
  void permission
  return false
}

/**
 * canCreatePurchase — هل المستخدم يستطيع إضافة فاتورة شراء؟
 */
export function canCreatePurchase(
  session: Session | LocalUserSession | string | null | undefined
): boolean {
  const role = getEffectiveRole(session)
  return ['system_admin', 'procurement_employee', 'purchasing_staff'].includes(role)
}

/**
 * canCreateDisbursement — هل المستخدم يستطيع إنشاء إذن صرف؟
 */
export function canCreateDisbursement(
  session: Session | LocalUserSession | string | null | undefined
): boolean {
  const role = getEffectiveRole(session)
  return ['system_admin', 'warehouse_employee', 'warehouse_staff', 'editor'].includes(role)
}

/**
 * canAccessProcurementModule — هل المستخدم مصرح له بالدخول لصفحات موديول المشتريات الجديد؟
 * مقتصر حصرياً على موظفي ومشرفي المشتريات والأدمن العام ومدير النظام.
 */
export function canAccessProcurementModule(
  session: Session | LocalUserSession | string | null | undefined
): boolean {
  const role = getEffectiveRole(session)
  return ['system_admin', 'admin', 'procurement_admin', 'procurement_employee', 'purchasing_staff'].includes(role)
}

/**
 * canViewPage — هل المستخدم يملك صلاحية عرض صفحة معينة في الـ nav؟
 */
/**
 * canViewPage — هل المستخدم يملك صلاحية عرض صفحة معينة في الـ nav؟
 */
export function canViewPage(
  sessionOrPage: Session | LocalUserSession | string | null | undefined,
  pageOrSession?: string | Session | LocalUserSession | null | undefined
): boolean {
  let session = sessionOrPage
  let page = pageOrSession as string

  const knownPages = ['purchases', 'suppliers', 'quotes', 'contracts', 'custody', 'reports', 'imports', 'quality', 'audit', 'users', 'settings', 'procurement', 'support', 'requests', 'notifications', 'analytics', 'asset_history', 'financial_reports', 'budget', 'telegram_bot', 'chatbot_admin']
  if (typeof sessionOrPage === 'string' && knownPages.includes(sessionOrPage)) {
    page = sessionOrPage
    session = pageOrSession
  }
  if (page === 'procurement') page = 'purchases'

  const routes: Record<string, string> = {
    purchases: '/purchases', suppliers: '/suppliers', quotes: '/quotes',
    custody: '/custody', reports: '/reports', imports: '/imports', quality: '/quality',
    audit: '/audit', users: '/users', settings: '/settings', contracts: '/contracts',
    requests: '/requests', analytics: '/analytics', notifications: '/notifications',
    asset_history: '/asset-history', financial_reports: '/financial-reports',
    budget: '/budget', support: '/support', telegram_bot: '/telegram-bot', chatbot_admin: '/chatbot-admin',
  }
  return routes[page] ? canAccessRoute(session, routes[page]) : false
}

/**
 * canAccessRoute — هل المستخدم يملك صلاحية الوصول لمسار معين؟
 *
 * يستخدم في حماية الراوتس (ليس فقط إخفاء الروابط).
 */
export function canAccessRoute(
  session: Session | LocalUserSession | string | null | undefined,
  path: string
): boolean {
  if (!session) return false
  const role = getEffectiveRole(session)
  const cleanPath = path.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
  if (role === 'system_admin') return true
  if (role === 'viewer') return ['/', '/notifications', '/support'].includes(cleanPath)
  if (/\/(edit|delete)(\/|$)/.test(cleanPath)) return false
  if (cleanPath === '/imports') return false
  if (/\/new$/.test(cleanPath)) {
    return cleanPath.startsWith('/purchases') ? canCreatePurchase(session)
      : canCreateDisbursement(session)
  }
  const baseRoute = Object.keys(ROUTE_ACCESS).sort((a, b) => b.length - a.length)
    .find(route => cleanPath === route || (route !== '/' && cleanPath.startsWith(route + '/')))
  return baseRoute ? ROUTE_ACCESS[baseRoute].includes(role) : false
}

/**
 * getDashboardScope — ماذا يرى المستخدم في لوحة التحكم؟
 */
export function getDashboardScope(
  session: Session | LocalUserSession | string | null | undefined
): 'full' | 'warehouse_only' | 'purchases_only' {
  const role = getEffectiveRole(session)

  if (role === 'system_admin' || role === 'admin') return 'full'
  if (role === 'procurement_admin' || role === 'procurement_employee' || role === 'purchasing_staff') return 'purchases_only'
  if (role === 'warehouse_admin' || role === 'warehouse_employee' || role === 'warehouse_staff' || role === 'editor') return 'warehouse_only'
  return 'full' // viewer يرى الكل للقراءة
}
