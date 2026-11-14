import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'

const ROOT_DIR = join(__dirname, '..', '..')

function loadEdgeHandler(
  functionName: string,
  mockSupabase: unknown,
  envOverrides: Record<string, string> = {}
): (req: Request) => Promise<Response> {
  const filePath = join(ROOT_DIR, 'supabase', 'functions', functionName, 'index.ts')
  const source = readFileSync(filePath, 'utf8').replace(/^import .*$/gm, '')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const holder: { handler: ((req: Request) => Promise<Response>) | null } = { handler: null }
  const envMap: Record<string, string> = {
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srv-secret-key-unit-test',
    SUPABASE_ANON_KEY: 'anon-key-unit-test',
    ...envOverrides,
  }

  const Deno = {
    env: {
      get: (key: string) => envMap[key] ?? '',
    },
  }

  const serve = (fn: (req: Request) => Promise<Response>) => {
    holder.handler = fn
  }

  const createClient = vi.fn(() => mockSupabase)

  const runner = new Function('serve', 'createClient', 'Deno', 'fetch', 'console', compiled)
  runner(serve, createClient, Deno, globalThis.fetch, console)

  if (!holder.handler) {
    throw new Error(`No handler registered for Edge Function ${functionName}`)
  }

  return holder.handler
}

async function createSecurityTestDatabase() {
  const db = new PGlite()

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS JSONB
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::JSONB;
    $$;

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT NULLIF(auth.jwt()->>'sub', '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.role', true), ''), auth.jwt()->>'role', current_user);
    $$;

    CREATE OR REPLACE FUNCTION public.app_effective_role()
    RETURNS TEXT
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT COALESCE(
        NULLIF(auth.jwt()->'app_metadata'->>'role', ''),
        NULLIF(auth.role(), ''),
        'anon'
      );
    $$;

    CREATE OR REPLACE FUNCTION public.is_system_admin()
    RETURNS BOOLEAN
    LANGUAGE SQL
    STABLE
    AS $$
      SELECT
        COALESCE((auth.jwt()->'app_metadata'->>'system_admin')::BOOLEAN, false)
        OR COALESCE(public.app_effective_role(), '') = 'system_admin';
    $$;

    -- Pre-existing base tables matching warehouse-ledger production schema
    CREATE TABLE public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT 'general',
      entity_id TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.app_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'viewer',
      activation_code TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      department TEXT DEFAULT 'المخازن',
      email TEXT DEFAULT '',
      auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.movements (
      id TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE public.support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_notes TEXT DEFAULT NULL,
      resolved_by UUID DEFAULT NULL,
      resolved_at TIMESTAMPTZ DEFAULT NULL
    );

    CREATE TABLE public.purchase_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_no TEXT NOT NULL,
      created_by_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE public.registration_approval_settings (
      department TEXT PRIMARY KEY,
      delegation_enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.telegram_bot_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      bot_token TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE public.app_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      organization TEXT NOT NULL DEFAULT '',
      logo_data_url TEXT DEFAULT ''
    );

    CREATE TABLE public.login_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL,
      ip_address TEXT,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      success BOOLEAN NOT NULL DEFAULT false
    );

    -- Apply our new security migrations verbatim
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements, public.app_users, public.support_tickets, public.purchase_requests, public.registration_approval_settings TO authenticated;
  `)

  const mig1 = readFileSync(
    join(ROOT_DIR, 'supabase', 'migrations', '20261111160000_security_monitoring_audit_logs.sql'),
    'utf8'
  )
  const mig2 = readFileSync(
    join(ROOT_DIR, 'supabase', 'migrations', '20261111161000_security_triggers_and_detection_rules.sql'),
    'utf8'
  )
  const mig3 = readFileSync(
    join(ROOT_DIR, 'supabase', 'migrations', '20261111162000_security_retention_and_cron_schedules.sql'),
    'utf8'
  )
  const mig4 = readFileSync(
    join(ROOT_DIR, 'supabase', 'migrations', '20261111163000_n8n_security_events_bridge.sql'),
    'utf8'
  )
  const mig5 = readFileSync(
    join(ROOT_DIR, 'supabase', 'migrations', '20261112160000_security_audit_remediation.sql'),
    'utf8'
  )

  await db.exec(mig1)
  await db.exec(mig2)
  await db.exec(mig3)
  await db.exec(mig4)
  await db.exec(mig5)

  // Assert all 5 security migrations are safely re-runnable (idempotent)
  await db.exec(mig1)
  await db.exec(mig2)
  await db.exec(mig3)
  await db.exec(mig4)
  await db.exec(mig5)

  return db
}

async function setDbClaims(
  db: PGlite,
  claims: { sub: string; email?: string; role: string; system_admin?: boolean },
  pgRole: 'authenticated' | 'service_role' | 'anon' = 'authenticated'
) {
  const jwtPayload = JSON.stringify({
    sub: claims.sub,
    email: claims.email ?? '',
    role: pgRole,
    app_metadata: {
      role: claims.role,
      system_admin: Boolean(claims.system_admin),
    },
  })
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [jwtPayload])
  await db.query(`SELECT set_config('request.jwt.role', $1, false)`, [pgRole])
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PostgreSQL Security Monitor Schema, Triggers, RLS & Retention (PGlite)', () => {
  it('enforces schema, indexes, append-only immutability, admin-only SELECT RLS, and anti-tamper severity', async () => {
    const db = await createSecurityTestDatabase()
    try {
      const adminId = '11111111-1111-1111-1111-111111111111'
      const staffId = '22222222-2222-2222-2222-222222222222'
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)`, [
        adminId,
        'admin@warehouse.local',
        staffId,
        'staff@warehouse.local',
      ])
      await db.query(
        `INSERT INTO public.app_users (id, username, role, status, email, auth_user_id) VALUES ($1, 'sysadmin', 'system_admin', 'active', $2, $3), ($4, 'staff1', 'warehouse_employee', 'active', $5, $6)`,
        ['row-admin', 'admin@warehouse.local', adminId, 'row-staff', 'staff@warehouse.local', staffId]
      )

      // Verify required indexes exist
      const idxRes = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'audit_logs'`
      )
      const indexNames = idxRes.rows.map((r) => r.indexname)
      expect(indexNames).toEqual(
        expect.arrayContaining([
          'idx_audit_logs_created_at_desc',
          'idx_audit_logs_actor_id',
          'idx_audit_logs_event_type',
          'idx_audit_logs_severity',
        ])
      )

      // Verify centralized config row exists
      const cfgRes = await db.query<{
        failed_login_threshold: number
        failed_login_window_minutes: number
        mass_delete_threshold: number
        retention_days: number
      }>(`SELECT * FROM public.security_monitor_config WHERE id = 'default'`)
      expect(cfgRes.rows[0]).toMatchObject({
        failed_login_threshold: 5,
        failed_login_window_minutes: 10,
        mass_delete_threshold: 10,
        retention_days: 180,
      })

      // Non-admin client insert trying to spoof 'critical' is downgraded to 'warning' and actor_id forced to auth.uid()
      await db.exec('BEGIN')
      await setDbClaims(db, { sub: staffId, email: 'staff@warehouse.local', role: 'warehouse_employee' }, 'authenticated')
      await db.exec('SET LOCAL ROLE authenticated')
      await db.query(
        `INSERT INTO public.audit_logs (user_id, action, event_type, severity) VALUES ($1, $2, $3, $4)`,
        [adminId, 'client spoof attempt', 'custom_event', 'critical']
      )
      // Non-admin SELECT sees 0 rows via RLS
      const staffVisible = await db.query(`SELECT id FROM public.audit_logs`)
      expect(staffVisible.rows.length).toBe(0)
      await db.exec('COMMIT')

      // Verify row was stored with authentic staffId & downgraded severity = 'warning'
      await setDbClaims(db, { sub: adminId, email: 'admin@warehouse.local', role: 'system_admin', system_admin: true }, 'authenticated')
      const adminVisible = await db.query<{ actor_id: string; actor_role: string; severity: string }>(
        `SELECT actor_id, actor_role, severity FROM public.audit_logs WHERE action = 'client spoof attempt'`
      )
      expect(adminVisible.rows[0]).toMatchObject({
        actor_id: staffId,
        actor_role: 'warehouse_employee',
        severity: 'warning',
      })

      // Immutability check: UPDATE and direct DELETE must be blocked even for service_role
      await expect(db.query(`UPDATE public.audit_logs SET action = 'tampered'`)).rejects.toThrow(/غير قابل للتعديل|55000/)
      await expect(db.query(`DELETE FROM public.audit_logs`)).rejects.toThrow(/غير قابل للحذف|55000/)
    } finally {
      await db.close()
    }
  })

  it('masks sensitive columns, logs DML with auth.uid(), flags role self-changes, cross-user edits, mass deletes, and 180d retention', async () => {
    const db = await createSecurityTestDatabase()
    try {
      const adminId = '11111111-1111-1111-1111-111111111111'
      const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)`, [
        adminId,
        'admin@warehouse.local',
        userA,
        'usera@warehouse.local',
        userB,
        'userb@warehouse.local',
      ])

      // 1. Secret masking on app_users, telegram_bot_settings, and oversized logo_data_url
      await setDbClaims(db, { sub: adminId, email: 'admin@warehouse.local', role: 'system_admin', system_admin: true }, 'service_role')
      await db.query(
        `INSERT INTO public.app_users (id, username, password, activation_code, role, email, auth_user_id)
         VALUES ('u-a', 'usera', 'SuperSecretPass123!', 'ACT-999999', 'viewer', 'usera@warehouse.local', $1)`,
        [userA]
      )
      await db.query(
        `INSERT INTO public.telegram_bot_settings (id, bot_token, enabled) VALUES ('default', '123456:ABC-REAL-BOT-TOKEN', true)`
      )
      await db.query(
        `INSERT INTO public.app_settings (id, organization, logo_data_url) VALUES ('default', 'ZNU', $1)`,
        ['data:image/png;base64,' + 'A'.repeat(400)]
      )

      const maskedCheck = await db.query<{ table_name: string; new_data: Record<string, unknown> }>(
        `SELECT table_name, new_data FROM public.audit_logs WHERE table_name IN ('app_users', 'telegram_bot_settings', 'app_settings')`
      )
      const userAudit = maskedCheck.rows.find((r) => r.table_name === 'app_users')!
      const tgAudit = maskedCheck.rows.find((r) => r.table_name === 'telegram_bot_settings')!
      const settingsAudit = maskedCheck.rows.find((r) => r.table_name === 'app_settings')!

      expect(userAudit.new_data.password).toBe('[REDACTED]')
      expect(userAudit.new_data.activation_code).toBe('[REDACTED]')
      expect(tgAudit.new_data.bot_token).toBe('[REDACTED]')
      expect(settingsAudit.new_data.logo_data_url).toBe('[REDACTED_DATA_URL]')

      // 2. Self role-change by non-admin -> CRITICAL + self_role_permission_change (NOT downgraded!)
      await setDbClaims(db, { sub: userA, email: 'usera@warehouse.local', role: 'viewer' }, 'authenticated')
      await db.query(`UPDATE public.app_users SET role = 'system_admin' WHERE id = 'u-a'`)

      const selfRoleLogs = await db.query<{ event_type: string; severity: string; details: Record<string, unknown> }>(
        `SELECT event_type, severity, details FROM public.audit_logs WHERE event_type = 'self_role_permission_change'`
      )
      expect(selfRoleLogs.rows.length).toBe(1)
      expect(selfRoleLogs.rows[0].severity).toBe('critical')
      expect(selfRoleLogs.rows[0].details.is_self_change).toBe(true)

      // 3. Cross-user ticket modification (User B updates User A's ticket) -> CRITICAL cross_user_access
      await db.query(`INSERT INTO public.support_tickets (id, user_id, subject) VALUES ('99999999-9999-9999-9999-999999999999', $1, 'Help me')`, [userA])
      await setDbClaims(db, { sub: userB, email: 'userb@warehouse.local', role: 'warehouse_employee' }, 'authenticated')
      await db.query(`UPDATE public.support_tickets SET subject = 'Hijacked' WHERE id = '99999999-9999-9999-9999-999999999999'`)

      const crossUserLogs = await db.query<{ actor_id: string; severity: string; details: Record<string, unknown> }>(
        `SELECT actor_id, severity, details FROM public.audit_logs WHERE event_type = 'cross_user_access'`
      )
      expect(crossUserLogs.rows.length).toBe(1)
      expect(crossUserLogs.rows[0].actor_id).toBe(userB)
      expect(crossUserLogs.rows[0].severity).toBe('critical')
      expect(crossUserLogs.rows[0].details.record_owner_id).toBe(userA)

      // 4. Mass delete detection (> 10 deletes in window -> CRITICAL mass_delete) & verify inserts don't count as deletes
      await setDbClaims(db, { sub: userA, email: 'usera@warehouse.local', role: 'warehouse_employee' }, 'authenticated')
      for (let i = 1; i <= 11; i++) {
        await db.query(`INSERT INTO public.movements (id, item_name, quantity) VALUES ($1, $2, 5)`, [`mov-${i}`, `Item ${i}`])
      }
      // Perform 10 deletes first -> should NOT trigger mass_delete yet (10 <= 10 threshold)
      for (let i = 1; i <= 10; i++) {
        await db.query(`DELETE FROM public.movements WHERE id = $1`, [`mov-${i}`])
      }
      const before11 = await db.query(`SELECT id FROM public.audit_logs WHERE event_type = 'mass_delete'`)
      expect(before11.rows.length).toBe(0)

      // 11th delete within window (> 10 rows) -> triggers CRITICAL mass_delete
      await db.query(`DELETE FROM public.movements WHERE id = 'mov-11'`)
      const after11 = await db.query<{ severity: string; details: Record<string, unknown> }>(
        `SELECT severity, details FROM public.audit_logs WHERE event_type = 'mass_delete'`
      )
      expect(after11.rows.length).toBe(1)
      expect(after11.rows[0].severity).toBe('critical')
      expect(after11.rows[0].details.recent_deletes_count).toBe(11)

      // 5. Non-service callers cannot forge security events directly; service_role invokes record_security_event
      await expect(
        db.query(
          `SELECT public.record_security_event('failed_login', 'دخول فاشل', $1::jsonb, 'warning', 'auth', 'usera', '192.168.1.50', 'Vitest') AS res`,
          [JSON.stringify({ identifier: 'usera' })]
        )
      ).rejects.toThrow(/غير مصرح|42501/)

      await setDbClaims(db, { sub: adminId, email: 'admin@warehouse.local', role: 'system_admin', system_admin: true }, 'service_role')
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await db.query<{ res: { severity: string; event_type: string } }>(
          `SELECT public.record_security_event('failed_login', 'دخول فاشل', $1::jsonb, 'warning', 'auth', 'usera', '192.168.1.50', 'Vitest') AS res`,
          [JSON.stringify({ identifier: 'usera' })]
        )
        expect(res.rows[0].res.severity).toBe('warning')
      }
      const fifth = await db.query<{ res: { severity: string; event_type: string } }>(
        `SELECT public.record_security_event('failed_login', 'دخول فاشل', $1::jsonb, 'warning', 'auth', 'usera', '192.168.1.50', 'Vitest') AS res`,
        [JSON.stringify({ identifier: 'usera' })]
      )
      expect(fifth.rows[0].res.severity).toBe('critical')
      expect(fifth.rows[0].res.event_type).toBe('brute_force_failed_logins')

      // 6. Retention policy purge_expired_audit_logs: non-admin denied; admin archives & removes > 180d rows
      await setDbClaims(db, { sub: userB, email: 'userb@warehouse.local', role: 'warehouse_employee' }, 'authenticated')
      await expect(db.query(`SELECT public.purge_expired_audit_logs(180)`)).rejects.toThrow(/غير مصرح|42501/)

      await setDbClaims(db, { sub: adminId, email: 'admin@warehouse.local', role: 'system_admin', system_admin: true }, 'service_role')
      await db.query(
        `INSERT INTO public.audit_logs (action, event_type, severity, created_at) VALUES ('old archive log', 'legacy_event', 'info', now() - interval '200 days')`
      )
      const purgeRes = await db.query<{ res: { archived_rows: number; deleted_rows: number; retention_days: number } }>(
        `SELECT public.purge_expired_audit_logs() AS res`
      )
      expect(purgeRes.rows[0].res.retention_days).toBe(180)
      expect(purgeRes.rows[0].res.archived_rows).toBe(1)
      expect(purgeRes.rows[0].res.deleted_rows).toBe(1)

      const archiveRows = await db.query<{ action: string }>(`SELECT action FROM public.audit_logs_archive`)
      expect(archiveRows.rows.map((r) => r.action)).toContain('old archive log')
    } finally {
      await db.close()
    }
  })
})

