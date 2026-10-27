-- ==============================================================================
-- Migration: 20261027201500_create_support_tickets_system.sql
-- Description: إنشاء جدول تذاكر الدعم الفني ونظام البلاغات والملحقات وصلاحيات RLS
-- ==============================================================================

-- 1. جدول تذاكر الدعم الفني (support_tickets)
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number TEXT UNIQUE NOT NULL,
    employee_name TEXT NOT NULL,
    employee_code TEXT DEFAULT '',
    employee_email TEXT DEFAULT '',
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    department TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'متوسط', -- 'عادي', 'متوسط', 'عاجل جداً'
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'مفتوحة', -- 'مفتوحة', 'قيد المعالجة', 'تم الحل', 'مغلقة'
    attachment_url TEXT DEFAULT NULL,
    attachment_name TEXT DEFAULT NULL,
    attachment_type TEXT DEFAULT NULL,
    admin_notes TEXT DEFAULT NULL,
    resolved_by TEXT DEFAULT NULL,
    resolved_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. الفهارس لتحسين سرعة الاستعلامات والفلترة
CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx ON public.support_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets (status);
CREATE INDEX IF NOT EXISTS support_tickets_priority_idx ON public.support_tickets (priority);
CREATE INDEX IF NOT EXISTS support_tickets_department_idx ON public.support_tickets (department);
CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON public.support_tickets (user_id);
CREATE INDEX IF NOT EXISTS support_tickets_number_idx ON public.support_tickets (ticket_number);

-- 3. تفعيل أمان مستوى الصفوف (Row Level Security)
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- صلاحية الإضافة: متاحة لأي موظف مسجل دخوله (ولغير المسجلين في حال الإبلاغ عن مشكلة تسجيل)
DROP POLICY IF EXISTS "Anyone can insert support tickets" ON public.support_tickets;
CREATE POLICY "Anyone can insert support tickets"
    ON public.support_tickets FOR INSERT
    WITH CHECK (true);

-- صلاحية القراءة:
-- 1. مدير النظام (System Admin) فقط يملك صلاحية قراءة جميع التذاكر من كل الأقسام
-- 2. الموظف العادي يقرأ تذاكره فقط
DROP POLICY IF EXISTS "Admins can view all tickets, employees view their own" ON public.support_tickets;
CREATE POLICY "Admins can view all tickets, employees view their own"
    ON public.support_tickets FOR SELECT
    USING (
        -- مقتصر حصرياً على مدير النظام (System Admin)
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com')) OR
        -- الموظف يرى تذكرته فقط بحسب الـ user_id أو الإيميل
        ((SELECT auth.uid()) = user_id) OR
        ((SELECT auth.uid()) IS NOT NULL AND employee_email = (SELECT auth.jwt())->>'email')
    );

-- صلاحية التحديث (تغيير الحالة أو كتابة ملاحظات الدعم): مقتصرة حصرياً على مدير النظام
DROP POLICY IF EXISTS "Admins can update tickets" ON public.support_tickets;
CREATE POLICY "Admins can update tickets"
    ON public.support_tickets FOR UPDATE
    USING (
        (COALESCE(((SELECT auth.jwt())->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        (((SELECT auth.jwt())->'app_metadata'->>'role') = 'system_admin') OR
        (((SELECT auth.jwt())->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
    );

-- صلاحية الحذف: مقتصرة على مدير النظام
DROP POLICY IF EXISTS "System admins can delete tickets" ON public.support_tickets;
CREATE POLICY "System admins can delete tickets"
    ON public.support_tickets FOR DELETE
    USING (
        (coalesce((auth.jwt()->'app_metadata'->>'system_admin')::boolean, false) = true) OR
        ((auth.jwt()->'app_metadata'->>'role') = 'system_admin') OR
        ((auth.jwt()->>'email') IN ('marwandesouqhi@gmail.com', 'marwandesowky2@gmail.com'))
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated, anon;

-- 4. إعداد حاوية تخزين المرفقات في Supabase Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'support-attachments',
    'support-attachments',
    true,
    10485760, -- 10 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- سياسات تخزين المرفقات
DROP POLICY IF EXISTS "Public view for support attachments" ON storage.objects;
CREATE POLICY "Public view for support attachments"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'support-attachments');

DROP POLICY IF EXISTS "Allow upload for support attachments" ON storage.objects;
CREATE POLICY "Allow upload for support attachments"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'support-attachments');

