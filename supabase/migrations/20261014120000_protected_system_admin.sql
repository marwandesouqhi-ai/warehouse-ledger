-- Migration: 20261014120000_protected_system_admin.sql
-- Description: Absolute database-level protection for fixed System Admin (marwan-desouky) and root admin
-- All statements are additive and idempotent.

-- 1. Immutable function: is_protected_username(text)
CREATE OR REPLACE FUNCTION public.is_protected_username(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_username IS NULL OR TRIM(p_username) = '' THEN
    RETURN FALSE;
  END IF;

  -- Lowercase and trim
  v_clean := LOWER(TRIM(p_username));

  -- Strip synthetic email suffix if present
  IF v_clean LIKE '%@warehouse.local' THEN
    v_clean := REPLACE(v_clean, '@warehouse.local', '');
  END IF;

  -- Direct match against canonical protected usernames and legacy email
  IF v_clean = 'marwan-desouky' OR v_clean = 'marwandesouqhi@gmail.com' THEN
    RETURN TRUE;
  END IF;

  -- Normalize lookalike dashes (en-dash, em-dash, etc.)
  v_clean := REGEXP_REPLACE(v_clean, '[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]', '-', 'g');
  IF v_clean = 'marwan-desouky' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- 2. Trigger function: protect_system_admin_row()
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
BEGIN
  v_session_user := session_user;
  -- Extract API role if call came through PostgREST / Edge Function
  v_auth_role := COALESCE(
    current_setting('request.jwt.claim.role', true),
    NULLIF(current_setting('role', true), '')
  );

  -- Only direct SQL Editor / psql session by postgres or supabase_admin is allowed emergency maintenance
  -- API calls via service_role, anon, or authenticated are NEVER considered direct DBA maintenance
  v_is_direct_dba := (v_session_user IN ('postgres', 'supabase_admin')) AND (v_auth_role IS DISTINCT FROM 'service_role');

  -- ─── BEFORE DELETE ──────────────────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب مدير النظام الرئيسي (marwan-desouky) محمي بشكل دائم ولا يمكن حذفه نهائياً من قاعدة البيانات.';
      END IF;
    END IF;

    IF LOWER(TRIM(OLD.username)) = 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: حساب المشرف الرئيسي (admin) محمي ولا يمكن حذفه.';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  -- ─── BEFORE UPDATE ──────────────────────────────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    -- A. Protection for marwan-desouky
    IF public.is_protected_username(OLD.username) THEN
      IF NOT v_is_direct_dba THEN
        -- Strictly forbid altering core identity and security fields
        IF (OLD.username IS DISTINCT FROM NEW.username) OR
           (OLD.role IS DISTINCT FROM NEW.role) OR
           (OLD.status IS DISTINCT FROM NEW.status) OR
           (OLD.permissions IS DISTINCT FROM NEW.permissions) OR
           (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id AND OLD.auth_user_id IS NOT NULL) OR
           (OLD.password IS DISTINCT FROM NEW.password) THEN
          RAISE EXCEPTION 'غير مصرح: بيانات وهوية حساب مدير النظام الرئيسي (marwan-desouky) محمية بالكامل ولا يمكن تعديلها.';
        END IF;

        -- Forbid forcing must_change_password to true on the protected system admin
        IF NEW.must_change_password IS TRUE AND OLD.must_change_password IS NOT TRUE THEN
          RAISE EXCEPTION 'غير مصرح: لا يمكن فرض تغيير كلمة المرور على حساب مدير النظام الرئيسي.';
        END IF;

        -- Allow updating only display_name, last_login_at, must_change_password (to false), or linking auth_user_id once
      END IF;
    END IF;

    -- B. Protection for root admin
    IF LOWER(TRIM(OLD.username)) = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
      IF NOT v_is_direct_dba THEN
        RAISE EXCEPTION 'غير مصرح: لا يمكن تخفيض صلاحيات المشرف الرئيسي (admin).';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- ─── BEFORE INSERT ──────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF public.is_protected_username(NEW.username) THEN
      -- If a protected system admin already exists, forbid inserting another duplicate or homoglyph
      IF EXISTS (
        SELECT 1 FROM public.app_users 
        WHERE public.is_protected_username(username)
      ) THEN
        RAISE EXCEPTION 'اسم المستخدم محجوز لحساب مدير النظام الرئيسي ولا يمكن إنشاء حساب مطابق أو مشابه.';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach triggers to app_users table
DROP TRIGGER IF EXISTS trg_protect_system_admin_row ON public.app_users;
CREATE TRIGGER trg_protect_system_admin_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_admin_row();

NOTIFY pgrst, 'reload schema';
