-- Migration: 20261111163000_n8n_security_events_bridge.sql
-- Purpose: Connect warehouse-ledger's real auth/audit pipeline (login_attempts + audit_logs)
-- cleanly to public.security_events so the n8n "Supabase Security Monitor" workflow
-- receives all login, role_change, access_denied, and mass_delete events with valid UUIDs.
-- Safe, additive, idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ensure public.security_events exists and has required bridge columns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  email TEXT,
  ip_address TEXT,
  user_id TEXT,
  changed_by TEXT,
  target_user_id TEXT,
  new_role TEXT,
  alerted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.security_events
  ADD COLUMN IF NOT EXISTS changed_by_role TEXT,
  ADD COLUMN IF NOT EXISTS source_audit_log_id UUID,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_security_events_created_alerted
  ON public.security_events (created_at DESC, alerted);

CREATE INDEX IF NOT EXISTS idx_security_events_event_type_created
  ON public.security_events (event_type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_events_source_audit_log_id
  ON public.security_events (source_audit_log_id)
  WHERE source_audit_log_id IS NOT NULL;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_events_select_admin" ON public.security_events;
CREATE POLICY "security_events_select_admin"
  ON public.security_events FOR SELECT
  TO authenticated, service_role
  USING (
    COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::BOOLEAN, false) = true
    OR COALESCE((SELECT auth.jwt())->'app_metadata'->>'role', '') = 'system_admin'
    OR COALESCE(public.app_effective_role(), '') = 'system_admin'
    OR (SELECT auth.role()) = 'service_role'
  );

REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;

-- Optional Webhook URL setting on centralized security_monitor_config
ALTER TABLE public.security_monitor_config
  ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Upgrade log_login_attempt() to resolve Auth UUID while protecting system_admin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_login_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_app_user_id TEXT := NULL;
  v_auth_user_id UUID := NULL;
  v_app_role TEXT := NULL;
  v_app_username TEXT := NULL;
  v_app_email TEXT := NULL;
  v_auth_email TEXT := NULL;
  v_is_protected BOOLEAN := false;
  v_resolved_user_id TEXT := NULL;
  v_resolved_email TEXT := NEW.username;
  v_event_type TEXT := CASE WHEN COALESCE(NEW.success, false) THEN 'login_success' ELSE 'login_failed' END;
  v_severity TEXT := CASE WHEN COALESCE(NEW.success, false) THEN 'info' ELSE 'warning' END;
BEGIN
  -- Resolve matching user in app_users by username, email, or @warehouse.local local part
  IF COALESCE(TRIM(NEW.username), '') <> '' THEN
    SELECT u.id, u.auth_user_id, u.role, u.username, u.email
    INTO v_app_user_id, v_auth_user_id, v_app_role, v_app_username, v_app_email
    FROM public.app_users u
    WHERE lower(u.username) = lower(TRIM(NEW.username))
       OR (NULLIF(u.email, '') IS NOT NULL AND lower(u.email) = lower(TRIM(NEW.username)))
       OR (
         lower(TRIM(NEW.username)) LIKE '%@warehouse.local'
         AND lower(u.username) = split_part(lower(TRIM(NEW.username)), '@', 1)
       )
    ORDER BY (u.auth_user_id IS NOT NULL) DESC, u.id ASC
    LIMIT 1;

    IF v_auth_user_id IS NULL THEN
      SELECT au.id, au.email
      INTO v_auth_user_id, v_auth_email
      FROM auth.users au
      WHERE lower(au.email) = lower(TRIM(NEW.username))
      LIMIT 1;
    END IF;
  END IF;

  -- Keep consistent email/identifier across failed and successful logins
  v_resolved_email := COALESCE(
    NULLIF(TRIM(v_app_email), ''),
    NULLIF(TRIM(v_auth_email), ''),
    NULLIF(TRIM(v_app_username), ''),
    NEW.username
  );

  -- Never expose system_admin Auth UUID as a one-click Telegram ban target (prevents owner lockout DoS)
  v_is_protected :=
    lower(COALESCE(v_app_role, '')) = 'system_admin'
    OR lower(COALESCE(v_app_username, '')) = 'marwan-desouky'
    OR lower(COALESCE(TRIM(NEW.username), '')) IN ('marwan-desouky', 'marwan-desouky@warehouse.local');

  IF NOT v_is_protected AND v_auth_user_id IS NOT NULL THEN
    v_resolved_user_id := v_auth_user_id::TEXT;
  END IF;

  INSERT INTO public.security_events (
    event_type,
    email,
    ip_address,
    user_id,
    target_user_id,
    severity,
    details,
    created_at
  ) VALUES (
    v_event_type,
    v_resolved_email,
    NULLIF(TRIM(COALESCE(NEW.ip_address, '')), ''),
    v_resolved_user_id,
    v_resolved_user_id,
    v_severity,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'login_attempts',
      'login_attempt_id', NEW.id,
      'raw_identifier', NEW.username,
      'app_user_id', v_app_user_id,
      'protected_account', v_is_protected
    )),
    COALESCE(NEW.attempted_at, now())
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.login_attempts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_login_attempts_to_security_events ON public.login_attempts;
    CREATE TRIGGER trg_login_attempts_to_security_events
      AFTER INSERT ON public.login_attempts
      FOR EACH ROW
      EXECUTE FUNCTION public.log_login_attempt();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Bridge public.audit_logs -> public.security_events for n8n Detection Rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_audit_log_to_security_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mapped_event_type TEXT := NULL;
  v_email TEXT := NULL;
  v_ip TEXT := NULL;
  v_actor_text TEXT := COALESCE(NEW.actor_id::TEXT, NULLIF(NEW.user_id, ''));
  v_target_id TEXT := NULL;
  v_new_role TEXT := NULL;
  v_changed_by_role TEXT := NULL;
  v_is_target_protected BOOLEAN := false;
  v_is_actor_protected BOOLEAN := false;
  v_lu_auth_id TEXT := NULL;
  v_lu_role TEXT := NULL;
  v_lu_username TEXT := NULL;
