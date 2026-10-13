/**
 * tests/unit/permissions.test.ts
 *
 * اختبارات شاملة لنظام الأدوار والصلاحيات المحصّن:
 * - normalizeRole: التحويل الدقيق للأدوار بدون أي تصعيد بالاسم
 * - getEffectiveRole: الاعتماد الحصري على app_metadata
 * - isSystemAdmin: التحقق الصارم من راية النظام الموثقة
 * - can(): الصلاحيات الإضافية
 * - canAccessRoute(): مصفوفة الوصول كاملة
 * - التوافق الرجعي: editor, viewer, admin القديم
 * - اختبارات الأمان ومكافحة تزوير الهوية والصلاحيات
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeRole,
  getEffectiveRole,
  isSystemAdmin,
  can,
  canAccessRoute,
  canCreatePurchase,
  canCreateDisbursement,
  canViewPage,
  type Permission,
} from '../../src/lib/permissions'
import type { LocalUserSession } from '../../src/lib/localUsers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(
  username: string,
  role: string,
  permissions: string[] = [],
  systemAdminFlag?: boolean
): LocalUserSession {
  return {
    user: {
      id: `usr-${username}`,
      email: `${username}@warehouse.local`,
      user_metadata: {
        username,
        name: username,
        displayName: username,
        role: role as 'admin' | 'editor' | 'viewer',
        permissions,
      },
      app_metadata: {
        username,
        role: role as 'admin' | 'editor' | 'viewer',
        system_admin: systemAdminFlag !== undefined ? systemAdminFlag : (role === 'system_admin'),
        permissions,
      },
    },
    access_token: `token-${username}`,
  } as unknown as LocalUserSession
}

// ─── normalizeRole ────────────────────────────────────────────────────────────

describe('normalizeRole', () => {
  it('لا يتم رفع صلاحيات marwan-desouky تلقائياً إلى system_admin بالاسم فقط', () => {
    expect(normalizeRole('viewer', 'marwan-desouky')).toBe('viewer')
    expect(normalizeRole('editor', 'marwan-desouky')).toBe('editor')
    expect(normalizeRole('admin', 'marwan-desouky')).toBe('admin')
  })

  it('لا يتم رفع صلاحيات admin (اسم المستخدم) تلقائياً بالاسم فقط', () => {
    expect(normalizeRole('viewer', 'admin')).toBe('viewer')
    expect(normalizeRole('editor', 'admin')).toBe('editor')
  })

  it('admin عادي = admin', () => {
    expect(normalizeRole('admin', 'ahmed')).toBe('admin')
    expect(normalizeRole('admin', 'mohamed')).toBe('admin')
  })

  it('دور system_admin مخزن صراحةً = system_admin', () => {
    expect(normalizeRole('system_admin', 'ahmed')).toBe('system_admin')
    expect(normalizeRole('system_admin', 'marwan-desouky')).toBe('system_admin')
  })

  it('warehouse_staff = warehouse_staff', () => {
    expect(normalizeRole('warehouse_staff', 'ahmed')).toBe('warehouse_staff')
  })

  it('purchasing_staff = purchasing_staff', () => {
    expect(normalizeRole('purchasing_staff', 'ahmed')).toBe('purchasing_staff')
  })

  it('editor = editor (توافق رجعي)', () => {
    expect(normalizeRole('editor', 'ahmed')).toBe('editor')
  })

  it('viewer = viewer (توافق رجعي)', () => {
    expect(normalizeRole('viewer', 'ahmed')).toBe('viewer')
  })

  it('دور غير معروف = viewer (fallback)', () => {
    expect(normalizeRole('superadmin', 'ahmed')).toBe('viewer')
    expect(normalizeRole('', 'ahmed')).toBe('viewer')
    expect(normalizeRole('unknown', 'ahmed')).toBe('viewer')
  })
})

// ─── getEffectiveRole ─────────────────────────────────────────────────────────

describe('getEffectiveRole', () => {
  it('null session = viewer', () => {
    expect(getEffectiveRole(null)).toBe('viewer')
    expect(getEffectiveRole(undefined)).toBe('viewer')
  })

  it('marwan-desouky بدون system_admin في app_metadata لا يمنح صلاحيات إدارية عليا', () => {
    expect(getEffectiveRole(makeSession('marwan-desouky', 'admin'))).toBe('admin')
    expect(getEffectiveRole(makeSession('marwan-desouky', 'viewer'))).toBe('viewer')
  })

  it('admin username مع viewer = viewer', () => {
    expect(getEffectiveRole(makeSession('admin', 'viewer'))).toBe('viewer')
  })

  it('حساب مع راية system_admin صريحة في app_metadata = system_admin', () => {
    expect(getEffectiveRole(makeSession('marwan-desouky', 'system_admin'))).toBe('system_admin')
    expect(getEffectiveRole(makeSession('anyuser', 'system_admin'))).toBe('system_admin')
  })

  it('user بدور admin = admin', () => {
    expect(getEffectiveRole(makeSession('ali', 'admin'))).toBe('admin')
  })

  it('user بدور warehouse_staff = warehouse_staff', () => {
    expect(getEffectiveRole(makeSession('ali', 'warehouse_staff'))).toBe('warehouse_staff')
  })

  it('user بدور purchasing_staff = purchasing_staff', () => {
    expect(getEffectiveRole(makeSession('ali', 'purchasing_staff'))).toBe('purchasing_staff')
  })

  it('editor = editor (توافق رجعي)', () => {
    expect(getEffectiveRole(makeSession('ali', 'editor'))).toBe('editor')
  })

  it('viewer = viewer', () => {
    expect(getEffectiveRole(makeSession('ali', 'viewer'))).toBe('viewer')
  })

  it('يرفض تماماً أي تزوير في user_metadata ويفوض فقط app_metadata', () => {
    const forgedSession = {
      user: {
        id: 'usr-attacker',
        email: 'attacker@warehouse.local',
        user_metadata: { role: 'system_admin', system_admin: true },
        app_metadata: { role: 'viewer', system_admin: false },
      },
    } as unknown as LocalUserSession
    expect(getEffectiveRole(forgedSession)).toBe('viewer')
  })
})

// ─── isSystemAdmin ────────────────────────────────────────────────────────────

describe('isSystemAdmin', () => {
  it('system_admin session = true', () => {
    expect(isSystemAdmin(makeSession('admin_lead', 'system_admin'))).toBe(true)
  })

  it('اسم marwan-desouky بدور admin عادي = false (بدون app_metadata system_admin)', () => {
    expect(isSystemAdmin(makeSession('marwan-desouky', 'admin'))).toBe(false)
  })

  it('admin username مع viewer = false', () => {
    expect(isSystemAdmin(makeSession('admin', 'viewer'))).toBe(false)
  })

  it('user بدور admin عادي = false', () => {
    expect(isSystemAdmin(makeSession('ali', 'admin'))).toBe(false)
    expect(isSystemAdmin(makeSession('manager', 'admin'))).toBe(false)
  })

  it('null = false', () => {
    expect(isSystemAdmin(null)).toBe(false)
  })
})

// ─── can() — الصلاحيات الإضافية ──────────────────────────────────────────────

describe('can()', () => {
  it('system_admin يملك كل الصلاحيات', () => {
    const s = makeSession('admin_lead', 'system_admin')
    expect(can(s, 'view_audit')).toBe(true)
    expect(can(s, 'view_settings')).toBe(true)
    expect(can(s, 'manage_records')).toBe(true)
  })

  it('admin عادي بدون صلاحيات إضافية = false', () => {
    const s = makeSession('ali', 'admin')
    expect(can(s, 'view_audit')).toBe(false)
    expect(can(s, 'view_settings')).toBe(false)
    expect(can(s, 'manage_records')).toBe(false)
  })

  it('warehouse_staff مع صلاحية manage_records = true', () => {
    const s = makeSession('ali', 'warehouse_staff', ['manage_records'])
    expect(can(s, 'manage_records')).toBe(true)
    expect(can(s, 'view_audit')).toBe(false)
  })

  it('viewer مع صلاحية view_audit = true', () => {
    const s = makeSession('ali', 'viewer', ['view_audit'])
    expect(can(s, 'view_audit')).toBe(true)
    expect(can(s, 'manage_records')).toBe(false)
  })

  it('null session = false لكل الصلاحيات', () => {
    const perms: Permission[] = ['view_audit', 'view_settings', 'manage_records']
    perms.forEach((p) => expect(can(null, p)).toBe(false))
  })
})

// ─── canCreatePurchase / canCreateDisbursement ────────────────────────────────

describe('canCreatePurchase', () => {
  it('system_admin = true', () => expect(canCreatePurchase(makeSession('admin_lead', 'system_admin'))).toBe(true))
  it('admin = true', () => expect(canCreatePurchase(makeSession('ali', 'admin'))).toBe(true))
  it('purchasing_staff = true', () => expect(canCreatePurchase(makeSession('ali', 'purchasing_staff'))).toBe(true))
  it('warehouse_staff = false', () => expect(canCreatePurchase(makeSession('ali', 'warehouse_staff'))).toBe(false))
  it('editor = false', () => expect(canCreatePurchase(makeSession('ali', 'editor'))).toBe(false))
  it('viewer = false', () => expect(canCreatePurchase(makeSession('ali', 'viewer'))).toBe(false))
})

describe('canCreateDisbursement', () => {
  it('system_admin = true', () => expect(canCreateDisbursement(makeSession('admin_lead', 'system_admin'))).toBe(true))
  it('admin = true', () => expect(canCreateDisbursement(makeSession('ali', 'admin'))).toBe(true))
  it('warehouse_staff = true', () => expect(canCreateDisbursement(makeSession('ali', 'warehouse_staff'))).toBe(true))
  it('purchasing_staff = false', () => expect(canCreateDisbursement(makeSession('ali', 'purchasing_staff'))).toBe(false))
  it('editor = false', () => expect(canCreateDisbursement(makeSession('ali', 'editor'))).toBe(false))
  it('viewer = false', () => expect(canCreateDisbursement(makeSession('ali', 'viewer'))).toBe(false))
})

// ─── canAccessRoute — مصفوفة الوصول الكاملة ──────────────────────────────────

describe('canAccessRoute', () => {
  const makeRole = (role: string, username = 'ali') => makeSession(username, role)

  const allRoles: Array<[string, string]> = [
    ['system_admin', 'admin_lead'],
    ['admin', 'ali'],
    ['warehouse_staff', 'ali'],
    ['purchasing_staff', 'ali'],
    ['editor', 'ali'],
    ['viewer', 'ali'],
  ]

  // الصفحة الرئيسية — الكل يدخل
  describe('/ (الرئيسية)', () => {
    allRoles.forEach(([role, username]) => {
      it(`${role} يمكنه الدخول`, () => {
        expect(canAccessRoute(makeSession(username, role), '/')).toBe(true)
      })
    })
  })

  // المشتريات
  describe('/purchases', () => {
    it('viewer لا يدخل', () => expect(canAccessRoute(makeRole('viewer'), '/purchases')).toBe(false))
    it('admin يدخل', () => expect(canAccessRoute(makeRole('admin'), '/purchases')).toBe(true))
    it('warehouse_staff يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/purchases')).toBe(true))
    it('purchasing_staff يدخل', () => expect(canAccessRoute(makeRole('purchasing_staff'), '/purchases')).toBe(true))
    it('editor يدخل', () => expect(canAccessRoute(makeRole('editor'), '/purchases')).toBe(true))
  })

  // العهدة/المخازن
  describe('/custody', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeRole('system_admin', 'admin_lead'), '/custody')).toBe(true))
    it('admin يدخل', () => expect(canAccessRoute(makeRole('admin'), '/custody')).toBe(true))
    it('warehouse_staff يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/custody')).toBe(true))
    it('editor يدخل', () => expect(canAccessRoute(makeRole('editor'), '/custody')).toBe(true))
    it('purchasing_staff لا يدخل', () => expect(canAccessRoute(makeRole('purchasing_staff'), '/custody')).toBe(false))
    it('viewer لا يدخل', () => expect(canAccessRoute(makeRole('viewer'), '/custody')).toBe(false))
  })

  // الاستيراد
  describe('/imports', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeRole('system_admin', 'admin_lead'), '/imports')).toBe(true))
    it('admin يدخل', () => expect(canAccessRoute(makeRole('admin'), '/imports')).toBe(true))
    it('purchasing_staff يدخل', () => expect(canAccessRoute(makeRole('purchasing_staff'), '/imports')).toBe(true))
    it('warehouse_staff لا يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/imports')).toBe(false))
    it('editor لا يدخل', () => expect(canAccessRoute(makeRole('editor'), '/imports')).toBe(false))
    it('viewer لا يدخل', () => expect(canAccessRoute(makeRole('viewer'), '/imports')).toBe(false))
  })

  // سجل العمليات
  describe('/audit', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeSession('admin_lead', 'system_admin'), '/audit')).toBe(true))
    it('admin لا يدخل', () => expect(canAccessRoute(makeRole('admin'), '/audit')).toBe(false))
    it('warehouse_staff لا يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/audit')).toBe(false))
    it('viewer مع view_audit يدخل', () => {
      expect(canAccessRoute(makeSession('ali', 'viewer', ['view_audit']), '/audit')).toBe(true)
    })
    it('admin بدون view_audit لا يدخل', () => {
      expect(canAccessRoute(makeSession('ali', 'admin', []), '/audit')).toBe(false)
    })
  })

  // المستخدمون
  describe('/users', () => {
    it('system_admin فقط يدخل', () => {
      expect(canAccessRoute(makeSession('admin_lead', 'system_admin'), '/users')).toBe(true)
      expect(canAccessRoute(makeRole('admin'), '/users')).toBe(false)
      expect(canAccessRoute(makeRole('editor'), '/users')).toBe(false)
    })
  })

  // الإعدادات
  describe('/settings', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeSession('admin_lead', 'system_admin'), '/settings')).toBe(true))
    it('admin لا يدخل', () => expect(canAccessRoute(makeRole('admin'), '/settings')).toBe(false))
    it('مستخدم مع view_settings يدخل', () => {
      expect(canAccessRoute(makeSession('ali', 'admin', ['view_settings']), '/settings')).toBe(true)
    })
  })

  it('/purchases/edit/123 يعمل كـ /purchases', () => {
    expect(canAccessRoute(makeRole('purchasing_staff'), '/purchases/edit/123')).toBe(true)
    expect(canAccessRoute(makeRole('viewer'), '/purchases/edit/123')).toBe(false)
  })
})

// ─── canViewPage ──────────────────────────────────────────────────────────────

describe('canViewPage', () => {
  it('audit: system_admin يرى', () => {
    expect(canViewPage(makeSession('admin_lead', 'system_admin'), 'audit')).toBe(true)
  })
  it('audit: admin لا يرى', () => {
    expect(canViewPage(makeSession('ali', 'admin'), 'audit')).toBe(false)
  })
  it('audit: مع view_audit يرى', () => {
    expect(canViewPage(makeSession('ali', 'viewer', ['view_audit']), 'audit')).toBe(true)
  })
  it('settings: مع view_settings يرى', () => {
    expect(canViewPage(makeSession('ali', 'admin', ['view_settings']), 'settings')).toBe(true)
  })
  it('users: system_admin فقط يرى', () => {
    expect(canViewPage(makeSession('ali', 'admin'), 'users')).toBe(false)
    expect(canViewPage(makeSession('admin_lead', 'system_admin'), 'users')).toBe(true)
  })
})

// ─── التوافق الرجعي — أدوار قديمة ───────────────────────────────────────────

describe('التوافق الرجعي مع الأدوار القديمة', () => {
  it('editor يصل لـ /custody (كـ warehouse_staff عند القراءة)', () => {
    expect(canAccessRoute(makeSession('ali', 'editor'), '/custody')).toBe(true)
  })

  it('editor يصل لـ /quality', () => {
    expect(canAccessRoute(makeSession('ali', 'editor'), '/quality')).toBe(true)
  })

  it('editor لا يصل لـ /imports', () => {
    expect(canAccessRoute(makeSession('ali', 'editor'), '/imports')).toBe(false)
  })

  it('viewer لا يصل لأي صفحة غير الرئيسية', () => {
    const pages = ['/purchases', '/custody', '/imports', '/quality', '/audit', '/users', '/settings']
    pages.forEach((page) => {
      expect(canAccessRoute(makeSession('ali', 'viewer'), page)).toBe(false)
    })
    // الرئيسية نفسها مسموحة
    expect(canAccessRoute(makeSession('ali', 'viewer'), '/')).toBe(true)
  })

  it('admin بدور قديم (غير محمي) = يصل للمشتريات والمخازن والتقارير', () => {
    const s = makeSession('ali', 'admin')
    expect(canAccessRoute(s, '/purchases')).toBe(true)
    expect(canAccessRoute(s, '/custody')).toBe(true)
    expect(canAccessRoute(s, '/reports')).toBe(true)
    // لكن لا يصل لـ audit/users/settings (إصلاح bug)
    expect(canAccessRoute(s, '/audit')).toBe(false)
    expect(canAccessRoute(s, '/users')).toBe(false)
    expect(canAccessRoute(s, '/settings')).toBe(false)
  })
})

// ─── اختبارات الأمان ومكافحة التزوير ──────────────────────────────────────────

describe('حماية الصلاحيات ضد تزوير user_metadata وتصعيد الأسماء', () => {
  it('يرفض تماماً أي قيم مزورة في user_metadata ويعتمد حصرياً على app_metadata', () => {
    const forgedSession = {
      user: {
        id: 'usr-attacker-999',
        email: 'attacker@warehouse.local',
        user_metadata: {
          username: 'admin',
          role: 'system_admin',
          permissions: ['view_audit', 'view_settings', 'manage_records'],
        },
        app_metadata: {
          username: 'attacker',
          role: 'viewer',
          system_admin: false,
          permissions: [],
        },
      },
      access_token: 'fake-jwt',
    } as any

    expect(getEffectiveRole(forgedSession)).toBe('viewer')
    expect(isSystemAdmin(forgedSession)).toBe(false)
    expect(can(forgedSession, 'view_audit')).toBe(false)
    expect(can(forgedSession, 'view_settings')).toBe(false)
    expect(can(forgedSession, 'manage_records')).toBe(false)
    expect(canAccessRoute(forgedSession, '/audit')).toBe(false)
    expect(canAccessRoute(forgedSession, '/users')).toBe(false)
  })

  it('محاولة انتحال اسم marwan-desouky في user_metadata تفشل تماماً', () => {
    const forgedSession = {
      user: {
        id: 'usr-attacker-888',
        email: 'marwan-desouky@warehouse.local',
        user_metadata: {
          username: 'marwan-desouky',
          role: 'system_admin',
        },
        app_metadata: {
          username: 'marwan-desouky',
          role: 'viewer',
          system_admin: false,
        },
      },
      access_token: 'fake-jwt',
    } as any

    expect(getEffectiveRole(forgedSession)).toBe('viewer')
    expect(isSystemAdmin(forgedSession)).toBe(false)
    expect(canAccessRoute(forgedSession, '/users')).toBe(false)
  })

  it('حساب عادي بدور viewer لا يمنح أي وصول حتى لو ادعى system_admin في user_metadata', () => {
    const regularViewerSession = {
      user: {
        id: 'usr-normal-user',
        email: 'user@warehouse.local',
        user_metadata: {
          role: 'system_admin',
        },
        app_metadata: {
          role: 'viewer',
          system_admin: false,
        },
      },
    } as any

    expect(getEffectiveRole(regularViewerSession)).toBe('viewer')
    expect(isSystemAdmin(regularViewerSession)).toBe(false)
  })
})
