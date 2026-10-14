-- supabase/tests/procurement_rls_and_rpc.sql
-- Validation test suite for Procurement Module RLS and atomic RPC state machine.
-- Run using pg_prove or within Supabase local test environment.

BEGIN;
SELECT plan(16);

-- 1. Anonymous Access Tests (Must fail for all new procurement tables)
SET ROLE anon;

SELECT throws_ok(
  $$ SELECT * FROM public.suppliers $$,
  'permission denied for table suppliers',
  'anon cannot read suppliers'
);

SELECT throws_ok(
  $$ SELECT * FROM public.purchase_requests $$,
  'permission denied for table purchase_requests',
  'anon cannot read purchase_requests'
);

SELECT throws_ok(
  $$ SELECT * FROM public.purchase_orders $$,
  'permission denied for table purchase_orders',
  'anon cannot read purchase_orders'
);

SELECT throws_ok(
  $$ SELECT * FROM public.supplier_quotes $$,
  'permission denied for table supplier_quotes',
  'anon cannot read supplier_quotes'
);

-- 2. Warehouse Staff Access Tests (Must fail: warehouse_staff has NO access to procurement)
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "email": "warehouse@warehouse.local", "app_metadata": {"role": "warehouse_staff"}}';

SELECT is_empty(
  $$ SELECT * FROM public.suppliers $$,
  'warehouse_staff cannot see suppliers'
);

SELECT is_empty(
  $$ SELECT * FROM public.purchase_requests $$,
  'warehouse_staff cannot see purchase_requests'
);

SELECT throws_ok(
  $$ SELECT public.submit_purchase_request('00000000-0000-0000-0000-000000000001'::uuid) $$,
  'غير مصرح لك بتقديم طلبات الشراء (صلاحية مقتصرة على موظفي المشتريات والإدارة).',
  'warehouse_staff cannot submit purchase request via RPC'
);

-- 3. Arabic Name Normalization Tests
SELECT is(
  public.normalize_arabic_name('  شَرِكَةُ  الأَمَلِ لِلتَّوْرِيدَاتِ  '),
  'شركة الامل للتوريدات',
  'normalize_arabic_name strips diacritics, alef, spaces'
);

SELECT is(
  public.normalize_arabic_name('مستشفى مصطفى'),
  'مستشفي مصطفي',
  'normalize_arabic_name normalizes alef maksura to ya'
);

-- 4. Sequence Generators
SELECT ok(
  public.next_purchase_request_no() ~ '^PR-[0-9]{4}$',
  'next_purchase_request_no returns valid PR-XXXX format'
);

SELECT ok(
  public.next_purchase_order_no() ~ '^PO-[0-9]{4}$',
  'next_purchase_order_no returns valid PO-XXXX format'
);

-- 5. Purchasing Staff Authorized Scope
SET request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "email": "purchasing@warehouse.local", "app_metadata": {"role": "purchasing_staff", "username": "purchaser1"}}';

SELECT lives_ok(
  $$ SELECT * FROM public.suppliers $$,
  'purchasing_staff can read suppliers'
);

SELECT lives_ok(
  $$ SELECT * FROM public.supplier_stats $$,
  'purchasing_staff can read supplier_stats view'
);

-- 6. State Machine Verification
-- Cannot select quote on non-approved PR
SELECT throws_ok(
  $$ SELECT public.select_quote('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid) $$,
  'طلب الشراء غير موجود.',
  'select_quote verifies existing approved PR'
);

-- Cannot create PO on non-selected quote
SELECT throws_ok(
  $$ SELECT public.create_purchase_order('00000000-0000-0000-0000-000000000002'::uuid) $$,
  'عرض السعر غير موجود.',
  'create_purchase_order verifies existing quote'
);

-- 7. Snapshot Integrity Check
SELECT is(
  (SELECT COUNT(*) FROM public.movements),
  33::BIGINT,
  'movements table rows count is strictly preserved at 33'
);

SELECT * FROM finish();
ROLLBACK;