describe('Edge Function Handlers: login-bridge, daily-report & critical-alerts', () => {
  it('login-bridge logs failed logins, escalates 5+ in 10 mins to critical, and flags new IP / unusual hours without logging passwords', async () => {
    const insertedAuditLogs: Array<Record<string, any>> = []
    const insertedAttempts: Array<Record<string, any>> = []

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'security_monitor_config') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    failed_login_threshold: 5,
                    failed_login_window_minutes: 10,
                    unusual_hours_start: 0,
                    unusual_hours_end: 23,
                    timezone: 'Africa/Cairo',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'login_attempts') {
          return {
            insert: async (row: Record<string, any>) => {
              insertedAttempts.push(row)
              return { error: null }
            },
            select: () => {
              const chain: any = {
                eq: () => chain,
                neq: () => chain,
                gte: () => Promise.resolve({ count: insertedAttempts.filter((a) => !a.success).length, error: null }),
                order: () => ({
                  limit: async () => ({
                    data: [{ ip_address: '10.0.0.99' }, { ip_address: '10.0.0.1' }],
                    error: null,
                  }),
                }),
              }
              return chain
            },
          }
        }
        if (table === 'app_users') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'u-1',
                    username: 'ahmed',
                    role: 'warehouse_employee',
                    status: 'active',
                    auth_user_id: 'auth-u-1',
                    email: 'ahmed@warehouse.local',
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        }
        if (table === 'audit_logs') {
          return {
            insert: async (row: Record<string, any>) => {
              insertedAuditLogs.push(row)
              return { error: null }
            },
          }
        }
        return {}
      }),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { id: 'auth-u-1', email: 'ahmed@warehouse.local' } },
            error: null,
          }),
        },
        signInWithPassword: async ({ password }: { password: string }) => {
          if (password === 'CorrectPass!9') {
            return {
              data: {
                user: { id: 'auth-u-1', aud: 'authenticated', email: 'ahmed@warehouse.local', user_metadata: {}, app_metadata: { role: 'warehouse_employee' } },
                session: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, token_type: 'bearer' },
              },
              error: null,
            }
          }
          return { data: null, error: { message: 'Invalid login credentials' } }
        },
      },
    }

    const handler = loadEdgeHandler('login-bridge', mockSupabase)

    // 5 failed password attempts from 10.0.0.50 -> 5th triggers critical brute_force_failed_logins
    for (let i = 1; i <= 5; i++) {
      const res = await handler(
        new Request('https://example.supabase.co/functions/v1/login-bridge', {
          method: 'POST',
          headers: { 'x-forwarded-for': '10.0.0.50', 'user-agent': 'Vitest/1.0', 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'ahmed', password: 'WrongPassword123!' }),
        })
      )
      expect([401, 429]).toContain(res.status)
    }

    expect(insertedAuditLogs[0].severity).toBe('warning')
    expect(insertedAuditLogs[0].event_type).toBe('failed_login')
    expect(insertedAuditLogs[4].severity).toBe('critical')
    expect(insertedAuditLogs[4].event_type).toBe('brute_force_failed_logins')

    // Ensure password never appears in any audit_logs entry
    expect(JSON.stringify(insertedAuditLogs)).not.toContain('WrongPassword123!')

    // Successful login from new IP 10.0.0.99 during configured unusual hours -> warning
    insertedAttempts.length = 0
    const okRes = await handler(
      new Request('https://example.supabase.co/functions/v1/login-bridge', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.99', 'user-agent': 'Vitest/1.0', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'ahmed', password: 'CorrectPass!9' }),
      })
    )
    expect(okRes.status).toBe(200)
    const successAudit = insertedAuditLogs[insertedAuditLogs.length - 1]
    expect(successAudit.severity).toBe('warning')
    expect(successAudit.event_type).toMatch(/^login_/)
    expect(JSON.stringify(successAudit)).not.toContain('CorrectPass!9')
  })

  it('daily-report rejects unauthorized callers, aggregates metrics, escapes HTML, and splits >3800 char Telegram messages', async () => {
    const sentMessages: Array<Record<string, any>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentMessages.push(JSON.parse(String(init?.body || '{}')))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9001 } }), { status: 200 })
    })

    // Generate enough critical events so rendered Telegram HTML exceeds 3800 chars & tests chunking + HTML escaping
    const sampleLogs = [
      { id: '1', created_at: new Date().toISOString(), actor_role: 'warehouse_employee', event_type: 'login_success', action: 'دخول', user_email: 'a@znu.edu.eg', severity: 'info' },
      { id: '2', created_at: new Date().toISOString(), actor_role: 'anon', event_type: 'failed_login', action: 'دخول فاشل <script>', user_email: 'bad&user@znu.edu.eg', severity: 'warning' },
      { id: '3', created_at: new Date().toISOString(), actor_role: 'warehouse_employee', event_type: 'insert_movements', action: 'إضافة حركة', user_email: 'a@znu.edu.eg', severity: 'info' },
      { id: '4', created_at: new Date().toISOString(), actor_role: 'warehouse_employee', event_type: 'update_movements', action: 'تعديل حركة', user_email: 'a@znu.edu.eg', severity: 'info' },
      { id: '5', created_at: new Date().toISOString(), actor_role: 'warehouse_employee', event_type: 'delete_operation', action: 'حذف سجل', user_email: 'a@znu.edu.eg', severity: 'warning' },
      ...Array.from({ length: 24 }, (_, idx) => ({
        id: `crit-${idx}`,
        created_at: new Date().toISOString(),
        actor_role: 'viewer',
        event_type: idx % 2 === 0 ? 'role_permission_change' : 'unauthorized_api_access',
        action: `حدث حرج رقم ${idx} <tag>&"${'x'.repeat(80)}`,
        table_name: 'app_users',
        user_email: `attacker${idx % 3}@znu.edu.eg`,
        ip: `192.168.10.${idx}`,
        severity: 'critical',
      })),
    ]

    const mockSupabase = {
      from: (table: string) => {
        if (table === 'security_monitor_config') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { telegram_notifications_enabled: true, daily_report_enabled: true },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          select: () => ({
            gte: () => ({
              order: async () => ({ data: sampleLogs, error: null }),
            }),
          }),
        }
      },
    }

    const handler = loadEdgeHandler('daily-report', mockSupabase, {
      TELEGRAM_BOT_TOKEN: 'bot-token-test',
      TELEGRAM_CHAT_ID: '-100123456',
      CRON_WEBHOOK_SECRET: 'cron-secret-test',
    })

    // 1. Unauthorized caller must fail with 401
    const unauthRes = await handler(new Request('https://example.supabase.co/functions/v1/daily-report', { method: 'POST' }))
    expect(unauthRes.status).toBe(401)
    expect(sentMessages.length).toBe(0)

    // 2. Authorized cron secret triggers multi-chunk HTML escaped Telegram report
    const okRes = await handler(
      new Request('https://example.supabase.co/functions/v1/daily-report', {
        method: 'POST',
        headers: { 'x-cron-secret': 'cron-secret-test' },
      })
    )
    const body = await okRes.json()
    expect(okRes.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.criticalEventsCount).toBe(24)
    expect(body.metrics).toMatchObject({
      totalLogins: 1,
      failedLogins: 1,
      totalCreates: 1,
      totalUpdates: 1,
      totalDeletes: 1,
      roleChangesCount: 12,
      unauthorizedAttempts: 12,
    })
    expect(sentMessages.length).toBeGreaterThan(1)
    for (const msg of sentMessages) {
      expect(msg.parse_mode).toBe('HTML')
      expect(msg.text.length).toBeLessThanOrEqual(4096)
      expect(msg.text).not.toContain('<tag>')
    }
    expect(sentMessages.map((m) => m.text).join('\n')).toContain('&lt;tag&gt;&amp;')
  })

  it('critical-alerts sends once per critical event and deduplicates subsequent runs via audit_alert_deliveries', async () => {
    const deliveredIds = new Set<string>()
    const telegramDispatches: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body || '{}'))
      telegramDispatches.push(payload.text)
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: telegramDispatches.length } }),
        { status: 200 }
      )
    })

    const criticalRow = {
      id: 'crit-event-1',
      created_at: new Date().toISOString(),
      actor_id: 'actor-1',
      actor_role: 'viewer',
      event_type: 'self_role_permission_change',
      table_name: 'app_users',
      record_id: 'u-1',
      ip: '203.0.113.5',
      severity: 'critical',
      user_email: 'rogue@znu.edu.eg',
      action: 'محاولة تغيير الصلاحيات <alert>',
      details: { is_self_change: true, old_role: 'viewer', new_role: 'system_admin' },
    }

    const mockSupabase = {
      from: (table: string) => {
        if (table === 'security_monitor_config') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { telegram_notifications_enabled: true, critical_alerts_enabled: true },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'audit_alert_deliveries') {
          return {
            select: async () => ({
              data: Array.from(deliveredIds).map((id) => ({ audit_log_id: id })),
              error: null,
            }),
            insert: async (row: { audit_log_id: string }) => {
              deliveredIds.add(row.audit_log_id)
              return { error: null }
            },
          }
        }
        if (table === 'audit_logs') {
          return {
            select: () => ({
              eq: () => ({
                gte: () => ({
                  order: () => ({
                    limit: async () => ({ data: [criticalRow], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      },
    }

    const handler = loadEdgeHandler('critical-alerts', mockSupabase, {
      TELEGRAM_BOT_TOKEN: 'bot-token-test',
      TELEGRAM_CHAT_ID: '-100123456',
    })

    // First run dispatches 1 alert & records delivery
    const first = await handler(
      new Request('https://example.supabase.co/functions/v1/critical-alerts', {
        method: 'POST',
        headers: { Authorization: 'Bearer srv-secret-key-unit-test' },
      })
    )
    const firstBody = await first.json()
    expect(first.status).toBe(200)
    expect(firstBody.sentCount).toBe(1)
    expect(telegramDispatches.length).toBe(1)
    expect(telegramDispatches[0]).toContain('&lt;alert&gt;')

    // Second run must NOT resend the same alert
    const second = await handler(
      new Request('https://example.supabase.co/functions/v1/critical-alerts', {
        method: 'POST',
        headers: { Authorization: 'Bearer srv-secret-key-unit-test' },
      })
    )
    const secondBody = await second.json()
    expect(second.status).toBe(200)
    expect(secondBody.newAlertsCount).toBe(0)
    expect(telegramDispatches.length).toBe(1)
  })

  it('never leaks Telegram secrets or Supabase service role keys into client src/ files', () => {
    function walkFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true })
      const out: string[] = []
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) out.push(...walkFiles(full))
        else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(full)
      }
      return out
    }

    const srcFiles = walkFiles(join(ROOT_DIR, 'src'))
    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8')
      expect(content).not.toContain('TELEGRAM_BOT_TOKEN')
      expect(content).not.toContain('TELEGRAM_MONITOR_BOT_TOKEN')
      expect(content).not.toContain('TELEGRAM_CHAT_ID')
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
      expect(content).not.toContain('CRON_WEBHOOK_SECRET')
      expect(content).not.toContain('api.telegram.org/bot')
    }
  })

  it('accessScopedFetch captures 403 PostgREST RLS denials once per window without draining response body or hitting audit_logs recursively', async () => {
    const { accessScopedFetch, prepareAccessContext } = await import('../../src/lib/accessContext')
    prepareAccessContext({
      user: { id: 'user-rls-1', email: 'viewer@znu.edu.eg', app_metadata: { role: 'viewer' } },
    } as any)

    const dispatched: Array<{ method?: string; path?: string; status?: number }> = []
    const onDenial = (e: Event) => {
      dispatched.push((e as CustomEvent).detail)
    }
    window.addEventListener('znu-security-api-denial', onDenial)

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    try {
      const r1 = await accessScopedFetch('https://test.supabase.co/rest/v1/movements', { method: 'DELETE' })
      expect(r1.status).toBe(403)
      // Body remains readable by caller
      expect((await r1.json()).code).toBe('42501')
      expect(dispatched).toEqual([{ method: 'DELETE', path: '/rest/v1/movements', status: 403 }])

      // Calling audit_logs directly must NOT trigger recursive event
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 403 }))
      await accessScopedFetch('https://test.supabase.co/rest/v1/audit_logs', { method: 'SELECT' })
      expect(dispatched.length).toBe(1)
    } finally {
      window.removeEventListener('znu-security-api-denial', onDenial)
      prepareAccessContext(null)
    }
  })

  it('bridges login_attempts and audit_logs to security_events cleanly and protects system_admin from ban callbacks', async () => {
    const db = await createSecurityTestDatabase()
    try {
      const ownerAuthId = '10101010-1010-1010-1010-101010101010'
      const staffAuthId = '20202020-2020-2020-2020-202020202020'

      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)`, [
        ownerAuthId,
        'marwan-desouky@warehouse.local',
        staffAuthId,
        'ali@znu.edu.eg',
      ])

      await setDbClaims(db, { sub: ownerAuthId, role: 'system_admin', system_admin: true }, 'service_role')
      await db.query(
        `INSERT INTO public.app_users (id, username, display_name, role, status, email, auth_user_id)
         VALUES
           ('usr-owner', 'marwan-desouky', 'مروان', 'system_admin', 'active', '', $1),
           ('usr-staff', 'ali', 'علي', 'viewer', 'active', 'ali@znu.edu.eg', $2)`,
        [ownerAuthId, staffAuthId]
      )

      // 1. Failed login on regular user populates target_user_id = staffAuthId
      await db.query(
        `INSERT INTO public.login_attempts (username, ip_address, success) VALUES ('ali', '41.33.1.2', false)`
      )
      // 2. Failed login on system_admin keeps target_user_id NULL (prevents owner lockout via Telegram)
      await db.query(
        `INSERT INTO public.login_attempts (username, ip_address, success) VALUES ('marwan-desouky', '41.33.1.9', false)`
      )

      const loginEvents = await db.query<{
        event_type: string
        email: string
        user_id: string | null
        target_user_id: string | null
      }>(
        `SELECT event_type, email, user_id, target_user_id FROM public.security_events ORDER BY created_at ASC`
      )
      expect(loginEvents.rows).toHaveLength(2)
      expect(loginEvents.rows[0]).toMatchObject({
        event_type: 'login_failed',
        email: 'ali@znu.edu.eg',
        user_id: staffAuthId,
        target_user_id: staffAuthId,
      })
      expect(loginEvents.rows[1]).toMatchObject({
        event_type: 'login_failed',
        email: 'marwan-desouky',
        user_id: null,
        target_user_id: null,
      })

      // 3. Self role change on app_users mirrors to security_events with event_type = 'role_change'
      await setDbClaims(db, { sub: staffAuthId, email: 'ali@znu.edu.eg', role: 'viewer' }, 'authenticated')
      await db.query(`UPDATE public.app_users SET role = 'system_admin' WHERE id = 'usr-staff'`)

      // 4. Unauthorized API denial, mass delete & login anomaly via record_security_event (service_role only)
      await setDbClaims(db, { sub: ownerAuthId, email: 'admin@warehouse.local', role: 'system_admin', system_admin: true }, 'service_role')
      await db.query(
        `SELECT public.record_security_event('unauthorized_api_access', 'محاولة محظورة', '{}'::jsonb, 'critical', 'movements', '', '10.0.0.5', 'vitest')`
      )
      await db.query(
        `SELECT public.record_security_event('login_new_ip', 'دخول من IP جديد', '{}'::jsonb, 'warning', 'auth', $1, '10.0.0.5', 'vitest')`,
        [staffAuthId]
      )
      await db.query(
        `SELECT public.record_security_event('mass_delete', 'حذف جماعي', '{}'::jsonb, 'critical', 'movements', '', '10.0.0.5', 'vitest')`
      )

      // 5. Same login_failed via audit_logs within 10s must NOT duplicate login_attempts row
      await db.query(
        `SELECT public.record_security_event('failed_login', 'فشل دخول', $1::jsonb, 'warning', 'login_attempts', '', '41.33.1.2', 'vitest')`,
        [JSON.stringify({ target_username: 'ali@znu.edu.eg', username: 'ali@znu.edu.eg' })]
      )

      const allEvents = await db.query<{
        event_type: string
        changed_by: string | null
        changed_by_role: string | null
        target_user_id: string | null
        new_role: string | null
      }>(
        `SELECT event_type, changed_by, changed_by_role, target_user_id, new_role FROM public.security_events ORDER BY created_at ASC`
      )

      const types = allEvents.rows.map((r) => r.event_type)
      expect(types.filter((t) => t === 'login_failed')).toHaveLength(2)
      expect(types).toContain('role_change')
      expect(types).toContain('access_denied')
      expect(types).toContain('login_anomaly')
      expect(types).toContain('mass_delete')

      const roleEv = allEvents.rows.find((r) => r.event_type === 'role_change')
      expect(roleEv).toMatchObject({
        event_type: 'role_change',
        changed_by: staffAuthId,
        changed_by_role: 'viewer',
        target_user_id: staffAuthId,
        new_role: 'system_admin',
      })
    } finally {
      await db.close()
    }
  })

  it('validates n8n Supabase Security Monitor workflow JSON structure and executes Detect Incidents + Aggregate Stats JS cleanly', () => {
    const wfPath = join(ROOT_DIR, 'automation', 'n8n', 'supabase-security-monitor.workflow.json')
    const workflow = JSON.parse(readFileSync(wfPath, 'utf8')) as {
      nodes: Array<{ name: string; type: string; credentials?: Record<string, { id: string }>; parameters: Record<string, any> }>
      connections: Record<string, Record<string, Array<Array<{ node: string }>>>>
    }

    const nodeNames = new Set(workflow.nodes.map((n) => n.name))
    for (const [src, outputs] of Object.entries(workflow.connections)) {
      expect(nodeNames.has(src)).toBe(true)
      for (const groups of Object.values(outputs)) {
        for (const edges of groups) {
          for (const edge of edges) {
            expect(nodeNames.has(edge.node)).toBe(true)
          }
        }
      }
    }

    // All Telegram nodes share Telegram account 2 (vflFy7UeAsh7U6YR) and chatId 1200587150
    for (const node of workflow.nodes) {
      if (node.type === 'n8n-nodes-base.telegram' || node.type === 'n8n-nodes-base.telegramTrigger') {
        expect(node.credentials?.telegramApi?.id).toBe('vflFy7UeAsh7U6YR')
      }
    }

    const detectNode = workflow.nodes.find((n) => n.name === 'Detect Incidents')!
    const statsNode = workflow.nodes.find((n) => n.name === 'Aggregate Stats')!

    const staffId = '20202020-2020-2020-2020-202020202020'
    const baseTime = Date.now()
    const syntheticEvents = [
      { id: '1', event_type: 'login_failed', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime - 5000).toISOString() },
      { id: '2', event_type: 'login_failed', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime - 4000).toISOString() },
      { id: '3', event_type: 'login_failed', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime - 3000).toISOString() },
      { id: '4', event_type: 'login_failed', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime - 2000).toISOString() },
      { id: '5', event_type: 'login_failed', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime - 1000).toISOString() },
      { id: '6', event_type: 'login_success', email: 'attacker<script>@x.com', ip_address: '1.1.1.1', user_id: staffId, created_at: new Date(baseTime).toISOString() },
      { id: '7', event_type: 'role_change', email: 'ali@znu.edu.eg', changed_by: staffId, target_user_id: staffId, changed_by_role: 'viewer', created_at: new Date(baseTime).toISOString() },
      { id: '8', event_type: 'mass_delete', email: 'ali@znu.edu.eg', ip_address: '2.2.2.2', user_id: staffId, created_at: new Date(baseTime).toISOString() },
      { id: '9', event_type: 'login_anomaly', email: 'ali@znu.edu.eg', ip_address: '9.9.9.9', user_id: staffId, created_at: new Date(baseTime).toISOString() },
    ]

    const thresholdsCfg = {
      window_minutes: 10,
      failed_per_email: 5,
      failed_per_ip: 10,
      emails_per_ip: 3,
      success_after_failed: 3,
      denied_per_user: 3,
      dedupe_minutes: 30,
      admin_user_ids: '',
      admin_roles: 'system_admin,admin',
    }

    const runDetect = new Function(
      '$',
      '$input',
      detectNode.parameters.jsCode as string
    )
    const incidents = runDetect(
      () => ({ first: () => ({ json: thresholdsCfg }) }),
      { all: () => syntheticEvents.map((e) => ({ json: e })) }
    ) as Array<{ json: Record<string, any> }>

    const rules = incidents.map((i) => i.json.raw_rule)
    expect(rules).toContain('محاولات دخول فاشلة متكررة (نفس الحساب)')
    expect(rules).toContain('تسجيل دخول ناجح بعد محاولات فاشلة')
    expect(rules).toContain('المستخدم غيّر دوره بنفسه')
    expect(rules).toContain('حذف جماعي غير معتاد (Mass Delete)')
    expect(rules).toContain('تسجيل دخول من IP جديد أو في وقت غير معتاد')

    const successAfterFail = incidents.find((i) => i.json.raw_rule === 'تسجيل دخول ناجح بعد محاولات فاشلة')!
    expect(successAfterFail.json.severity).toBe('CRITICAL')
    expect(successAfterFail.json.can_block).toBe(false)
    expect(successAfterFail.json.email).toContain('&lt;script&gt;')

    const runStats = new Function('$input', statsNode.parameters.jsCode as string)
    const statsRes = runStats({ all: () => syntheticEvents.map((e) => ({ json: e })) }) as Array<{ json: { facts_text: string } }>
    expect(statsRes[0].json.facts_text).toContain('عمليات الحذف الجماعي: 1')
    expect(statsRes[0].json.facts_text).not.toContain('<script>')
  })
})

