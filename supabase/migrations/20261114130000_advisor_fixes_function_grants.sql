-- Applied manually to production on 2026-11-14 after Supabase security advisor review.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_login_attempt() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_sale(jsonb) FROM PUBLIC, anon;
ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;
