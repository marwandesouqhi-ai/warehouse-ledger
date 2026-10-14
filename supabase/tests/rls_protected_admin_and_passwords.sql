-- supabase/tests/rls_protected_admin_and_passwords.sql
-- Test Suite: Protected Account Isolation, Password Column Hiding & Purchasing Staff Scopes
-- Usage: Run within psql or pg_prove during database validation

BEGIN;
SELECT plan(10);

-- 1. Setup mock records
INSERT INTO public.app_users (
  id, username, password, display_name, role, status, auth_user_id
) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'marwan-desouky', 'secret_hash_value', 'مروان دسوقي', 'admin', 'active', '00000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'store_keeper_1', 'other_password_hash', 'أمين المخزن', 'warehouse_staff', 'active', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.movements (
  id, received_on, item, qty_in, qty_out, kind, fingerprint, owner_id
) VALUES 
  ('33333333-3333-3333-3333-333333333333', '2026-10-14', 'صنف شراء وارد', '10', '0', 'purchase', 'fp-test-p1', '00000000-0000-0000-0000-000000000002'),
  ('44444444-4444-4444-4444-444444444444', '2026-10-14', 'صنف صرف منصرف', '0', '5', 'transfer', 'fp-test-t1', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (fingerprint) DO NOTHING;

-- 2. Test: Regular Authenticated User cannot view password column
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "email": "keeper@warehouse.local", "app_metadata": {"role": "warehouse_staff"}}';

SELECT throws_ok(
  $$ SELECT password FROM public.app_users $$,
  'permission denied for column "password"',
  'Authenticated users are denied direct SELECT access to password column'
);

-- 3. Test: Regular user CANNOT see marwan-desouky in app_users
SELECT is_empty(
  $$ SELECT * FROM public.app_users WHERE username = 'marwan-desouky' $$,
  'Protected account marwan-desouky is hidden from regular users'
);

-- 4. Test: Admin (non-owner) CANNOT see marwan-desouky in app_users
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "email": "other_admin@warehouse.local", "app_metadata": {"role": "admin"}}';

SELECT is_empty(
  $$ SELECT * FROM public.app_users WHERE username = 'marwan-desouky' $$,
  'Protected account marwan-desouky is hidden even from other administrators'
);

-- 5. Test: marwan-desouky CAN see his own row
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "email": "marwan-desouky@warehouse.local", "app_metadata": {"role": "system_admin", "system_admin": true}}';

SELECT results_eq(
  $$ SELECT username FROM public.app_users WHERE username = 'marwan-desouky' $$,
  $$ VALUES ('marwan-desouky'::text) $$,
  'Protected account owner can see their own row'
);

-- 6. Test: Purchasing Staff reads ALL purchases unit-wide
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000004", "email": "purchaser@warehouse.local", "app_metadata": {"role": "purchasing_staff"}}';

SELECT results_eq(
  $$ SELECT item FROM public.movements WHERE kind = 'purchase' $$,
  $$ VALUES ('صنف شراء وارد'::text) $$,
  'purchasing_staff can view all purchase movements regardless of creator'
);

-- 7. Test: Purchasing Staff CANNOT read outward / transfer movements
SELECT is_empty(
  $$ SELECT item FROM public.movements WHERE kind = 'transfer' $$,
  'purchasing_staff cannot view any outward transfer movement'
);

-- 8. Test: Audit logs server-side trigger forces JWT identity
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000004", "email": "purchaser@warehouse.local", "app_metadata": {"role": "purchasing_staff"}}';

INSERT INTO public.audit_logs (
  user_id, user_email, action
) VALUES (
  '00000000-0000-0000-0000-000000000099', 'forged@attacker.com', 'محاولة تزوير هوية'
) RETURNING id, user_id, user_email INTO v_test_log_id, v_test_user_id, v_test_user_email;

SELECT results_eq(
  $$ SELECT user_email FROM public.audit_logs WHERE action = 'محاولة تزوير هوية' $$,
  $$ VALUES ('purchaser@warehouse.local'::text) $$,
  'Server trigger overrides forged client email with authentic JWT email'
);

-- 9. Test: Attempting to UPDATE or DELETE audit_logs is rejected
SELECT throws_ok(
  $$ UPDATE public.audit_logs SET action = 'tampered' WHERE action = 'محاولة تزوير هوية' $$,
  'P0001',
  'audit_logs update is unconditionally blocked'
);

SELECT throws_ok(
  $$ DELETE FROM public.audit_logs WHERE action = 'محاولة تزوير هوية' $$,
  'P0001',
  'audit_logs delete is unconditionally blocked'
);

-- 10. Finish and rollback test transaction
SELECT * FROM finish();
ROLLBACK;
