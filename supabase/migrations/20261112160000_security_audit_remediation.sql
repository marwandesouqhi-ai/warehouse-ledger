-- ==============================================================================
-- Migration: 20261112160000_security_audit_remediation.sql
-- Description: Comprehensive forward security remediation for all SQL/RLS/RPC
--   findings identified in SECURITY_AUDIT.md (2026-11-12):
--   - CRIT-02: Remove stale auth.jwt()->'app_metadata' OR bypasses on security &
--              audit tables + enforce minimum retention floor in purge RPC.
--   - HIGH-02: Lock down support_tickets RLS & set support-attachments bucket
--              private; remove hardcoded admin email backdoors & protect
--              email/employee_id/activation_code on protected system_admin rows.
--   - HIGH-04: Restore status = 'rejected' cancellation constraint on
--              disbursement_requests creator updates (block self-approval).
--   - HIGH-05: Restrict security_monitor_config SELECT to system_admin & service_role.
--   - HIGH-06: Revoke record_security_event() from anon/authenticated and reject
--              untrusted forged security event_types on direct audit_logs inserts.
--   - MED-01:  Restore create_purchase_order(uuid) to SECURITY DEFINER.
--   - MED-02:  Reset app.trusted_security_writer in EXCEPTION, fail closed on
--              sensitive tables, recursively redact nested JSONB keys, enforce
--              https:// webhook URL, tighten search_path on app_effective_role(),
--              allowlist p_function_name & revoke dispatch_security_webhook from auth.
--   - MED-08:  Fix warehouse_merge_audit_log RLS, apply pending app_users status
--              CHECK constraint & telegram_user_sessions cleanup/revoke.
--   - Polish:  Preserve service_role actor user_id in set_audit_log_actor().
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restore strict search_path = '' on app_effective_role() (MED-02)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.app_effective_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT u.role
      FROM public.app_users u
      WHERE u.auth_user_id = (SELECT auth.uid())
        AND u.status = 'active'
      ORDER BY CASE WHEN u.role = 'system_admin' THEN 0 ELSE 1 END, u.created_at ASC
      LIMIT 1
    ),
    CASE
      WHEN (SELECT auth.role()) = 'service_role' THEN 'system_admin'
      ELSE NULL
    END
  );
$$;

REVOKE ALL ON FUNCTION public.app_effective_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_effective_role() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Remove stale JWT OR bypasses & lock security_monitor_config (CRIT-02, HIGH-05)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'security_monitor_config') THEN
    DROP POLICY IF EXISTS "security_monitor_config_select" ON public.security_monitor_config;
    CREATE POLICY "security_monitor_config_select"
      ON public.security_monitor_config FOR SELECT
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      );

    DROP POLICY IF EXISTS "security_monitor_config_modify" ON public.security_monitor_config;
    CREATE POLICY "security_monitor_config_modify"
      ON public.security_monitor_config FOR ALL
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      )
      WITH CHECK (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      );

    REVOKE ALL ON public.security_monitor_config FROM PUBLIC, anon;
    GRANT SELECT, UPDATE ON public.security_monitor_config TO authenticated;
    GRANT ALL ON public.security_monitor_config TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_alert_deliveries') THEN
    DROP POLICY IF EXISTS "audit_alert_deliveries_service_only" ON public.audit_alert_deliveries;
    CREATE POLICY "audit_alert_deliveries_service_only"
      ON public.audit_alert_deliveries FOR ALL
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      )
      WITH CHECK ((SELECT auth.role()) = 'service_role');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs_archive') THEN
    DROP POLICY IF EXISTS "audit_logs_archive_select" ON public.audit_logs_archive;
    CREATE POLICY "audit_logs_archive_select"
      ON public.audit_logs_archive FOR SELECT
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
    CREATE POLICY "audit_logs_admin_select"
      ON public.audit_logs FOR SELECT
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'security_events') THEN
    DROP POLICY IF EXISTS "security_events_select_admin" ON public.security_events;
    CREATE POLICY "security_events_select_admin"
      ON public.security_events FOR SELECT
      TO authenticated, service_role
      USING (
        COALESCE(public.app_effective_role(), '') = 'system_admin'
        OR (SELECT auth.role()) = 'service_role'
      );
  END IF;
END $$;

