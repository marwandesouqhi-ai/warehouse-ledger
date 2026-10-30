-- ============================================================================
-- Migration: 20261030020000_fix_duplicate_employee_ids.sql
-- Description: إصلاح تكرار الرقم الوظيفي (WH-EMP-000001) وإعادة ترقيم كود الموظف
--              أحمد حسين صلاح إلى WH-EMP-000002 وتحديث تسلسل الأرقام الوظيفية
-- ============================================================================

DO $$
DECLARE
    v_ahmed_email TEXT := 'marwandesouky507@gmail.com';
    v_new_emp_id TEXT := 'WH-EMP-000002';
    v_ahmed_auth_id UUID;
BEGIN
    -- 1. تحديث طلب التسجيل الخاص بالموظف أحمد حسين صلاح
    UPDATE public.registration_requests
    SET employee_id = v_new_emp_id,
        updated_at = NOW()
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email));

    -- 2. تحديث سجل app_users الخاص به
    UPDATE public.app_users
    SET employee_id = v_new_emp_id
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email))
       OR employee_id = 'WH-EMP-000001' AND LOWER(TRIM(display_name)) LIKE '%أحمد%';

    -- 3. تحديث Auth app_metadata في جدول auth.users إن وجد
    SELECT id INTO v_ahmed_auth_id
    FROM auth.users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email))
    LIMIT 1;

    IF v_ahmed_auth_id IS NOT NULL THEN
        UPDATE auth.users
        SET raw_app_meta_data = jsonb_set(
            COALESCE(raw_app_meta_data, '{}'::jsonb),
            '{employee_id}',
            to_jsonb(v_new_emp_id)
        )
        WHERE id = v_ahmed_auth_id;
    END IF;

    -- 4. إعادة ضبط تسلسل أرقام موظفي المخازن seq_emp_wh_emp ليتوافق مع أعلى رقم
    IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_emp_wh_emp') THEN
        PERFORM setval('public.seq_emp_wh_emp', 3, false);
    END IF;
END $$;

