-- ==============================================================================
-- Migration: 20261111160000_security_monitoring_audit_logs.sql
-- Description:
-- 1. Additively extends public.audit_logs with security monitoring schema:
--    actor_id, actor_role, event_type, table_name, record_id, old_data, new_data,
--    ip, severity (info, warning, critical).
-- 2. Creates covering indexes for fast querying and lightweight indexing.
-- 3. Implements compatibility and actor synchronization trigger.
-- 4. Creates centralized security_monitor_config table.
-- 5. Creates audit_alert_deliveries table for idempotent Telegram alert tracking.
-- 6. Creates audit_logs_archive and controlled retention purge function.
-- 7. Strictly enforces RLS: append-only (no UPDATE or DELETE policy), admins only SELECT.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Additive Columns on public.audit_logs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_id UUID,
  ADD COLUMN IF NOT EXISTS actor_role TEXT DEFAULT 'anon',
  ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS table_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS record_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS old_data JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS new_data JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ip TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';

-- Add check constraint for severity safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_severity_check' AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Covering Indexes for Fast Auditing & Alerting
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id
  ON public.audit_logs (actor_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
  ON public.audit_logs (event_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_severity
  ON public.audit_logs (severity);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name
  ON public.audit_logs (table_name)
  WHERE table_name <> '';

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_created
  ON public.audit_logs (ip, created_at DESC)
  WHERE ip <> '';

CREATE INDEX IF NOT EXISTS idx_audit_logs_critical_unhandled
  ON public.audit_logs (created_at DESC)
  WHERE severity = 'critical';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Centralized Security Monitoring Config (public.security_monitor_config)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_monitor_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  failed_login_threshold INT NOT NULL DEFAULT 5,
  failed_login_window_minutes INT NOT NULL DEFAULT 10,
  mass_delete_threshold INT NOT NULL DEFAULT 10,
  mass_delete_window_minutes INT NOT NULL DEFAULT 5,
  unusual_hours_start INT NOT NULL DEFAULT 22, -- 10:00 PM
  unusual_hours_end INT NOT NULL DEFAULT 7,    -- 07:00 AM
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  retention_days INT NOT NULL DEFAULT 180,
  telegram_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  daily_report_enabled BOOLEAN NOT NULL DEFAULT true,
  critical_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT DEFAULT ''
);

ALTER TABLE public.security_monitor_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_monitor_config_select" ON public.security_monitor_config;
CREATE POLICY "security_monitor_config_select"
  ON public.security_monitor_config FOR SELECT
  TO authenticated, service_role
  USING (true);

DROP POLICY IF EXISTS "security_monitor_config_modify" ON public.security_monitor_config;
CREATE POLICY "security_monitor_config_modify"
  ON public.security_monitor_config FOR ALL
  TO authenticated, service_role
  USING (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE((SELECT auth.jwt())->'app_metadata'->>'role', '') = 'system_admin'
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE((SELECT auth.jwt())->'app_metadata'->>'role', '') = 'system_admin'
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

GRANT SELECT ON public.security_monitor_config TO authenticated;
GRANT ALL ON public.security_monitor_config TO service_role;

-- Seed default configuration row
INSERT INTO public.security_monitor_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Telegram Alert Deliveries Tracking (public.audit_alert_deliveries)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_alert_deliveries (
  audit_log_id UUID PRIMARY KEY,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'delivered',
  telegram_message_id TEXT,
  error_message TEXT
);

ALTER TABLE public.audit_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_alert_deliveries_service_only" ON public.audit_alert_deliveries;
CREATE POLICY "audit_alert_deliveries_service_only"
  ON public.audit_alert_deliveries FOR ALL
  TO authenticated, service_role
  USING (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  )
  WITH CHECK (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

GRANT SELECT, INSERT ON public.audit_alert_deliveries TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Audit Archive & Controlled 180-Day Retention
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs_archive (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_role TEXT,
  event_type TEXT,
  table_name TEXT,
  record_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip TEXT,
  user_agent TEXT,
  severity TEXT,
  user_id TEXT,
  user_email TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created
  ON public.audit_logs_archive (created_at DESC);

ALTER TABLE public.audit_logs_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_archive_select" ON public.audit_logs_archive;
CREATE POLICY "audit_logs_archive_select"
  ON public.audit_logs_archive FOR SELECT
  TO authenticated, service_role
  USING (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

REVOKE UPDATE, DELETE ON public.audit_logs_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_logs_archive TO authenticated;
GRANT ALL ON public.audit_logs_archive TO service_role;

-- Update immutability trigger function on audit_logs to allow controlled retention purge
CREATE OR REPLACE FUNCTION public.prevent_audit_log_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict prohibition of all UPDATE operations
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'سجل التدقيق والمراقبة (audit_logs) محفوظ بشكل دائم وغير قابل للتعديل نهائياً لضمان النزاهة الرقابية والأمنية.'
      USING ERRCODE = '55000';
  END IF;

  -- Allow DELETE only within the authorized retention purge procedure
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.audit_retention_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'سجل التدقيق والمراقبة (audit_logs) محفوظ بشكل دائم وغير قابل للحذف المباشر لضمان النزاهة الرقابية.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_tamper ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_log_tamper
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_tamper();

-- Controlled Retention Purge Function (archive older than retention_days, default 180)
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs(p_retention_days INT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_days INT;
  v_cutoff TIMESTAMPTZ;
  v_archived_count INT := 0;
  v_deleted_count INT := 0;
BEGIN
  -- 1. Authorization: Only system_admin or service_role can trigger retention
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND COALESCE(public.app_effective_role(), '') <> 'system_admin'
     AND NOT COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'غير مصرح: تشغيل سياسة إتلاف وأرشفة السجلات مقتصر على مدير النظام أو المهام المجدولة.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Determine retention days from config if not passed
  IF p_retention_days IS NOT NULL AND p_retention_days > 0 THEN
    v_days := p_retention_days;
  ELSE
    SELECT retention_days INTO v_days
    FROM public.security_monitor_config
    WHERE id = 'default';
    v_days := COALESCE(v_days, 180);
  END IF;

  v_cutoff := now() - (v_days || ' days')::INTERVAL;

  -- 3. Copy expired rows to audit_logs_archive
  INSERT INTO public.audit_logs_archive (
    id, created_at, actor_id, actor_role, event_type, table_name,
    record_id, old_data, new_data, ip, user_agent, severity,
    user_id, user_email, action, entity_type, entity_id, details
  )
  SELECT
    id, created_at, actor_id, actor_role, event_type, table_name,
    record_id, old_data, new_data, ip, user_agent, severity,
    user_id, user_email, action, entity_type, entity_id, details
  FROM public.audit_logs
  WHERE created_at < v_cutoff
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  -- 4. Safely delete expired records from active table using retention flag
  PERFORM set_config('app.audit_retention_purge', 'on', true);

  DELETE FROM public.audit_logs
  WHERE created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'retention_days', v_days,
    'cutoff_timestamp', v_cutoff,
    'archived_rows', v_archived_count,
    'deleted_rows', v_deleted_count,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs(INT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Field Synchronization & Identity Enforcement Trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_audit_log_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_uid UUID;
  v_jwt_email TEXT;
  v_effective_role TEXT;
  v_is_service BOOLEAN;
BEGIN
  v_is_service := (COALESCE((SELECT auth.role()), '') = 'service_role');
  v_jwt_uid := (SELECT auth.uid());
  v_jwt_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));

  -- 1. Synchronize actor identity
  IF v_jwt_uid IS NOT NULL THEN
    NEW.actor_id := v_jwt_uid;
    NEW.user_id := v_jwt_uid::TEXT;
    IF v_jwt_email <> '' THEN
      NEW.user_email := v_jwt_email;
    END IF;
  ELSIF NEW.actor_id IS NOT NULL AND (NEW.user_id IS NULL OR NEW.user_id = '') THEN
    NEW.user_id := NEW.actor_id::TEXT;
  ELSIF NEW.user_id IS NOT NULL AND NEW.user_id ~ '^[0-9a-fA-F-]{36}$' AND NEW.actor_id IS NULL THEN
    NEW.actor_id := NEW.user_id::UUID;
  END IF;

  -- 2. Synchronize actor role
  IF NOT v_is_service THEN
    v_effective_role := COALESCE(public.app_effective_role(), (SELECT auth.jwt())->'app_metadata'->>'role', 'anon');
    IF v_effective_role IS NOT NULL AND v_effective_role <> '' THEN
      NEW.actor_role := v_effective_role;
    END IF;
  ELSE
    NEW.actor_role := COALESCE(NEW.actor_role, 'service_role');
  END IF;

  -- 3. Synchronize legacy text fields <-> new structured fields
  IF (NEW.event_type IS NULL OR NEW.event_type = '' OR NEW.event_type = 'general') AND (NEW.action IS NOT NULL AND NEW.action <> '') THEN
    NEW.event_type := NEW.action;
  ELSIF (NEW.action IS NULL OR NEW.action = '') AND (NEW.event_type IS NOT NULL AND NEW.event_type <> '') THEN
    NEW.action := NEW.event_type;
  END IF;

  IF (NEW.table_name IS NULL OR NEW.table_name = '') AND (NEW.entity_type IS NOT NULL AND NEW.entity_type <> 'general') THEN
    NEW.table_name := NEW.entity_type;
  ELSIF (NEW.entity_type IS NULL OR NEW.entity_type = '' OR NEW.entity_type = 'general') AND (NEW.table_name IS NOT NULL AND NEW.table_name <> '') THEN
    NEW.entity_type := NEW.table_name;
  END IF;

  IF (NEW.record_id IS NULL OR NEW.record_id = '') AND (NEW.entity_id IS NOT NULL AND NEW.entity_id <> '') THEN
    NEW.record_id := NEW.entity_id;
  ELSIF (NEW.entity_id IS NULL OR NEW.entity_id = '') AND (NEW.record_id IS NOT NULL AND NEW.record_id <> '') THEN
    NEW.entity_id := NEW.record_id;
  END IF;

  IF (NEW.ip IS NULL OR NEW.ip = '') AND (NEW.ip_address IS NOT NULL AND NEW.ip_address <> '') THEN
    NEW.ip := NEW.ip_address;
  ELSIF (NEW.ip_address IS NULL OR NEW.ip_address = '') AND (NEW.ip IS NOT NULL AND NEW.ip <> '') THEN
    NEW.ip_address := NEW.ip;
  END IF;

  -- 4. Default severity if empty
  IF NEW.severity IS NULL OR NEW.severity NOT IN ('info', 'warning', 'critical') THEN
    NEW.severity := 'info';
  END IF;

  -- 5. Anti-tamper on client inserts:
  -- Direct authenticated client inserts cannot spoof 'critical' severity
  -- unless triggered by a trusted SECURITY DEFINER security routine, verified system_admin, or service_role.
  IF NOT v_is_service
     AND COALESCE(current_setting('app.trusted_security_writer', true), '') <> 'on'
     AND NEW.severity = 'critical' THEN
    IF COALESCE(NEW.actor_role, '') <> 'system_admin'
       AND NOT COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) THEN
      NEW.severity := 'warning';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_audit_log_fields ON public.audit_logs;
CREATE TRIGGER trg_sync_audit_log_fields
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_audit_log_fields();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS Hardening on public.audit_logs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop obsolete or permissive policies
DROP POLICY IF EXISTS "Enable audit_logs insert for all" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "Enable audit_logs select for all" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can read relevant audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Only system admin can read audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "role_audit_read" ON public.audit_logs;

-- Strict read policy: ONLY system_admin and service_role can SELECT
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select"
  ON public.audit_logs FOR SELECT
  TO authenticated, service_role
  USING (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE((SELECT auth.jwt())->'app_metadata'->>'role', '') = 'system_admin'
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

-- Strict insert policy: authenticated users can insert, trigger secures actor data
DROP POLICY IF EXISTS "audit_logs_authenticated_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_authenticated_insert"
  ON public.audit_logs FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    OR (SELECT auth.role()) = 'service_role'
  );

-- STRICTLY NO UPDATE OR DELETE POLICIES CREATED FOR ANYONE.
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

NOTIFY pgrst, 'reload schema';

