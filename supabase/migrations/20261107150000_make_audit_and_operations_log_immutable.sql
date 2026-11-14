-- ==============================================================================
-- Migration: 20261107150000_make_audit_and_operations_log_immutable.sql
-- Description:
-- Permanently preserve operations logs with anti-tamper protection:
-- 1. public.movements: Immutable ledger; disallow DELETE.
-- 2. public.asset_movement_log: Immutable asset history; disallow DELETE.
-- NOTE: audit_logs tamper protection (with the retention-purge exception) is
-- defined in the security monitoring migrations; do not redefine it here.
-- ==============================================================================

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
