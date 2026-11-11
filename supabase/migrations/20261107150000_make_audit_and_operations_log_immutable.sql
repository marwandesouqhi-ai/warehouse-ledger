-- ==============================================================================
-- Migration: 20261107150000_make_audit_and_operations_log_immutable.sql
-- Description:
-- Permanently preserve operations and audit logs with anti-tamper triggers:
-- 1. public.audit_logs: Strict append-only; disallow any UPDATE or DELETE.
-- 2. public.movements: Immutable ledger; disallow DELETE.
-- 3. public.asset_movement_log: Immutable asset history; disallow DELETE.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Anti-Tamper Protection for Audit Logs (public.audit_logs)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'سجل التدقيق والمراقبة (audit_logs) محفوظ بشكل دائم وغير قابل للتعديل أو الحذف نهائياً لضمان النزاهة الرقابية والأمنية.'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tamper ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_tamper
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_tamper();

REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Immutable Ledger Protection for Movements (public.movements)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_movement_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'سجل العمليات وحركات المخزون (movements) محفوظ بشكل دائم وغير قابل للحذف نهائياً لضمان النزاهة المحاسبية والمخزنية. في حال الرغبة في تصحيح خطأ، يرجى تسجيل حركة تسوية قيدية جديدة.'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_movement_deletion ON public.movements;
CREATE TRIGGER trg_prevent_movement_deletion
  BEFORE DELETE ON public.movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_movement_deletion();

DROP POLICY IF EXISTS role_delete ON public.movements;
DROP POLICY IF EXISTS movements_delete_policy ON public.movements;
REVOKE DELETE ON public.movements FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Immutable Protection for Asset Movement Log (public.asset_movement_log)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_asset_movement_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'سجل حركات وعمليات الأصول (asset_movement_log) محفوظ بشكل دائم وغير قابل للحذف نهائياً لضمان النزاهة الرقابية.'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_asset_movement_deletion ON public.asset_movement_log;
CREATE TRIGGER trg_prevent_asset_movement_deletion
  BEFORE DELETE ON public.asset_movement_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_asset_movement_deletion();

DROP POLICY IF EXISTS role_delete ON public.asset_movement_log;
DROP POLICY IF EXISTS "Allow admin delete asset_movement_log" ON public.asset_movement_log;
REVOKE DELETE ON public.asset_movement_log FROM PUBLIC, anon, authenticated;