-- Harden purge_expired_audit_logs(): remove stale JWT fallback & enforce >=30d floor
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs(p_retention_days INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retention INTEGER;
  v_cutoff TIMESTAMPTZ;
  v_archived_count BIGINT := 0;
  v_deleted_count BIGINT := 0;
  v_is_admin BOOLEAN;
BEGIN
  v_is_admin := (
    COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'غير مصرح: أرشفة وحذف سجلات التدقيق المنتهية مقتصر حصرياً على مدير النظام.'
      USING ERRCODE = '42501';
  END IF;

  SELECT retention_days INTO v_retention
  FROM public.security_monitor_config
  WHERE id = 'default'
  LIMIT 1;

  v_retention := COALESCE(p_retention_days, v_retention, 180);
  -- Enforce minimum 30-day audit retention floor so active forensic logs cannot be wiped prematurely
  v_retention := GREATEST(v_retention, 30);
  v_cutoff := now() - make_interval(days => v_retention);

  PERFORM set_config('app.audit_retention_purge', 'on', true);

  WITH expired AS (
    SELECT *
    FROM public.audit_logs
    WHERE created_at < v_cutoff
  ),
  ins AS (
    INSERT INTO public.audit_logs_archive (
      id, user_id, user_email, actor_id, actor_role, action, event_type,
      table_name, entity_type, record_id, entity_id, old_data, new_data,
      details, ip, user_agent, severity, archived_at, created_at
    )
    SELECT
      e.id, e.user_id, e.user_email, e.actor_id, e.actor_role, e.action, e.event_type,
      e.table_name, e.entity_type, e.record_id, e.entity_id, e.old_data, e.new_data,
      e.details, COALESCE(NULLIF(e.ip, ''), e.ip_address), e.user_agent, e.severity, now(), e.created_at
    FROM expired e
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_archived_count FROM ins;

  DELETE FROM public.audit_logs
  WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  PERFORM set_config('app.audit_retention_purge', 'off', true);

  RETURN jsonb_build_object(
    'success', true,
    'retention_days', v_retention,
    'cutoff', v_cutoff,
    'archived_rows', v_archived_count,
    'deleted_rows', v_deleted_count
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.audit_retention_purge', 'off', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs(INTEGER) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recursive JSONB secret redaction & fail-closed audit triggers (HIGH-06, MED-02)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sanitize_audit_json(
  p_data JSONB,
  p_table TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_out JSONB := '{}'::jsonb;
  v_arr JSONB := '[]'::jsonb;
  v_elem JSONB;
  v_sensitive_keys TEXT[] := ARRAY[
    'password',
    'password_hash',
    'activation_code',
    'verification_token_hash',
    'bot_token',
    'webhook_secret',
    'secret_token',
    'cron_secret',
    'n8n_webhook_url',
    'api_key',
    'gemini_api_key',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'smtp_pass'
  ];
BEGIN
  IF p_data IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_data) = 'array' THEN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(p_data) LOOP
      v_arr := v_arr || jsonb_build_array(public.sanitize_audit_json(v_elem, p_table));
    END LOOP;
    RETURN v_arr;
  END IF;

  IF jsonb_typeof(p_data) <> 'object' THEN
    RETURN p_data;
  END IF;

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_data) LOOP
    IF LOWER(v_key) = ANY(v_sensitive_keys) THEN
      v_out := v_out || jsonb_build_object(v_key, '[REDACTED]');
    ELSIF LOWER(v_key) = 'logo_data_url' AND jsonb_typeof(v_val) = 'string' AND length(v_val #>> '{}') > 256 THEN
      v_out := v_out || jsonb_build_object(v_key, '[REDACTED_DATA_URL]');
    ELSIF LOWER(v_key) = 'payload' AND p_table = 'system_backup_snapshots' THEN
      v_out := v_out || jsonb_build_object(v_key, '[SNAPSHOT_PAYLOAD_ARCHIVED]');
    ELSIF jsonb_typeof(v_val) IN ('object', 'array') THEN
      v_out := v_out || jsonb_build_object(v_key, public.sanitize_audit_json(v_val, p_table));
    ELSE
      v_out := v_out || jsonb_build_object(v_key, v_val);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_audit_json(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_audit_json(JSONB, TEXT) TO authenticated, service_role;

-- Harden sync_audit_log_fields(): preserve service_role actor_id & stop client event_type spoofing
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
  v_is_trusted BOOLEAN;
BEGIN
  v_is_service := (COALESCE((SELECT auth.role()), '') = 'service_role');
  v_is_trusted := (COALESCE(current_setting('app.trusted_security_writer', true), '') = 'on');
  v_jwt_uid := (SELECT auth.uid());
  v_jwt_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));

  IF v_jwt_uid IS NOT NULL THEN
    NEW.actor_id := v_jwt_uid;
    NEW.user_id := v_jwt_uid::TEXT;
    IF v_jwt_email <> '' THEN
      NEW.user_email := v_jwt_email;
    END IF;
  ELSIF v_is_service AND NEW.user_id IS NOT NULL AND NEW.user_id ~ '^[0-9a-fA-F-]{36}$' AND NEW.actor_id IS NULL THEN
    NEW.actor_id := NEW.user_id::UUID;
  ELSIF NEW.actor_id IS NOT NULL AND (NEW.user_id IS NULL OR NEW.user_id = '') THEN
    NEW.user_id := NEW.actor_id::TEXT;
  END IF;

  IF NOT v_is_service AND NOT v_is_trusted THEN
    v_effective_role := COALESCE(public.app_effective_role(), 'anon');
    IF v_effective_role IS NOT NULL AND v_effective_role <> '' THEN
      NEW.actor_role := v_effective_role;
    END IF;
  ELSIF v_is_trusted THEN
    NEW.actor_role := COALESCE(NULLIF(NEW.actor_role, ''), NULLIF(public.app_effective_role(), ''), 'anon');
  ELSE
    NEW.actor_role := COALESCE(NEW.actor_role, 'service_role');
  END IF;

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

  IF NEW.severity IS NULL OR NEW.severity NOT IN ('info', 'warning', 'critical') THEN
    NEW.severity := 'info';
  END IF;

  -- Direct authenticated client inserts cannot spoof critical severity OR reserved security event types
  IF NOT v_is_service AND NOT v_is_trusted THEN
    IF NEW.severity = 'critical' THEN
      NEW.severity := 'warning';
    END IF;
    IF LOWER(COALESCE(NEW.event_type, '')) IN (
      'role_permission_change',
      'self_role_permission_change',
      'mass_delete',
      'brute_force_failed_logins',
      'login_failed',
      'failed_login',
      'unauthorized_access',
      'cross_user_access',
      'admin_escalation',
      'security_alert'
    ) THEN
      NEW.event_type := 'client_event';
    END IF;
  END IF;

  NEW.old_data := public.sanitize_audit_json(NEW.old_data, COALESCE(NEW.table_name, ''));
  NEW.new_data := public.sanitize_audit_json(NEW.new_data, COALESCE(NEW.table_name, ''));
  NEW.details := public.sanitize_audit_json(NEW.details, COALESCE(NEW.table_name, ''));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_audit_log_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_audit_log_fields() TO service_role;

-- Update audit_table_change(): remove stale JWT check & always reset app.trusted_security_writer on EXCEPTION
CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op TEXT;
  v_table TEXT;
  v_record_id TEXT := '';
  v_actor_id UUID;
  v_actor_email TEXT := '';
  v_actor_role TEXT := 'anon';
  v_old_json JSONB := NULL;
  v_new_json JSONB := NULL;
  v_severity TEXT := 'info';
  v_event_type TEXT;
  v_action_summary TEXT := '';
  v_details JSONB := '{}'::jsonb;
  v_row_owner UUID := NULL;
  v_owner_text TEXT := '';
  v_mass_delete_threshold INT := 10;
  v_mass_delete_window INT := 5;
  v_recent_deletes INT := 0;
  v_is_self_change BOOLEAN := FALSE;
  v_is_system_admin BOOLEAN := FALSE;
  v_old_auth_uid UUID := NULL;
  v_new_auth_uid UUID := NULL;
BEGIN
  v_op := TG_OP;
  v_table := TG_TABLE_NAME;

  -- 1. Extract authentic actor identity (no stale auth.jwt()->'app_metadata' fallback)
  v_actor_id := (SELECT auth.uid());
  v_actor_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));
  v_actor_role := COALESCE(NULLIF(public.app_effective_role(), ''), 'anon');
  v_is_system_admin := (
    v_actor_role = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

  -- 2. Prepare Old & New JSON with sensitive data recursively masked
  IF v_op IN ('UPDATE', 'DELETE') THEN
    v_old_json := public.sanitize_audit_json(to_jsonb(OLD), v_table);
  END IF;

  IF v_op IN ('INSERT', 'UPDATE') THEN
    v_new_json := public.sanitize_audit_json(to_jsonb(NEW), v_table);
  END IF;

  -- 3. Extract Record Identifier
  IF v_op IN ('INSERT', 'UPDATE') THEN
    IF v_new_json ? 'id' THEN
      v_record_id := v_new_json->>'id';
    ELSIF v_new_json ? 'username' THEN
      v_record_id := v_new_json->>'username';
    ELSIF v_new_json ? 'code' THEN
      v_record_id := v_new_json->>'code';
    ELSIF v_new_json ? 'request_no' THEN
      v_record_id := v_new_json->>'request_no';
    ELSIF v_new_json ? 'po_no' THEN
      v_record_id := v_new_json->>'po_no';
    END IF;
  ELSE
    IF v_old_json ? 'id' THEN
      v_record_id := v_old_json->>'id';
    ELSIF v_old_json ? 'username' THEN
      v_record_id := v_old_json->>'username';
    ELSIF v_old_json ? 'code' THEN
      v_record_id := v_old_json->>'code';
    ELSIF v_old_json ? 'request_no' THEN
      v_record_id := v_old_json->>'request_no';
    ELSIF v_old_json ? 'po_no' THEN
      v_record_id := v_old_json->>'po_no';
    END IF;
  END IF;

  -- 4. Load Detection Config Thresholds
  SELECT
    COALESCE(mass_delete_threshold, 10),
    COALESCE(mass_delete_window_minutes, 5)
  INTO v_mass_delete_threshold, v_mass_delete_window
  FROM public.security_monitor_config
  WHERE id = 'default'
  LIMIT 1;

  v_mass_delete_threshold := COALESCE(v_mass_delete_threshold, 10);
  v_mass_delete_window := COALESCE(v_mass_delete_window, 5);

  -- 5. Default Event Type and Action
  v_event_type := LOWER(v_op) || '_' || v_table;
  v_action_summary := CASE
    WHEN v_op = 'INSERT' THEN 'إضافة سجل جديد في جدول ' || v_table
    WHEN v_op = 'UPDATE' THEN 'تحديث بيانات في جدول ' || v_table
    WHEN v_op = 'DELETE' THEN 'حذف سجل من جدول ' || v_table
    ELSE v_op || ' on ' || v_table
  END;

  -- RULE A: ANY ROLE / PERMISSION / STATUS / DELEGATION CHANGE -> CRITICAL
  IF v_table = 'app_users' AND v_op = 'UPDATE' THEN
    IF COALESCE(v_old_json->>'auth_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_old_auth_uid := (v_old_json->>'auth_user_id')::UUID;
    END IF;
    IF COALESCE(v_new_json->>'auth_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_new_auth_uid := (v_new_json->>'auth_user_id')::UUID;
    END IF;

    -- On AFTER UPDATE of app_users, preserve the actor's pre-update role so self-escalation
    -- does not cause app_effective_role() to report the newly promoted role as actor_role.
    IF v_actor_id IS NOT NULL AND v_actor_id = v_old_auth_uid AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
      v_actor_role := COALESCE(NULLIF(v_old_json->>'role', ''), v_actor_role);
      v_is_system_admin := (v_actor_role = 'system_admin');
    END IF;

    IF ((v_old_json->>'role') IS DISTINCT FROM (v_new_json->>'role'))
       OR ((v_old_json->'permissions') IS DISTINCT FROM (v_new_json->'permissions'))
       OR ((v_old_json->>'status') IS DISTINCT FROM (v_new_json->>'status'))
       OR ((v_old_json->>'department') IS DISTINCT FROM (v_new_json->>'department')) THEN

      v_severity := 'critical';
      v_event_type := 'role_permission_change';

      IF (v_actor_id IS NOT NULL AND (v_actor_id = v_old_auth_uid OR v_actor_id = v_new_auth_uid))
         OR (v_actor_email <> '' AND LOWER(v_actor_email) = LOWER(COALESCE(v_old_json->>'email', ''))) THEN
        v_is_self_change := TRUE;
        v_event_type := 'self_role_permission_change';
        v_action_summary := '⚠️ تنبيه أمني حرج للغاية: محاولة تعديل صلاحيات أو دور الحساب الشخصي للمستخدم (' || COALESCE(v_new_json->>'username', '') || ')';
      ELSE
        v_action_summary := 'تعديل الصلاحيات أو الدور الوظيفي للمستخدم (' || COALESCE(v_new_json->>'username', '') || '): ' || COALESCE(v_old_json->>'role', '') || ' -> ' || COALESCE(v_new_json->>'role', '');
      END IF;

      v_details := jsonb_build_object(
        'target_user', COALESCE(v_new_json->>'username', ''),
        'old_role', v_old_json->>'role',
        'new_role', v_new_json->>'role',
        'old_status', v_old_json->>'status',
        'new_status', v_new_json->>'status',
        'old_permissions', v_old_json->'permissions',
        'new_permissions', v_new_json->'permissions',
        'is_self_change', v_is_self_change
      );
    END IF;
  ELSIF v_table = 'organization_members' AND v_op IN ('UPDATE', 'DELETE') THEN
    IF v_op = 'DELETE' OR ((v_old_json->>'role') IS DISTINCT FROM (v_new_json->>'role')) THEN
      v_severity := 'critical';
      v_event_type := 'role_permission_change';
      v_action_summary := 'تعديل أو حذف عضوية دور في المؤسسة: ' || v_table;
    END IF;
  ELSIF v_table = 'registration_approval_settings' AND v_op = 'UPDATE' THEN
    IF (v_old_json->>'delegation_enabled') IS DISTINCT FROM (v_new_json->>'delegation_enabled') THEN
      v_severity := 'critical';
      v_event_type := 'delegation_setting_change';
      v_action_summary := 'تغيير إعداد تفويض اعتماد تسجيل الموظفين للقسم (' || COALESCE(v_new_json->>'department', '') || ')';
    END IF;
  END IF;

  -- RULE B: CROSS-USER ACCESS -> CRITICAL
  IF v_op IN ('UPDATE', 'DELETE') THEN
    IF v_table IN ('support_tickets', 'notifications') THEN
      v_owner_text := COALESCE(v_old_json->>'user_id', '');
    ELSIF v_table = 'purchase_requests' THEN
      v_owner_text := COALESCE(v_old_json->>'created_by_id', v_old_json->>'requester_id', '');
    ELSIF v_table = 'disbursement_requests' THEN
      v_owner_text := COALESCE(v_old_json->>'created_by', '');
    ELSIF v_table = 'profiles' THEN
      v_owner_text := COALESCE(v_old_json->>'id', '');
    ELSIF v_table = 'app_users' THEN
      v_owner_text := COALESCE(v_old_json->>'auth_user_id', '');
    END IF;

    IF v_owner_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_row_owner := v_owner_text::UUID;
    END IF;

    IF v_row_owner IS NOT NULL AND v_actor_id IS NOT NULL AND v_actor_id <> v_row_owner THEN
      IF NOT v_is_system_admin THEN
        v_severity := 'critical';
        IF NOT v_is_self_change AND v_event_type NOT IN ('role_permission_change', 'delegation_setting_change') THEN
          v_event_type := 'cross_user_access';
        END IF;
        v_action_summary := '⚠️ تنبيه أمني حرج: محاولة وصول وتعديل سجل خاص بمستخدم آخر في جدول (' || v_table || ')';
        v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_build_object(
          'target_record_id', v_record_id,
          'record_owner_id', v_row_owner,
          'caller_actor_id', v_actor_id,
          'operation', v_op,
          'alert', 'cross_user_modification_attempt'
        );
      END IF;
    END IF;
  END IF;

  -- RULE C: MASS DELETES -> CRITICAL
  IF v_op = 'DELETE' THEN
    SELECT COUNT(*) INTO v_recent_deletes
    FROM public.audit_logs
    WHERE (
        event_type IN ('delete', 'mass_delete', 'delete_operation')
        OR event_type LIKE 'delete\_%' ESCAPE '\'
      )
      AND created_at >= (now() - make_interval(mins => v_mass_delete_window))
      AND (
        (v_actor_id IS NOT NULL AND actor_id = v_actor_id)
        OR (v_actor_id IS NULL AND actor_role = v_actor_role)
      );

    IF v_recent_deletes >= v_mass_delete_threshold THEN
      v_severity := 'critical';
      v_event_type := 'mass_delete';
      v_action_summary := format('🚨 إنذار أمني حرج: رصد عملية حذف جماعي (%s عمليات خلال %s دقائق) على جدول %s',
        v_recent_deletes + 1, v_mass_delete_window, v_table);
      v_details := jsonb_build_object(
        'table', v_table,
        'recent_deletes_count', v_recent_deletes + 1,
        'window_minutes', v_mass_delete_window,
        'threshold', v_mass_delete_threshold,
        'deleted_record_id', v_record_id
      );
    ELSE
      IF v_severity <> 'critical' THEN
        v_severity := 'warning';
        v_event_type := 'delete_operation';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_security_writer', 'on', true);

  INSERT INTO public.audit_logs (
    actor_id,
    actor_role,
    event_type,
    table_name,
    record_id,
    old_data,
    new_data,
    severity,
    user_id,
    user_email,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_actor_id,
    v_actor_role,
    v_event_type,
    v_table,
    v_record_id,
    v_old_json,
    v_new_json,
    v_severity,
    COALESCE(v_actor_id::TEXT, ''),
    v_actor_email,
    v_action_summary,
    v_table,
    v_record_id,
    COALESCE(NULLIF(v_details, '{}'::jsonb), jsonb_build_object('operation', v_op, 'table', v_table, 'id', v_record_id))
  );

  PERFORM set_config('app.trusted_security_writer', 'off', true);

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.trusted_security_writer', 'off', true);
    IF TG_TABLE_NAME IN ('app_users', 'organization_members', 'registration_approval_settings') THEN
      RAISE;
    END IF;
    RAISE WARNING 'audit_table_change failed on % (%): %', TG_TABLE_NAME, TG_OP, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_table_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_table_change() TO service_role;

-- Harden record_security_event(): service_role-only (HIGH-06)
REVOKE ALL ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_security_event(
  p_event_type TEXT,
  p_action TEXT,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_severity TEXT DEFAULT 'warning',
  p_table_name TEXT DEFAULT '',
  p_record_id TEXT DEFAULT '',
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_email TEXT := '';
  v_actor_role TEXT := 'service_role';
  v_severity TEXT;
  v_event_type TEXT;
  v_action TEXT;
  v_ip TEXT;
  v_ua TEXT;
  v_cfg RECORD;
  v_failed_logins_count INT := 0;
  v_target_user TEXT;
  v_log_id UUID;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح: استدعاء record_security_event مقتصر حصرياً على service_role.'
      USING ERRCODE = '42501';
  END IF;

  v_actor_id := (SELECT auth.uid());
  v_actor_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));

  v_severity := LOWER(TRIM(COALESCE(p_severity, 'info')));
  IF v_severity NOT IN ('info', 'warning', 'critical') THEN
    v_severity := 'warning';
  END IF;

  v_event_type := COALESCE(NULLIF(TRIM(p_event_type), ''), 'security_event');
  v_action := COALESCE(NULLIF(TRIM(p_action), ''), v_event_type);
  v_ip := NULLIF(TRIM(COALESCE(p_ip, '')), '');
  v_ua := NULLIF(TRIM(COALESCE(p_user_agent, '')), '');

  SELECT * INTO v_cfg FROM public.security_monitor_config WHERE id = 'default' LIMIT 1;

  IF v_event_type IN ('login_failed', 'failed_login') THEN
    v_target_user := COALESCE(NULLIF(TRIM(p_details->>'identifier'), ''), NULLIF(TRIM(p_record_id), ''), v_ip, 'unknown');
    SELECT COUNT(*)::INT INTO v_failed_logins_count
    FROM public.audit_logs
    WHERE event_type IN ('login_failed', 'failed_login', 'brute_force_failed_logins')
      AND (
        record_id = v_target_user
        OR (v_ip IS NOT NULL AND ip = v_ip)
      )
      AND created_at >= now() - make_interval(mins => COALESCE(v_cfg.failed_login_window_minutes, 10));

    IF (v_failed_logins_count + 1) >= COALESCE(v_cfg.failed_login_threshold, 5) THEN
      v_severity := 'critical';
      v_event_type := 'brute_force_failed_logins';
      v_action := format('تنبيه اختراق محتمل: %s محاولة دخول فاشلة للحساب (%s) خلال %s دقائق',
        v_failed_logins_count + 1, v_target_user, COALESCE(v_cfg.failed_login_window_minutes, 10));
    END IF;
  END IF;

  IF v_event_type IN ('role_permission_change', 'self_role_permission_change', 'unauthorized_access', 'mass_delete') THEN
    v_severity := 'critical';
  END IF;

  PERFORM set_config('app.trusted_security_writer', 'on', true);

  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    actor_id,
    actor_role,
    action,
    event_type,
    table_name,
    entity_type,
    record_id,
    entity_id,
    details,
    ip,
    ip_address,
    user_agent,
    severity
  ) VALUES (
    COALESCE(v_actor_id::TEXT, 'service_role'),
    COALESCE(NULLIF(v_actor_email, ''), 'service_role'),
    v_actor_id,
    v_actor_role,
    v_action,
    v_event_type,
    COALESCE(p_table_name, ''),
    COALESCE(NULLIF(p_table_name, ''), 'security'),
    COALESCE(p_record_id, ''),
    COALESCE(p_record_id, ''),
    public.sanitize_audit_json(COALESCE(p_details, '{}'::jsonb), COALESCE(p_table_name, '')),
    v_ip,
    v_ip,
    v_ua,
    v_severity
  )
  RETURNING id INTO v_log_id;

  PERFORM set_config('app.trusted_security_writer', 'off', true);

  RETURN jsonb_build_object(
    'success', true,
    'id', v_log_id,
    'severity', v_severity,
    'event_type', v_event_type
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.trusted_security_writer', 'off', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Enforce HTTPS on n8n_webhook_url & REVOKE trigger functions from PUBLIC/anon/authenticated (MED-02)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'notify_n8n_security_event') THEN
    REVOKE ALL ON FUNCTION public.notify_n8n_security_event() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.notify_n8n_security_event() TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sync_login_attempt_to_security_events') THEN
    REVOKE ALL ON FUNCTION public.sync_login_attempt_to_security_events() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_login_attempt_to_security_events() TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sync_audit_log_to_security_events') THEN
    REVOKE ALL ON FUNCTION public.sync_audit_log_to_security_events() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_audit_log_to_security_events() TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_n8n_security_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg RECORD;
  v_webhook_url TEXT;
  v_webhook_secret TEXT;
  v_headers JSONB;
  v_payload JSONB;
  v_req_id BIGINT;
BEGIN
  SELECT n8n_webhook_url INTO v_cfg FROM public.security_monitor_config WHERE id = 'default' LIMIT 1;
  v_webhook_url := NULLIF(TRIM(COALESCE(v_cfg.n8n_webhook_url, current_setting('app.settings.n8n_security_webhook_url', true), '')), '');

  -- Require HTTPS scheme in webhook dispatch
  IF v_webhook_url IS NULL OR v_webhook_url !~* '^https://' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'n8n_security_webhook_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_webhook_secret := NULL;
  END;

  v_headers := jsonb_build_object('Content-Type', 'application/json');
  IF v_webhook_secret IS NOT NULL AND v_webhook_secret <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-n8n-webhook-secret', v_webhook_secret);
  END IF;

  v_payload := jsonb_build_object(
    'event', 'INSERT',
    'table', 'security_events',
    'record', to_jsonb(NEW)
  );

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT net.http_post(
      url := v_webhook_url,
      body := v_payload,
      headers := v_headers
    ) INTO v_req_id;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'notify_n8n_security_event failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_n8n_security_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_n8n_security_event() TO service_role;

-- Harden dispatch_security_webhook(): allowlist p_function_name & revoke from authenticated
CREATE OR REPLACE FUNCTION public.dispatch_security_webhook(
  p_function_name TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_supabase_url TEXT;
  v_cron_secret TEXT;
  v_service_role_key TEXT;
  v_headers JSONB;
  v_endpoint TEXT;
  v_request_id BIGINT;
  v_fn TEXT;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح: استدعاء dispatch_security_webhook مقتصر على service_role.'
      USING ERRCODE = '42501';
  END IF;

  v_fn := TRIM(COALESCE(p_function_name, ''));
  IF v_fn NOT IN ('daily-report', 'critical-alerts') THEN
    RAISE EXCEPTION 'اسم الدالة غير مسموح به في dispatch_security_webhook: %', v_fn
      USING ERRCODE = '22023';
  END IF;

  v_supabase_url := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://agfvwyycgqhzjbywyzqi.supabase.co'
  );
  v_cron_secret := NULLIF(current_setting('app.settings.cron_webhook_secret', true), '');
  v_service_role_key := NULLIF(current_setting('app.settings.service_role_key', true), '');

  BEGIN
    IF v_cron_secret IS NULL THEN
      SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE name = 'security_cron_secret' LIMIT 1;
    END IF;
    IF v_service_role_key IS NULL THEN
      SELECT decrypted_secret INTO v_service_role_key FROM vault.decrypted_secrets WHERE name IN ('service_role_key', 'supabase_service_role_key') LIMIT 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  v_endpoint := rtrim(v_supabase_url, '/') || '/functions/v1/' || v_fn;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'X-Client-Info', 'supabase-pg-cron-security');
  IF v_cron_secret IS NOT NULL AND v_cron_secret <> '' THEN
    v_headers := v_headers || jsonb_build_object('x-cron-secret', v_cron_secret);
  END IF;
  IF v_service_role_key IS NOT NULL AND v_service_role_key <> '' THEN
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_service_role_key, 'apikey', v_service_role_key);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT net.http_post(url := v_endpoint, body := p_payload, headers := v_headers) INTO v_request_id;
    RETURN jsonb_build_object('success', true, 'dispatched_via', 'pg_net', 'request_id', v_request_id, 'endpoint', v_endpoint);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'pg_net extension is not enabled', 'endpoint', v_endpoint);
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_security_webhook(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_security_webhook(TEXT, JSONB) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock down support_tickets & support-attachments bucket (HIGH-02)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'support_tickets') THEN
    REVOKE ALL ON public.support_tickets FROM PUBLIC, anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
    GRANT ALL ON public.support_tickets TO service_role;

    DROP POLICY IF EXISTS "Anyone can insert support tickets" ON public.support_tickets;
    DROP POLICY IF EXISTS "Authenticated users can insert support tickets" ON public.support_tickets;
    DROP POLICY IF EXISTS "Users can view their own tickets and admins see all" ON public.support_tickets;
    DROP POLICY IF EXISTS "Admins can update support tickets" ON public.support_tickets;
    DROP POLICY IF EXISTS "Admins can delete support tickets" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_select_policy" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_insert_policy" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_update_policy" ON public.support_tickets;
    DROP POLICY IF EXISTS "support_tickets_delete_policy" ON public.support_tickets;

    CREATE POLICY "support_tickets_select_policy"
      ON public.support_tickets FOR SELECT
      TO authenticated
      USING (
        user_id = (SELECT auth.uid())
        OR COALESCE(public.app_effective_role(), '') = 'system_admin'
      );

    CREATE POLICY "support_tickets_insert_policy"
      ON public.support_tickets FOR INSERT
      TO authenticated
      WITH CHECK (
        (SELECT auth.uid()) IS NOT NULL
        AND user_id = (SELECT auth.uid())
        AND status IN ('open', 'مفتوحة')
        AND admin_notes IS NULL
        AND resolved_by IS NULL
        AND resolved_at IS NULL
        AND length(trim(COALESCE(subject, ''))) > 0
      );

    CREATE POLICY "support_tickets_update_policy"
      ON public.support_tickets FOR UPDATE
      TO authenticated
      USING (COALESCE(public.app_effective_role(), '') = 'system_admin')
      WITH CHECK (COALESCE(public.app_effective_role(), '') = 'system_admin');

    CREATE POLICY "support_tickets_delete_policy"
      ON public.support_tickets FOR DELETE
      TO authenticated
      USING (COALESCE(public.app_effective_role(), '') = 'system_admin');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id = 'support-attachments';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Remove email backdoors & protect identity columns in protect_system_admin_row() (HIGH-02)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_system_admin_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_user TEXT;
  v_auth_role TEXT;
  v_is_direct_dba BOOLEAN;
  v_caller_is_sysadmin BOOLEAN;
