-- supabase/migrations/_proposed_rls_hardening.sql
-- ⚠️ ملف مقترح للتشديد الأمني (Proposed RLS Hardening - DO NOT APPLY AUTOMATICALLY)
-- 
-- الغرض: استبدال سياسات USING (true) المفتوحة بسياسات مشددة تعتمد على هوية المستخدم ودوره،
-- دون حذف أي بيانات أو جداول قائمة.
--
-- تعليمات التشغيل:
-- 1. راجع السياسات أدناه وتأكد من ملائمتها لمتطلبات مؤسستك.
-- 2. قم بتجربة الملف أولاً على نسخة اختبارية (Staging / Dev) قبل بيئة الإنتاج.
-- 3. في حال الرغبة في التراجع، قم بإعادة تطبيق سياسات 20261011213000_enable_seamless_cloud_sync.sql.

-- 1. التأكد من تمكين RLS على الجداول الحساسة
ALTER TABLE IF EXISTS public.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.custody_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_users ENABLE ROW LEVEL SECURITY;

-- 2. سياسات جدول الحركات (movements):
-- السماح بالقراءة للمستخدمين المسجلين المصرح لهم (الموظفين والأدمن)
DROP POLICY IF EXISTS "movements_hardened_select_policy" ON public.movements;
CREATE POLICY "movements_hardened_select_policy" ON public.movements
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('system_admin', 'admin', 'warehouse_staff', 'purchasing_staff')
    )
  );

-- السماح بالإضافة فقط لمسؤولي المشتريات والمخازن والسيستم أدمن
DROP POLICY IF EXISTS "movements_hardened_insert_policy" ON public.movements;
CREATE POLICY "movements_hardened_insert_policy" ON public.movements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1 FROM public.app_users u
        WHERE u.id = auth.uid()
          AND u.role IN ('system_admin', 'admin', 'purchasing_staff', 'warehouse_staff')
      )
    )
  );

-- السماح بالتعديل والحذف حصرياً لمدير النظام (system_admin)
DROP POLICY IF EXISTS "movements_hardened_update_delete_policy" ON public.movements;
CREATE POLICY "movements_hardened_update_delete_policy" ON public.movements
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid()
        AND (u.role = 'system_admin' OR 'manage_records' = ANY(u.permissions))
    )
  );

-- 3. سياسات جدول سجلات التدقيق (audit_logs):
-- غير قابل للحذف أو التعديل نهائياً (Append-Only)
DROP POLICY IF EXISTS "audit_logs_read_restricted" ON public.audit_logs;
CREATE POLICY "audit_logs_read_restricted" ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid()
        AND (u.role = 'system_admin' OR 'view_audit' = ANY(u.permissions))
    )
  );
