-- supabase/tests/rls_security_matrix.sql
-- Validation test suite for RLS policies across roles, tables, and operations.
-- Run using pg_prove or psql within Supabase local test environment.

BEGIN;
SELECT plan(12);

-- 1. Anonymous access tests (must fail for sensitive tables)
SET ROLE anon;

SELECT throws_ok(
  $$ SELECT * FROM public.app_users $$,
  'permission denied for table app_users',
  'anon cannot read app_users'
);

SELECT throws_ok(
  $$ SELECT * FROM public.custody_items $$,
  'permission denied for table custody_items',
  'anon cannot read custody_items'
);

SELECT throws_ok(
  $$ SELECT * FROM public.movements $$,
  'permission denied for table movements',
  'anon cannot read movements'
);

SELECT throws_ok(
  $$ SELECT * FROM public.audit_logs $$,
  'permission denied for table audit_logs',
  'anon cannot read audit_logs'
);

-- anon CAN read app_settings for branding on login screen
SELECT lives_ok(
  $$ SELECT organization FROM public.app_settings LIMIT 1 $$,
  'anon can read public app_settings'
);

-- 2. Audit logs append-only verification (prevent UPDATE/DELETE)
RESET ROLE;
SET ROLE authenticated;

SELECT throws_ok(
  $$ DELETE FROM public.audit_logs $$,
  'P0001',
  'audit_logs is append-only and cannot be deleted'
);

SELECT throws_ok(
  $$ UPDATE public.audit_logs SET action = 'tampered' $$,
  'P0001',
  'audit_logs is append-only and cannot be updated'
);

-- 3. Purchasing staff scope tests
-- Mock JWT for purchasing staff
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "email": "purchaser@warehouse.local", "app_metadata": {"role": "purchasing_staff"}}';

-- Cannot select custody items
SELECT is_empty(
  $$ SELECT * FROM public.custody_items $$,
  'purchasing_staff cannot view custody items'
);

-- Cannot insert transfer movement
SELECT throws_ok(
  $$ INSERT INTO public.movements (id, item, qty_in, qty_out, kind) VALUES ('t1', 'ورق', '0', '5', 'transfer') $$,
  'new row violates row-level security policy for table "movements"',
  'purchasing_staff cannot insert transfer movements'
);

-- 4. Forged user_metadata test (Attacker claims system_admin in user_metadata)
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "email": "attacker@warehouse.local", "user_metadata": {"role": "system_admin", "username": "marwan-desouky"}, "app_metadata": {"role": "viewer", "system_admin": false}}';

SELECT is(
  public.app_role(),
  'viewer',
  'Forged user_metadata is ignored and evaluates to viewer'
);

SELECT is(
  public.is_system_admin(),
  false,
  'Forged user_metadata cannot gain system_admin'
);

SELECT throws_ok(
  $$ INSERT INTO public.movements (id, item, qty_in, qty_out, kind) VALUES ('t2', 'قلم', '10', '0', 'purchase') $$,
  'new row violates row-level security policy for table "movements"',
  'Viewer with forged user_metadata cannot insert movements'
);

SELECT * FROM finish();
ROLLBACK;