BEGIN
  v_ip := COALESCE(NULLIF(TRIM(COALESCE(NEW.ip, '')), ''), NULLIF(TRIM(COALESCE(NEW.ip_address, '')), ''));
  v_email := COALESCE(
    NULLIF(TRIM(COALESCE(NEW.details->>'target_username', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.new_data->>'email', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.new_data->>'username', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.user_email, '')), ''),
    NULLIF(TRIM(COALESCE(NEW.actor_role, '')), '')
  );

  v_is_actor_protected := lower(COALESCE(NEW.actor_role, '')) = 'system_admin'
    OR lower(COALESCE(NEW.user_email, '')) IN ('marwan-desouky', 'marwan-desouky@warehouse.local');

  -- A. Role / permission / account status changes
  IF NEW.event_type IN ('role_permission_change', 'self_role_permission_change') THEN
    v_mapped_event_type := 'role_change';

    -- Resolve target Auth UUID when possible (needed for self-change comparison & Telegram block button)
    v_target_id := COALESCE(
      NULLIF(TRIM(COALESCE(NEW.details->>'target_id', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.new_data->>'auth_user_id', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.old_data->>'auth_user_id', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.record_id, '')), '')
    );

    -- Look up auth_user_id if record_id holds app_users.id instead of UUID
    IF v_target_id IS NOT NULL AND v_target_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      SELECT u.auth_user_id::TEXT, u.role, u.username
      INTO v_lu_auth_id, v_lu_role, v_lu_username
      FROM public.app_users u
      WHERE u.id = v_target_id
      LIMIT 1;

      IF FOUND THEN
        v_target_id := COALESCE(NULLIF(v_lu_auth_id, ''), v_target_id);
        v_email := COALESCE(NULLIF(TRIM(COALESCE(v_lu_username, '')), ''), v_email);
      END IF;
    END IF;

    IF NEW.event_type = 'self_role_permission_change' AND v_actor_text IS NOT NULL THEN
      v_target_id := COALESCE(v_target_id, v_actor_text);
    END IF;

    v_new_role := COALESCE(
      NULLIF(TRIM(COALESCE(NEW.new_data->>'role', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.details->>'new_role', '')), ''),
      NULLIF(TRIM(COALESCE(NEW.new_data->>'status', '')), ''),
      NULLIF(TRIM(COALESCE(v_lu_role, '')), '')
    );

    -- Normalize system_admin/admin to 'admin' so existing n8n Detect Incidents Rule 4 recognizes admins cleanly
    v_changed_by_role := CASE
      WHEN lower(COALESCE(NEW.actor_role, '')) IN ('system_admin', 'admin') THEN 'admin'
      WHEN TRIM(COALESCE(NEW.actor_role, '')) = '' THEN NULL
      ELSE NEW.actor_role
    END;

    -- Protect pre-existing system_admin owner accounts from Telegram one-click ban exposure
    v_is_target_protected :=
      lower(COALESCE(NEW.old_data->>'role', '')) = 'system_admin'
      OR lower(COALESCE(v_lu_role, '')) = 'system_admin'
      OR lower(COALESCE(v_email, '')) IN ('marwan-desouky', 'marwan-desouky@warehouse.local');

    INSERT INTO public.security_events (
      event_type, email, ip_address, user_id, changed_by, changed_by_role,
      target_user_id, new_role, severity, source_audit_log_id, details, created_at
    ) VALUES (
      v_mapped_event_type,
      v_email,
      v_ip,
      CASE WHEN v_is_target_protected THEN NULL ELSE v_target_id END,
      v_actor_text,
      v_changed_by_role,
      CASE WHEN v_is_target_protected THEN NULL ELSE v_target_id END,
      v_new_role,
      NEW.severity,
      NEW.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'audit_logs',
        'audit_event_type', NEW.event_type,
        'action', NEW.action,
        'table_name', NEW.table_name
      )),
      COALESCE(NEW.created_at, now())
    )
    ON CONFLICT (source_audit_log_id) WHERE source_audit_log_id IS NOT NULL DO NOTHING;

    RETURN NEW;
  END IF;

  -- B. Unauthorized access attempts and cross-user access
  IF NEW.event_type IN ('unauthorized_page_access', 'unauthorized_api_access', 'cross_user_access') THEN
    v_mapped_event_type := 'access_denied';

    INSERT INTO public.security_events (
      event_type, email, ip_address, user_id, target_user_id,
      severity, source_audit_log_id, details, created_at
    ) VALUES (
      v_mapped_event_type,
      v_email,
      v_ip,
      v_actor_text,
      CASE WHEN v_is_actor_protected THEN NULL ELSE v_actor_text END,
      NEW.severity,
      NEW.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'audit_logs',
        'audit_event_type', NEW.event_type,
        'action', NEW.action,
        'table_name', NEW.table_name
      )),
      COALESCE(NEW.created_at, now())
    )
    ON CONFLICT (source_audit_log_id) WHERE source_audit_log_id IS NOT NULL DO NOTHING;

    RETURN NEW;
  END IF;

  -- C. Mass delete
  IF NEW.event_type = 'mass_delete' THEN
    INSERT INTO public.security_events (
      event_type, email, ip_address, user_id, target_user_id,
      severity, source_audit_log_id, details, created_at
    ) VALUES (
      'mass_delete',
      v_email,
      v_ip,
      v_actor_text,
      CASE WHEN v_is_actor_protected THEN NULL ELSE v_actor_text END,
      NEW.severity,
      NEW.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'audit_logs',
        'audit_event_type', NEW.event_type,
        'action', NEW.action,
        'table_name', NEW.table_name
      )),
      COALESCE(NEW.created_at, now())
    )
    ON CONFLICT (source_audit_log_id) WHERE source_audit_log_id IS NOT NULL DO NOTHING;

    RETURN NEW;
  END IF;

  -- D. Fallback login anomalies & direct auth failures not already captured by login_attempts
  IF NEW.event_type IN ('login_new_ip', 'login_unusual_hour', 'login_new_ip_unusual_hour') THEN
    INSERT INTO public.security_events (
      event_type, email, ip_address, user_id, target_user_id,
      severity, source_audit_log_id, details, created_at
    ) VALUES (
      'login_anomaly',
      v_email,
      v_ip,
      v_actor_text,
      CASE WHEN v_is_actor_protected THEN NULL ELSE v_actor_text END,
      NEW.severity,
      NEW.id,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'audit_logs',
        'audit_event_type', NEW.event_type,
        'action', NEW.action
      )),
      COALESCE(NEW.created_at, now())
    )
    ON CONFLICT (source_audit_log_id) WHERE source_audit_log_id IS NOT NULL DO NOTHING;

    RETURN NEW;
  END IF;

  IF NEW.event_type IN ('failed_login', 'brute_force_failed_logins', 'login_success') THEN
    v_mapped_event_type := CASE
      WHEN NEW.event_type IN ('failed_login', 'brute_force_failed_logins') THEN 'login_failed'
      ELSE 'login_success'
    END;

    -- Avoid duplicating rows already inserted by trg_login_attempts_to_security_events within +/-10s
    IF NOT EXISTS (
      SELECT 1
      FROM public.security_events se
      WHERE se.event_type = v_mapped_event_type
        AND lower(COALESCE(se.email, '')) = lower(COALESCE(v_email, ''))
        AND se.created_at BETWEEN (COALESCE(NEW.created_at, now()) - INTERVAL '10 seconds')
                              AND (COALESCE(NEW.created_at, now()) + INTERVAL '10 seconds')
    ) THEN
      INSERT INTO public.security_events (
        event_type, email, ip_address, user_id, target_user_id,
        severity, source_audit_log_id, details, created_at
      ) VALUES (
        v_mapped_event_type,
        v_email,
        v_ip,
        CASE WHEN v_is_actor_protected THEN NULL ELSE v_actor_text END,
        CASE WHEN v_is_actor_protected THEN NULL ELSE v_actor_text END,
        NEW.severity,
        NEW.id,
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'audit_logs_fallback',
          'audit_event_type', NEW.event_type,
          'action', NEW.action
        )),
        COALESCE(NEW.created_at, now())
      )
      ON CONFLICT (source_audit_log_id) WHERE source_audit_log_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_to_security_events ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_to_security_events
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_audit_log_to_security_events();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Optional Instant Webhook Trigger (fires only when n8n_webhook_url is set)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_n8n_security_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_webhook_url TEXT := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN NEW;
  END IF;

  SELECT TRIM(COALESCE(n8n_webhook_url, '')) INTO v_webhook_url
  FROM public.security_monitor_config
  WHERE id = 'default';

  IF v_webhook_url ~ '^https?://' THEN
    BEGIN
      PERFORM net.http_post(
        url := v_webhook_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'type', 'INSERT',
          'table', 'security_events',
          'schema', 'public',
          'record', to_jsonb(NEW)
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Webhook failure must never block security_events recording
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_events_notify_n8n ON public.security_events;
CREATE TRIGGER trg_security_events_notify_n8n
  AFTER INSERT ON public.security_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_security_event();
