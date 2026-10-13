/**
 * tests/unit/permissions.test.ts
 *
 * اختبارات شاملة لنظام الأدوار والصلاحيات الجديد:
 * - normalizeRole: كل دور × كل حالة
 * - getEffectiveRole: LocalUserSession + Supabase Session
 * - isSystemAdmin: الحسابات المحمية + غيرها
 * - can(): الصلاحيات الإضافية
 * - canAccessRoute(): مصفوفة الوصول كاملة
 * - التوافق الرجعي: editor, viewer, admin القديم
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
  permissions: string[] = []
): LocalUserSession {
  return {
    user: {
      id: `usr-${username}`,
      email: username,
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
        system_admin: username === 'marwan-desouky' || username === 'admin' || role === 'system_admin',
        permissions,
      },
    },
    access_token: `token-${username}`,
  } as unknown as LocalUserSession
}

// ─── normalizeRole ────────────────────────────────────────────────────────────

describe('normalizeRole', () => {
  it('marwan-desouky بأي دور = system_admin', () => {
    expect(normalizeRole('viewer', 'marwan-desouky')).toBe('system_admin')
    expect(normalizeRole('editor', 'marwan-desouky')).toBe('system_admin')
    expect(normalizeRole('admin', 'marwan-desouky')).toBe('system_admin')
  })

  it('admin (اسم المستخدم) بأي دور = system_admin', () => {
    expect(normalizeRole('viewer', 'admin')).toBe('system_admin')
    expect(normalizeRole('editor', 'admin')).toBe('system_admin')
  })

  it('اسم محمي بحروف كبيرة = system_admin (case insensitive)', () => {
    expect(normalizeRole('viewer', 'Marwan-Desouky')).toBe('system_admin')
    expect(normalizeRole('viewer', 'ADMIN')).toBe('system_admin')
  })

  it('admin عادي (مش محمي) = admin', () => {
    expect(normalizeRole('admin', 'ahmed')).toBe('admin')
    expect(normalizeRole('admin', 'mohamed')).toBe('admin')
  })

  it('دور system_admin مخزن صراحةً = system_admin', () => {
    expect(normalizeRole('system_admin', 'ahmed')).toBe('system_admin')
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

  it('marwan-desouky session = system_admin', () => {
    expect(getEffectiveRole(makeSession('marwan-desouky', 'admin'))).toBe('system_admin')
    expect(getEffectiveRole(makeSession('marwan-desouky', 'editor'))).toBe('system_admin')
  })

  it('admin username session = system_admin', () => {
    expect(getEffectiveRole(makeSession('admin', 'viewer'))).toBe('system_admin')
  })

  it('user بدور admin (غير محمي) = admin', () => {
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
})

// ─── isSystemAdmin ────────────────────────────────────────────────────────────

describe('isSystemAdmin', () => {
  it('marwan-desouky = true', () => {
    expect(isSystemAdmin(makeSession('marwan-desouky', 'admin'))).toBe(true)
  })

  it('admin username = true', () => {
    expect(isSystemAdmin(makeSession('admin', 'viewer'))).toBe(true)
  })

  it('user بدور admin (غير محمي) = false (إصلاح الـ bug)', () => {
    // هذا هو الـ bug المصلوح: أي admin عادي لم يكن يُعدّ system_admin
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
    const s = makeSession('marwan-desouky', 'admin')
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
  it('system_admin = true', () => expect(canCreatePurchase(makeSession('marwan-desouky', 'admin'))).toBe(true))
  it('admin = true', () => expect(canCreatePurchase(makeSession('ali', 'admin'))).toBe(true))
  it('purchasing_staff = true', () => expect(canCreatePurchase(makeSession('ali', 'purchasing_staff'))).toBe(true))
  it('warehouse_staff = false', () => expect(canCreatePurchase(makeSession('ali', 'warehouse_staff'))).toBe(false))
  it('editor = false', () => expect(canCreatePurchase(makeSession('ali', 'editor'))).toBe(false))
  it('viewer = false', () => expect(canCreatePurchase(makeSession('ali', 'viewer'))).toBe(false))
})

describe('canCreateDisbursement', () => {
  it('system_admin = true', () => expect(canCreateDisbursement(makeSession('marwan-desouky', 'admin'))).toBe(true))
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
    ['system_admin', 'marwan-desouky'],
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
    it('system_admin يدخل', () => expect(canAccessRoute(makeRole('system_admin', 'marwan-desouky'), '/custody')).toBe(true))
    it('admin يدخل', () => expect(canAccessRoute(makeRole('admin'), '/custody')).toBe(true))
    it('warehouse_staff يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/custody')).toBe(true))
    it('editor يدخل', () => expect(canAccessRoute(makeRole('editor'), '/custody')).toBe(true))
    it('purchasing_staff لا يدخل', () => expect(canAccessRoute(makeRole('purchasing_staff'), '/custody')).toBe(false))
    it('viewer لا يدخل', () => expect(canAccessRoute(makeRole('viewer'), '/custody')).toBe(false))
  })

  // الاستيراد
  describe('/imports', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeRole('system_admin', 'marwan-desouky'), '/imports')).toBe(true))
    it('admin يدخل', () => expect(canAccessRoute(makeRole('admin'), '/imports')).toBe(true))
    it('purchasing_staff يدخل', () => expect(canAccessRoute(makeRole('purchasing_staff'), '/imports')).toBe(true))
    it('warehouse_staff لا يدخل', () => expect(canAccessRoute(makeRole('warehouse_staff'), '/imports')).toBe(false))
    it('editor لا يدخل', () => expect(canAccessRoute(makeRole('editor'), '/imports')).toBe(false))
    it('viewer لا يدخل', () => expect(canAccessRoute(makeRole('viewer'), '/imports')).toBe(false))
  })

  // سجل العمليات
  describe('/audit', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeSession('marwan-desouky', 'admin'), '/audit')).toBe(true))
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
      expect(canAccessRoute(makeSession('marwan-desouky', 'admin'), '/users')).toBe(true)
      expect(canAccessRoute(makeRole('admin'), '/users')).toBe(false)
      expect(canAccessRoute(makeRole('editor'), '/users')).toBe(false)
    })
  })

  // الإعدادات
  describe('/settings', () => {
    it('system_admin يدخل', () => expect(canAccessRoute(makeSession('marwan-desouky', 'admin'), '/settings')).toBe(true))
    it('admin لا يدخل', () => expect(canAccessRoute(makeRole('admin'), '/settings')).toBe(false))
    it('مستخدم مع view_settings يدخل', () => {
      expect(canAccessRoute(makeSession('ali', 'admin', ['view_settings']), '/settings')).toBe(true)
    })
  })

  // الراوتس الفرعية
  it('/purchases/new يعمل كـ /purchases', () => {
    expect(canAccessRoute(makeRole('viewer'), '/purchases/new')).toBe(false)
    expect(canAccessRoute(makeRole('purchasing_staff'), '/purchases/new')).toBe(true)
  })

  it('/purchases/edit/123 يعمل كـ /purchases', () => {
    expect(canAccessRoute(makeRole('purchasing_staff'), '/purchases/edit/123')).toBe(true)
    expect(canAccessRoute(makeRole('viewer'), '/purchases/edit/123')).toBe(false)
  })
})

// ─── canViewPage ──────────────────────────────────────────────────────────────

describe('canViewPage', () => {
  it('audit: system_admin يرى', () => {
    expect(canViewPage(makeSession('marwan-desouky', 'admin'), 'audit')).toBe(true)
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
    expect(canViewPage(makeSession('marwan-desouky', 'admin'), 'users')).toBe(true)
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

describe('حماية الصلاحيات ضد تزوير user_metadata', () => {
  it('يرفض تماماً أي قيم مزورة في user_metadata ويعتمد حصرياً على app_metadata', () => {
    // محاكاة مستخدم خبيث قام بتعديل user_metadata عبر supabase.auth.updateUser()
    const forgedSession = {
      user: {
        id: 'usr-attacker-999',
        email: 'attacker@warehouse.local',
        user_metadata: {
          username: 'marwan-desouky', // محاولة انتحال شخصية مدير النظام
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

    // يجب أن يحصل على دور viewer فقط ولا يملك أي صلاحية
    expect(getEffectiveRole(forgedSession)).toBe('viewer')
    expect(isSystemAdmin(forgedSession)).toBe(false)
    expect(can(forgedSession, 'view_audit')).toBe(false)
    expect(can(forgedSession, 'view_settings')).toBe(false)
    expect(can(forgedSession, 'manage_records')).toBe(false)
    expect(canAccessRoute(forgedSession, '/audit')).toBe(false)
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
