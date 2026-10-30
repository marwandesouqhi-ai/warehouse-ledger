-- ============================================================================
-- Migration: 20261030020000_fix_duplicate_employee_ids.sql
-- Description: إصلاح تكرار الرقم الوظيفي (WH-EMP-000001) وإعادة ترقيم كود الموظف
--              أحمد حسين صلاح إلى WH-EMP-000002 وتحديث Auth و app_users والتسلسل
-- ============================================================================

-- 0. إزالة القيد الفريد على telegram_user_id لتفادي تعطل الحسابات التجريبية أو متعددة الأدوار
DROP INDEX IF EXISTS public.idx_app_users_telegram_user_id;
CREATE INDEX IF NOT EXISTS idx_app_users_telegram_user_id ON public.app_users (telegram_user_id) WHERE telegram_user_id IS NOT NULL;

DO $$
DECLARE
    v_ahmed_email TEXT := 'marwandesouky507@gmail.com';
    v_new_emp_id TEXT := 'WH-EMP-000002';
    v_ahmed_auth_id UUID;
    v_app_user_id TEXT;
    v_req_id UUID;
    v_username TEXT := 'ahmed-hussain';
BEGIN
    -- 1. تحديث طلب التسجيل الخاص بالموظف أحمد حسين صلاح
    UPDATE public.registration_requests
    SET employee_id = v_new_emp_id,
        approval_status = 'approved',
        invitation_status = 'accepted',
        verification_status = 'verified',
        approved_role = 'warehouse_employee',
        updated_at = NOW()
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email));

    SELECT id INTO v_req_id
    FROM public.registration_requests
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email))
    LIMIT 1;

    -- 2. إدخال كود WH-EMP-000002 في سجل الأكواد الوظيفية employee_code_registry إن وُجد الجدول
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_code_registry') THEN
        INSERT INTO public.employee_code_registry (employee_code, allocated_at, request_id)
        VALUES (v_new_emp_id, NOW(), v_req_id)
        ON CONFLICT (employee_code) DO NOTHING;
    END IF;

    -- 3. جلب معرّف Auth للمستخدم إن وُجد وتحديث كلمة المرور والميتاداتا
    SELECT id INTO v_ahmed_auth_id
    FROM auth.users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email))
    LIMIT 1;

    IF v_ahmed_auth_id IS NOT NULL THEN
        UPDATE auth.users
        SET encrypted_password = extensions.crypt('01060723106', extensions.gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            raw_app_meta_data = jsonb_build_object(
                'provider', 'email',
                'providers', jsonb_build_array('email'),
                'employee_id', v_new_emp_id,
                'role', 'warehouse_employee',
                'department', 'warehouse'
            ),
            raw_user_meta_data = jsonb_build_object(
                'name', 'أحمد حسين صلاح',
                'full_name', 'أحمد حسين صلاح',
                'employee_id', v_new_emp_id,
                'username', v_username
            )
        WHERE id = v_ahmed_auth_id;
    END IF;

    -- 4. تحديث أو إدراج سجل المستخدم في public.app_users
    SELECT id INTO v_app_user_id
    FROM public.app_users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_ahmed_email))
       OR (employee_id = 'WH-EMP-000001' AND LOWER(TRIM(display_name)) LIKE '%أحمد%')
    LIMIT 1;

    IF v_app_user_id IS NOT NULL THEN
        UPDATE public.app_users
        SET employee_id = v_new_emp_id,
            display_name = 'أحمد حسين صلاح',
            department = 'المخازن',
            role = 'warehouse_employee',
            status = 'active',
            email = v_ahmed_email,
            telegram_user_id = 1200587150,
            auth_user_id = COALESCE(v_ahmed_auth_id, auth_user_id)
        WHERE id = v_app_user_id;
    ELSE
        -- التأكد من عدم تكرار اسم المستخدم
        IF EXISTS (SELECT 1 FROM public.app_users WHERE username = v_username) THEN
            v_username := 'ahmed_hussain_02';
        END IF;

        INSERT INTO public.app_users (
            id,
            username,
            display_name,
            password,
            role,
            status,
            email,
            employee_id,
            department,
            telegram_user_id,
            auth_user_id,
            notes
        ) VALUES (
            'usr-' || gen_random_uuid()::TEXT,
            v_username,
            'أحمد حسين صلاح',
            extensions.crypt('01060723106', extensions.gen_salt('bf')),
            'warehouse_employee',
            'active',
            v_ahmed_email,
            v_new_emp_id,
            'المخازن',
            1200587150,
            v_ahmed_auth_id,
            'تم الاعتماد والتفعيل رسمياً'
        );
    END IF;

    -- 5. التأكد من بقاء طلب مروان دسوقي على كوده المخصص WH-EMP-000001
    UPDATE public.registration_requests
    SET employee_id = 'WH-EMP-000001'
    WHERE LOWER(TRIM(email)) = 'marwandesowky2@gmail.com';

    -- 6. إعادة ضبط تسلسل أرقام موظفي المخازن seq_emp_wh_emp ليتوافق مع أعلى رقم (3 فما فوق)
    IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_emp_wh_emp') THEN
        PERFORM setval('public.seq_emp_wh_emp', 3, false);
    END IF;
END $$;
