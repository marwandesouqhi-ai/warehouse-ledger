-- ============================================================================
-- Migration: 20261101070000_enhance_employee_code_generation_and_remove_pin.sql
-- Description: تعزيز توليد الأكواد الوظيفية لجميع الأدوار (مشرف مخازن، مشاهد، أدمن)
--              ومنع أي تعارض مستقبلي ومزامنة التسلسلات وحذف تفعيل الـ PIN
-- ============================================================================

-- 1. إنشاء تسلسلات إضافية للمشاهدين وأي أدوار جديدة
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_wh_vie START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_emp_pur_vie START WITH 1 INCREMENT BY 1;

-- 2. مزامنة وضبط جميع التسلسلات مع أعلى كود مسجل حالياً في الجداول الثلاثة
DO $$
DECLARE
  v_max_wh_emp BIGINT := 0;
  v_max_wh_adm BIGINT := 0;
  v_max_pur_emp BIGINT := 0;
  v_max_pur_adm BIGINT := 0;
  v_max_sys_adm BIGINT := 0;
  v_max_wh_vie BIGINT := 0;
  v_max_pur_vie BIGINT := 0;
BEGIN
  -- WH-EMP
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'WH-EMP-(\d+)')::BIGINT), 0)
  INTO v_max_wh_emp
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^WH-EMP-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^WH-EMP-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^WH-EMP-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_wh_emp', GREATEST(v_max_wh_emp, 1), v_max_wh_emp > 0);

  -- WH-ADM (مشرف مخازن / أدمن)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'WH-ADM-(\d+)')::BIGINT), 0)
  INTO v_max_wh_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^WH-ADM-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^WH-ADM-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^WH-ADM-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_wh_adm', GREATEST(v_max_wh_adm, 1), v_max_wh_adm > 0);

  -- PUR-EMP (موظف مشتريات)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'PUR-EMP-(\d+)')::BIGINT), 0)
  INTO v_max_pur_emp
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^PUR-EMP-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^PUR-EMP-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^PUR-EMP-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_pur_emp', GREATEST(v_max_pur_emp, 1), v_max_pur_emp > 0);

  -- PUR-ADM (مشرف مشتريات)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'PUR-ADM-(\d+)')::BIGINT), 0)
  INTO v_max_pur_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^PUR-ADM-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^PUR-ADM-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^PUR-ADM-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_pur_adm', GREATEST(v_max_pur_adm, 1), v_max_pur_adm > 0);

  -- SYS-ADM (مدير النظام)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'SYS-ADM-(\d+)')::BIGINT), 0)
  INTO v_max_sys_adm
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^SYS-ADM-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^SYS-ADM-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^SYS-ADM-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_sys_adm', GREATEST(v_max_sys_adm, 1), v_max_sys_adm > 0);

  -- WH-VIE (مشاهد مخازن)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'WH-VIE-(\d+)')::BIGINT), 0)
  INTO v_max_wh_vie
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^WH-VIE-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^WH-VIE-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^WH-VIE-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_wh_vie', GREATEST(v_max_wh_vie, 1), v_max_wh_vie > 0);

  -- PUR-VIE (مشاهد مشتريات)
  SELECT COALESCE(MAX(SUBSTRING(employee_id FROM 'PUR-VIE-(\d+)')::BIGINT), 0)
  INTO v_max_pur_vie
  FROM (
    SELECT employee_id FROM public.app_users WHERE employee_id ~ '^PUR-VIE-\d+$'
    UNION ALL
    SELECT employee_id FROM public.registration_requests WHERE employee_id ~ '^PUR-VIE-\d+$'
    UNION ALL
    SELECT employee_code AS employee_id FROM public.employee_code_registry WHERE employee_code ~ '^PUR-VIE-\d+$'
  ) t;
  PERFORM setval('public.seq_emp_pur_vie', GREATEST(v_max_pur_vie, 1), v_max_pur_vie > 0);
END $$;

