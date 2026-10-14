-- Migration: 20261014143000_procurement_storage.sql
-- Description: Provision Supabase Storage bucket 'procurement-attachments' and security policies.
-- Note: Prepared in SQL and client library, but kept un-activated in the UI pending explicit approval.

-- 1. Insert bucket into storage.buckets if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'procurement-attachments',
  'procurement-attachments',
  false,
  10485760, -- 10 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Policies for procurement-attachments
DROP POLICY IF EXISTS "Procurement staff read attachments" ON storage.objects;
CREATE POLICY "Procurement staff read attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'procurement-attachments'
    AND public.can_access_procurement()
  );

DROP POLICY IF EXISTS "Procurement staff upload attachments" ON storage.objects;
CREATE POLICY "Procurement staff upload attachments"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'procurement-attachments'
    AND public.can_access_procurement()
  );

DROP POLICY IF EXISTS "System admin delete attachments" ON storage.objects;
CREATE POLICY "System admin delete attachments"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'procurement-attachments'
    AND public.is_system_admin()
  );
