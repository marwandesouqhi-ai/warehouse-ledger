-- Rollback: 20261014143000_procurement_storage_rollback.sql
-- Description: Reverses storage policies and bucket for procurement attachments.

BEGIN;

DROP POLICY IF EXISTS "System admin delete attachments" ON storage.objects;
DROP POLICY IF EXISTS "Procurement staff upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Procurement staff read attachments" ON storage.objects;

DELETE FROM storage.buckets WHERE id = 'procurement-attachments';

COMMIT;
