-- Migration: Enable seamless institutional warehouse cloud sync
-- Allows local & deployed warehouse clients to continuously synchronize movements, custody, and settings.

-- 1. Relax movements constraints so local users & institutional sync work smoothly
DO $$
BEGIN
    -- Drop foreign key constraint to auth.users if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'movements_owner_id_fkey' AND table_name = 'movements'
    ) THEN
        ALTER TABLE public.movements DROP CONSTRAINT movements_owner_id_fkey;
    END IF;
END $$;

ALTER TABLE public.movements ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.movements ALTER COLUMN owner_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

CREATE UNIQUE INDEX IF NOT EXISTS movements_fingerprint_idx ON public.movements (fingerprint);

-- Drop old strict auth-only policies
DROP POLICY IF EXISTS "Users can read their own movements" ON public.movements;
DROP POLICY IF EXISTS "Users can insert their own movements" ON public.movements;
DROP POLICY IF EXISTS "Users can update their own movements" ON public.movements;
DROP POLICY IF EXISTS "Users can delete their own movements" ON public.movements;
DROP POLICY IF EXISTS "Allow read movements" ON public.movements;
DROP POLICY IF EXISTS "Allow insert movements" ON public.movements;
DROP POLICY IF EXISTS "Allow update movements" ON public.movements;
DROP POLICY IF EXISTS "Allow delete movements" ON public.movements;
DROP POLICY IF EXISTS "Enable warehouse ledger sync for all roles" ON public.movements;

CREATE POLICY "Enable warehouse ledger sync for all roles"
    ON public.movements FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements TO anon, authenticated;

-- 2. Create custody_items table for shared multi-warehouse custody synchronization
CREATE TABLE IF NOT EXISTS public.custody_items (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    unit_price NUMERIC,
    value NUMERIC NOT NULL DEFAULT 0,
    condition TEXT NOT NULL DEFAULT 'good',
    custodian TEXT NOT NULL DEFAULT '',
    room_location TEXT NOT NULL DEFAULT '',
    serial_number TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    custody_type TEXT NOT NULL DEFAULT 'permanent',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custody_items_warehouse_idx ON public.custody_items (warehouse_id);

ALTER TABLE public.custody_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable custody sync for all roles" ON public.custody_items;
CREATE POLICY "Enable custody sync for all roles"
    ON public.custody_items FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custody_items TO anon, authenticated;

-- 3. Create app_settings table for institutional identity sync
CREATE TABLE IF NOT EXISTS public.app_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    organization TEXT NOT NULL DEFAULT 'جامعة الزقازيق الأهلية',
    department TEXT NOT NULL DEFAULT 'قسم المخازن',
    currency TEXT NOT NULL DEFAULT 'EGP',
    logo_url TEXT NOT NULL DEFAULT '',
    logo_data_url TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable app_settings sync for all roles" ON public.app_settings;
CREATE POLICY "Enable app_settings sync for all roles"
    ON public.app_settings FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
