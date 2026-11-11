-- ==============================================================================
-- Migration: 20261111161000_security_triggers_and_detection_rules.sql
-- Description:
-- 1. Helper function public.sanitize_audit_json() to strip and mask secrets:
--    passwords, activation codes, OTP verification tokens, large data URLs.
-- 2. Universal DML trigger function public.audit_table_change() that logs
--    INSERT / UPDATE / DELETE on every business table with actor = auth.uid().
-- 3. Implements security detection rules with thresholds from security_monitor_config:
--    - Role / permission / status / delegation changes -> CRITICAL (Extra critical on self-change)
--    - Cross-user modifications (actor != owner) -> CRITICAL
--    - Mass deletes (> 10 rows in 5 mins) -> CRITICAL
-- 4. RPC public.record_security_event() for frontend / Edge Function security traps:
--    - 5+ failed logins for account or IP in 10 mins -> CRITICAL
--    - Unauthorized page/route or API access -> WARNING / CRITICAL
--    - New IP or unusual-hours login -> WARNING
-- 5. Attaches audit triggers to all existing business and security tables.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper Function: Sanitize and Mask Sensitive Data in JSONB
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sanitize_audit_json(
  p_data JSONB,
  p_table TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB := p_data;
  v_key TEXT;
  v_sensitive_keys TEXT[] := ARRAY[
    'password',
    'new_password',
    'password_hash',
    'activation_code',
    'verification_token_hash',
    'verification_token',
    'bot_token',
    'telegram_bot_token',
    'webhook_secret',
    'api_key',
    'access_token',
    'refresh_token',
    'secret'
  ];
BEGIN
  IF v_result IS NULL OR jsonb_typeof(v_result) <> 'object' THEN
    RETURN v_result;
  END IF;

  -- 1. Mask passwords, tokens, and secrets uniformly
  FOREACH v_key IN ARRAY v_sensitive_keys LOOP
    IF v_result ? v_key THEN
      v_result := jsonb_set(v_result, ARRAY[v_key], '"[REDACTED]"'::jsonb, true);
    END IF;
  END LOOP;

  -- 2. Mask or truncate large base64 data URLs to prevent audit_logs bloat
  IF v_result ? 'logo_data_url' THEN
    IF length(COALESCE(v_result->>'logo_data_url', '')) > 256 THEN
      v_result := jsonb_set(v_result, '{logo_data_url}', '"[REDACTED_DATA_URL]"'::jsonb, true);
    END IF;
  END IF;

  IF v_result ? 'payload' AND p_table = 'system_backup_snapshots' THEN
    v_result := jsonb_set(v_result, '{payload}', '"[SNAPSHOT_PAYLOAD_ARCHIVED]"'::jsonb, true);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_audit_json(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_audit_json(JSONB, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Universal Audit & Security Detection Trigger Function
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_cfg RECORD;
  v_recent_deletes INT := 0;
  v_is_self_change BOOLEAN := FALSE;
  v_is_system_admin BOOLEAN := FALSE;
  v_old_auth_uid UUID := NULL;
  v_new_auth_uid UUID := NULL;
BEGIN
  v_op := TG_OP;
  v_table := TG_TABLE_NAME;

  -- 1. Extract authentic actor identity
  v_actor_id := (SELECT auth.uid());
  v_actor_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));
  v_actor_role := COALESCE(public.app_effective_role(), (SELECT auth.jwt())->'app_metadata'->>'role', 'anon');
  v_is_system_admin := (
    v_actor_role = 'system_admin'
    OR COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR public.is_system_admin()
  );

  -- 2. Prepare Old & New JSON with sensitive data masked
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
  SELECT * INTO v_cfg
  FROM public.security_monitor_config
  WHERE id = 'default'
  LIMIT 1;

  IF NOT FOUND THEN
    v_cfg.mass_delete_threshold := 10;
    v_cfg.mass_delete_window_minutes := 5;
  END IF;

  -- 5. Default Event Type and Action
  v_event_type := LOWER(v_op) || '_' || v_table;
  v_action_summary := CASE
    WHEN v_op = 'INSERT' THEN 'إضافة سجل جديد في جدول ' || v_table
    WHEN v_op = 'UPDATE' THEN 'تحديث بيانات في جدول ' || v_table
    WHEN v_op = 'DELETE' THEN 'حذف سجل من جدول ' || v_table
    ELSE v_op || ' on ' || v_table
  END;

  -- ───────────────────────────────────────────────────────────────────────────
  -- RULE A: ANY ROLE / PERMISSION / STATUS / DELEGATION CHANGE -> CRITICAL
  -- Read strictly via JSONB (v_old_json / v_new_json) to avoid record binding
  -- errors when PL/pgSQL executes this generic trigger across 25+ tables.
  -- ───────────────────────────────────────────────────────────────────────────
  IF v_table = 'app_users' AND v_op = 'UPDATE' THEN
    IF ((v_old_json->>'role') IS DISTINCT FROM (v_new_json->>'role'))
       OR ((v_old_json->'permissions') IS DISTINCT FROM (v_new_json->'permissions'))
       OR ((v_old_json->>'status') IS DISTINCT FROM (v_new_json->>'status'))
       OR ((v_old_json->>'department') IS DISTINCT FROM (v_new_json->>'department')) THEN

      v_severity := 'critical';
      v_event_type := 'role_permission_change';

      IF COALESCE(v_old_json->>'auth_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_old_auth_uid := (v_old_json->>'auth_user_id')::UUID;
      END IF;
      IF COALESCE(v_new_json->>'auth_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_new_auth_uid := (v_new_json->>'auth_user_id')::UUID;
      END IF;

      -- Check self-role modification (user changing their own account role/status)
      IF (v_actor_id IS NOT NULL AND (v_actor_id = v_old_auth_uid OR v_actor_id = v_new_auth_uid))
         OR (v_actor_email <> '' AND LOWER(v_actor_email) = LOWER(COALESCE(v_old_json->>'email', ''))) THEN
        v_is_self_change := TRUE;
        v_event_type := 'self_role_permission_change';
        v_action_summary := '⚠️ تنبيه أمني حرج للغاية: محاولة تعديل صلاحيات أو دور الحساب الشخصي للمستخدم (' || COALESCE(v_new_json->>'username', '') || ')';
      ELSE
        v_action_summary := 'تعديل الصلاحيات أو الدور الوظيفي للمستخدم (' || COALESCE(v_new_json->>'username', '') || '): ' || COALESCE(v_old_json->>'role', '') || ' ➔ ' || COALESCE(v_new_json->>'role', '');
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
      v_action_summary := 'تغيير إعداد تفويض اعتماد تسجيل الموظفين للقسم (' || COALESCE(v_new_json->>'department', '') || ') إلى: ' || CASE WHEN COALESCE((v_new_json->>'delegation_enabled')::BOOLEAN, false) THEN 'مفعّل' ELSE 'معطّل' END;
    END IF;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- RULE B: CROSS-USER ACCESS (MODIFYING ANOTHER USER'S OWNED RECORD) -> CRITICAL
  -- Evaluated independently of RULE A so non-role updates to app_users by
  -- another non-admin actor are also flagged.
  -- ───────────────────────────────────────────────────────────────────────────
  IF v_op IN ('UPDATE', 'DELETE') THEN
    IF v_table IN ('support_tickets', 'notifications') THEN
      v_owner_text := COALESCE(v_old_json->>'user_id', '');
    ELSIF v_table = 'purchase_requests' THEN
      v_owner_text := COALESCE(v_old_json->>'created_by_id', '');
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

    -- If record belongs to a specific user and caller is NOT that user and NOT system_admin:
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

  -- ───────────────────────────────────────────────────────────────────────────
  -- RULE C: MASS DELETES (> 10 ROWS IN 5 MINUTES) -> CRITICAL
  -- ───────────────────────────────────────────────────────────────────────────
  IF v_op = 'DELETE' THEN
    -- Count recent deletes performed by this actor in the last window minutes
    SELECT COUNT(*) INTO v_recent_deletes
    FROM public.audit_logs
    WHERE (
        event_type IN ('delete', 'mass_delete', 'delete_operation')
        OR event_type LIKE 'delete\_%' ESCAPE '\'
      )
      AND created_at >= (now() - (v_cfg.mass_delete_window_minutes || ' minutes')::INTERVAL)
      AND (
        (v_actor_id IS NOT NULL AND actor_id = v_actor_id)
        OR (v_actor_id IS NULL AND actor_role = v_actor_role)
      );

    -- Note: v_recent_deletes is prior deletes; >= threshold fires on the (threshold + 1)-th delete (> 10 rows).
    IF v_recent_deletes >= v_cfg.mass_delete_threshold THEN
      v_severity := 'critical';
      v_event_type := 'mass_delete';
      v_action_summary := '🚨 إنذار أمني حرج: رصد عملية حذف جماعي (' || (v_recent_deletes + 1) || ' عمليات حذف خلال ' || v_cfg.mass_delete_window_minutes || ' دقائق) على جدول ' || v_table;
      v_details := jsonb_build_object(
        'table', v_table,
        'recent_deletes_count', v_recent_deletes + 1,
        'window_minutes', v_cfg.mass_delete_window_minutes,
        'threshold', v_cfg.mass_delete_threshold,
        'deleted_record_id', v_record_id
      );
    ELSE
      IF v_severity <> 'critical' THEN
        v_severity := 'warning';
        v_event_type := 'delete_operation';
      END IF;
    END IF;
  END IF;

  -- 6. Insert audit record directly into public.audit_logs
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

  IF v_op = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Ensure business operations never fail due to audit logging failures
    RAISE WARNING 'audit_table_change error on %: %', v_table, SQLERRM;
    IF v_op = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_table_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_table_change() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Security Event Ingestion RPC (public.record_security_event)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_actor_role TEXT := 'anon';
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
  v_actor_id := (SELECT auth.uid());
  v_actor_email := LOWER(TRIM(COALESCE((SELECT auth.jwt())->>'email', '')));
  v_actor_role := COALESCE(public.app_effective_role(), (SELECT auth.jwt())->'app_metadata'->>'role', 'anon');

  v_severity := LOWER(TRIM(COALESCE(p_severity, 'info')));
  IF v_severity NOT IN ('info', 'warning', 'critical') THEN
    v_severity := 'warning';
  END IF;

  v_event_type := LOWER(TRIM(COALESCE(p_event_type, 'security_event')));
  v_action := COALESCE(p_action, v_event_type);
  v_ip := COALESCE(NULLIF(TRIM(p_ip), ''), '127.0.0.1');
  v_ua := COALESCE(NULLIF(TRIM(p_user_agent), ''), 'Client');

  -- Load Configuration Thresholds
  SELECT * INTO v_cfg
  FROM public.security_monitor_config
  WHERE id = 'default'
  LIMIT 1;

  IF NOT FOUND THEN
    v_cfg.failed_login_threshold := 5;
    v_cfg.failed_login_window_minutes := 10;
  END IF;

  -- ───────────────────────────────────────────────────────────────────────────
  -- BRUTE-FORCE FAILED LOGINS RULE:
  -- 5+ failed logins for same account or IP in 10 minutes -> CRITICAL
  -- ───────────────────────────────────────────────────────────────────────────
  IF v_event_type IN ('failed_login', 'login_failure', 'auth_failed') THEN
    v_target_user := LOWER(TRIM(COALESCE(p_details->>'username', p_details->>'identifier', v_actor_email, '')));

    -- Count recent failed attempts from login_attempts and audit_logs in the window
    SELECT COUNT(*) INTO v_failed_logins_count
    FROM public.audit_logs
    WHERE event_type IN ('failed_login', 'login_failure', 'auth_failed', 'brute_force_failed_logins')
      AND created_at >= (now() - (v_cfg.failed_login_window_minutes || ' minutes')::INTERVAL)
      AND (
        (v_target_user <> '' AND (LOWER(details->>'username') = v_target_user OR LOWER(details->>'identifier') = v_target_user OR user_email = v_target_user))
        OR (v_ip <> '' AND (ip = v_ip OR details->>'ip' = v_ip))
      );

    IF (v_failed_logins_count + 1) >= v_cfg.failed_login_threshold THEN
      v_severity := 'critical';
      v_event_type := 'brute_force_failed_logins';
      v_action := '🚨 تنبيه أمني حرج: رصد هجوم تخمين وتكرار محاولات دخول فاشلة (' || (v_failed_logins_count + 1) || ' محاولات خلال ' || v_cfg.failed_login_window_minutes || ' دقائق) للحساب أو العنوان: ' || COALESCE(NULLIF(v_target_user, ''), v_ip);
    ELSE
      v_severity := 'warning';
    END IF;

  ELSIF v_event_type IN ('unauthorized_page_access', 'unauthorized_api_access') THEN
    v_severity := 'warning';

  ELSIF v_event_type IN ('role_permission_change', 'self_role_permission_change', 'cross_user_access', 'mass_delete') THEN
    v_severity := 'critical';
  END IF;

  PERFORM set_config('app.trusted_security_writer', 'on', true);

  INSERT INTO public.audit_logs (
    actor_id,
    actor_role,
    event_type,
    table_name,
    record_id,
    ip,
    user_agent,
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
    COALESCE(p_table_name, ''),
    COALESCE(p_record_id, ''),
    v_ip,
    v_ua,
    v_severity,
    COALESCE(v_actor_id::TEXT, v_target_user, ''),
    COALESCE(NULLIF(v_actor_email, ''), v_target_user, ''),
    v_action,
    COALESCE(NULLIF(p_table_name, ''), 'security'),
    COALESCE(p_record_id, ''),
    COALESCE(p_details, '{}'::jsonb) || jsonb_build_object('client_reported', true, 'ip', v_ip)
  )
  RETURNING id INTO v_log_id;

  PERFORM set_config('app.trusted_security_writer', 'off', true);

  RETURN jsonb_build_object(
    'success', true,
    'audit_log_id', v_log_id,
    'severity', v_severity,
    'event_type', v_event_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_security_event(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Dynamically Attach Audit Triggers to Every Business Table
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  target_tables TEXT[] := ARRAY[
    'app_users',
    'movements',
    'custody_items',
    'suppliers',
    'supplier_contracts',
    'purchase_requests',
    'purchase_request_items',
    'purchase_request_approvals',
    'supplier_quotes',
    'purchase_orders',
    'disbursement_requests',
    'budget_plans',
    'financial_reports',
    'technical_inspections',
    'inventory_settlements',
    'asset_movement_log',
    'app_settings',
    'support_tickets',
    'registration_requests',
    'registration_approval_settings',
    'employee_code_registry',
    'user_invitations',
    'organization_members',
    'organizations',
    'profiles',
    'notifications',
    'system_backup_snapshots',
    'system_bootstrap_state',
    'telegram_bot_settings'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = t
        AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
      EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_table_change()', t, t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