BEGIN
  v_session_user := session_user;
  v_auth_role := COALESCE(
    NULLIF((SELECT auth.role()), ''),
    current_setting('request.jwt.claim.role', true),
    NULLIF(current_setting('role', true), '')
  );

  v_is_direct_dba := (v_session_user IN ('postgres', 'supabase_admin')) AND (v_auth_role IS DISTINCT FROM 'service_role');
  v_caller_is_sysadmin := (COALESCE(public.app_effective_role(), '') = 'system_admin');

  IF TG_OP = 'DELETE' THEN
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب مدير النظام الرئيسي محمي بشكل دائم ولا يمكن حذفه نهائياً من قاعدة البيانات.';
      END IF;
    END IF;
    IF LOWER(TRIM(OLD.username)) = 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب المشرف الرئيسي (admin) محمي ولا يمكن حذفه.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        IF (OLD.username IS DISTINCT FROM NEW.username) OR
           (OLD.role IS DISTINCT FROM NEW.role) OR
           (OLD.status IS DISTINCT FROM NEW.status) OR
           (OLD.permissions IS DISTINCT FROM NEW.permissions) OR
           (OLD.email IS DISTINCT FROM NEW.email AND OLD.email IS NOT NULL AND OLD.email <> '') OR
           (OLD.employee_id IS DISTINCT FROM NEW.employee_id AND OLD.employee_id IS NOT NULL AND OLD.employee_id <> '') OR
           (OLD.activation_code IS DISTINCT FROM NEW.activation_code AND OLD.activation_code IS NOT NULL AND OLD.activation_code <> '') OR
           (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id AND OLD.auth_user_id IS NOT NULL) OR
           (OLD.password IS DISTINCT FROM NEW.password) THEN
          RAISE EXCEPTION 'غير مصرح: بيانات وهوية حساب مدير النظام الرئيسي محمية بالكامل ولا يمكن تعديلها.';
        END IF;

        IF NEW.must_change_password IS TRUE AND OLD.must_change_password IS NOT TRUE THEN
          RAISE EXCEPTION 'غير مصرح: لا يمكن فرض تغيير كلمة المرور على حساب مدير النظام الرئيسي.';
        END IF;
      END IF;
    END IF;

    IF LOWER(TRIM(OLD.username)) = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن تخفيض صلاحيات المشرف الرئيسي (admin).';
      END IF;
    END IF;

    IF (OLD.role IS DISTINCT FROM NEW.role) OR
       (OLD.permissions IS DISTINCT FROM NEW.permissions) OR
       (OLD.status IS DISTINCT FROM NEW.status) OR
       (OLD.department IS DISTINCT FROM NEW.department) THEN
      IF NOT v_is_direct_dba AND (v_auth_role IS DISTINCT FROM 'service_role') THEN
        IF NOT v_caller_is_sysadmin THEN
          RAISE EXCEPTION 'غير مصرح: تعديل الأدوار الوظيفية والصلاحيات وحالة الحساب مقتصر حصرياً على مدير النظام الرئيسي.';
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.is_protected_username(NEW.username) THEN
      IF EXISTS (
        SELECT 1 FROM public.app_users
        WHERE public.is_protected_username(username)
      ) THEN
        RAISE EXCEPTION 'اسم المستخدم محجوز لحساب مدير النظام الرئيسي ولا يمكن إنشاء حساب مطابق أو مشابه.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.protect_system_admin_row() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_system_admin_row() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Prevent disbursement_requests self-approval & restore PO RPC (HIGH-04, MED-01)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'disbursement_requests') THEN
    DROP POLICY IF EXISTS "role_update" ON public.disbursement_requests;
    CREATE POLICY "role_update"
      ON public.disbursement_requests FOR UPDATE
      TO authenticated
      USING (
        public.app_effective_role() IN ('system_admin', 'warehouse_admin')
        OR (created_by = (SELECT auth.uid()) AND status = 'pending')
      )
      WITH CHECK (
        public.app_effective_role() IN ('system_admin', 'warehouse_admin')
        OR (
          created_by = (SELECT auth.uid())
          AND status = 'rejected'
          AND approved_by IS NULL
          AND approved_at IS NULL
          AND issued_at IS NULL
        )
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_purchase_order'
      AND pg_get_function_identity_arguments(p.oid) = 'p_quote_id uuid'
  ) THEN
    ALTER FUNCTION public.create_purchase_order(UUID) SECURITY DEFINER;
    ALTER FUNCTION public.create_purchase_order(UUID) SET search_path = public, pg_temp;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Apply missing pending constraints, telegram session lock, warehouse log RLS (MED-08)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_users') THEN
    UPDATE public.app_users
    SET status = 'active'
    WHERE status IS NULL OR status NOT IN ('active', 'pending_activation', 'suspended');

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_app_users_status' AND conrelid = 'public.app_users'::regclass
    ) THEN
      ALTER TABLE public.app_users
        ADD CONSTRAINT chk_app_users_status
        CHECK (status IN ('active', 'pending_activation', 'suspended'));
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'telegram_user_sessions') THEN
    REVOKE ALL ON public.telegram_user_sessions FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.telegram_user_sessions TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'warehouse_merge_audit_log') THEN
    REVOKE ALL ON public.warehouse_merge_audit_log FROM PUBLIC, anon;
    DROP POLICY IF EXISTS "warehouse_merge_audit_log_admin_all" ON public.warehouse_merge_audit_log;
    DROP POLICY IF EXISTS "warehouse_merge_audit_log_admin_select" ON public.warehouse_merge_audit_log;
    CREATE POLICY "warehouse_merge_audit_log_admin_select"
      ON public.warehouse_merge_audit_log FOR SELECT
      TO authenticated
      USING (COALESCE(public.app_effective_role(), '') = 'system_admin');
  END IF;
END $$;

