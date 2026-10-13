DO $$
DECLARE
	table_name TEXT;
BEGIN
	FOREACH table_name IN ARRAY ARRAY['organizations', 'profiles', 'organization_members'] LOOP
		IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
			EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
			EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
		END IF;
	END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.movements (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
	received_on TEXT NOT NULL DEFAULT '',
	invoice_number TEXT NOT NULL DEFAULT '',
	supplier TEXT NOT NULL DEFAULT '',
	recipient TEXT NOT NULL DEFAULT '',
	permit TEXT NOT NULL DEFAULT '',
	issued_on TEXT NOT NULL DEFAULT '',
	item TEXT NOT NULL CHECK (length(trim(item)) > 0),
	unit_price TEXT NOT NULL DEFAULT '',
	qty_in TEXT NOT NULL DEFAULT '',
	qty_out TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	fingerprint TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (owner_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS movements_owner_created_idx
	ON public.movements (owner_id, created_at, id);

ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own movements"
	ON public.movements FOR SELECT TO authenticated
	USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can insert their own movements"
	ON public.movements FOR INSERT TO authenticated
	WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can update their own movements"
	ON public.movements FOR UPDATE TO authenticated
	USING ((SELECT auth.uid()) = owner_id)
	WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can delete their own movements"
	ON public.movements FOR DELETE TO authenticated
	USING ((SELECT auth.uid()) = owner_id);

REVOKE ALL ON public.movements FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.movements TO authenticated;

NOTIFY pgrst, 'reload schema';