-- 3. إعادة تعريف دالة توليد الأكواد الوظيفية generate_employee_code لتشمل كافة الأدوار بدقة وبدون أي تصادم
CREATE OR REPLACE FUNCTION public.generate_employee_code(p_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT := LOWER(TRIM(COALESCE(p_role, '')));
  v_next_val BIGINT;
  v_prefix TEXT;
  v_candidate TEXT;
  v_max_attempts INT := 50;
  v_attempt INT := 0;
BEGIN
  -- تحديد البادئة والتسلسل المناسب بحسب الدور الوظيفي
  IF v_role = 'warehouse_employee' OR v_role = 'warehouse_staff' OR v_role = 'editor' THEN
    v_prefix := 'WH-EMP-';
    v_next_val := nextval('public.seq_emp_wh_emp');
  ELSIF v_role = 'warehouse_admin' OR v_role = 'admin' THEN
    v_prefix := 'WH-ADM-';
    v_next_val := nextval('public.seq_emp_wh_adm');
  ELSIF v_role = 'procurement_employee' OR v_role = 'purchasing_staff' THEN
    v_prefix := 'PUR-EMP-';
    v_next_val := nextval('public.seq_emp_pur_emp');
  ELSIF v_role = 'procurement_admin' THEN
    v_prefix := 'PUR-ADM-';
    v_next_val := nextval('public.seq_emp_pur_adm');
  ELSIF v_role = 'viewer' OR v_role = 'warehouse_viewer' THEN
    v_prefix := 'WH-VIE-';
    v_next_val := nextval('public.seq_emp_wh_vie');
  ELSIF v_role = 'procurement_viewer' THEN
    v_prefix := 'PUR-VIE-';
    v_next_val := nextval('public.seq_emp_pur_vie');
  ELSIF v_role = 'system_admin' THEN
    v_prefix := 'SYS-ADM-';
    v_next_val := nextval('public.seq_emp_sys_adm');
  ELSE
    -- كاحتياط آمن لأي دور إضافي مستقبلي
    v_prefix := 'WH-EMP-';
    v_next_val := nextval('public.seq_emp_wh_emp');
  END IF;

  v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');

  -- حلقة منع التصادم: فحص app_users و registration_requests و employee_code_registry
  WHILE (
    EXISTS (SELECT 1 FROM public.app_users WHERE UPPER(employee_id) = UPPER(v_candidate)) OR
    EXISTS (SELECT 1 FROM public.registration_requests WHERE UPPER(employee_id) = UPPER(v_candidate)) OR
    EXISTS (SELECT 1 FROM public.employee_code_registry WHERE UPPER(employee_code) = UPPER(v_candidate))
  ) AND v_attempt < v_max_attempts LOOP
    v_attempt := v_attempt + 1;
    IF v_prefix = 'WH-EMP-' THEN
      v_next_val := nextval('public.seq_emp_wh_emp');
    ELSIF v_prefix = 'WH-ADM-' THEN
      v_next_val := nextval('public.seq_emp_wh_adm');
    ELSIF v_prefix = 'PUR-EMP-' THEN
      v_next_val := nextval('public.seq_emp_pur_emp');
    ELSIF v_prefix = 'PUR-ADM-' THEN
      v_next_val := nextval('public.seq_emp_pur_adm');
    ELSIF v_prefix = 'WH-VIE-' THEN
      v_next_val := nextval('public.seq_emp_wh_vie');
    ELSIF v_prefix = 'PUR-VIE-' THEN
      v_next_val := nextval('public.seq_emp_pur_vie');
    ELSIF v_prefix = 'SYS-ADM-' THEN
      v_next_val := nextval('public.seq_emp_sys_adm');
    ELSE
      v_next_val := nextval('public.seq_emp_wh_emp');
    END IF;
    v_candidate := v_prefix || LPAD(v_next_val::TEXT, 6, '0');
  END LOOP;

  IF v_attempt >= v_max_attempts THEN
    RAISE EXCEPTION 'تعذر تخصيص كود وظيفي فريد بعد محاولات متعددة لتفادي التصادم.';
  END IF;

  -- حجز الكود فورياً في جدول الأكواد
  INSERT INTO public.employee_code_registry (employee_code, allocated_at)
  VALUES (v_candidate, NOW())
  ON CONFLICT (employee_code) DO NOTHING;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_employee_code(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_employee_code(TEXT) TO service_role;

-- 4. إزالة وتصفير أكواد التفعيل القديمة (PIN) من قاعدة البيانات
UPDATE public.app_users
SET activation_code = ''
WHERE activation_code IS NOT NULL AND activation_code <> '';

