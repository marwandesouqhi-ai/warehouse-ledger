-- Migration: Create app_users table for persistent centralized user management
-- Allows system admin to create and manage users that persist in Supabase cloud across all devices.

CREATE TABLE IF NOT EXISTS public.app_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    activation_code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS app_users_username_idx ON public.app_users (username);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable app_users sync for all roles" ON public.app_users;
CREATE POLICY "Enable app_users sync for all roles"
    ON public.app_users FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO anon, authenticated;

-- Seed default System Admin marwan-desouky if not exists
INSERT INTO public.app_users (id, username, display_name, password, role, activation_code, status, notes)
VALUES (
    'usr-admin-marwan',
    'marwan-desouky',
    'مروان دسوقي (مدير النظام)',
    '-- redacted',
    'admin',
    '1001',
    'active',
    'مدير النظام الرئيسي'
)
ON CONFLICT (username) DO UPDATE
SET password = EXCLUDED.password,
    role = 'admin',
    status = 'active';

-- Ensure purged account is removed from cloud database
DELETE FROM public.app_users WHERE username = 'marwandesouqhi@gmail.com';

NOTIFY pgrst, 'reload schema';
