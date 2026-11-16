-- Rollback for 20261117100000_user_access_matrix.sql: restores the role-only helpers and policies.

CREATE OR REPLACE FUNCTION public.app_can_read_department(p_department text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ SELECT public.role_can_read_department(public.app_effective_role(), p_department); $function$;

CREATE OR REPLACE FUNCTION public.app_can_add_department(p_department text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ SELECT public.role_can_add_department(public.app_effective_role(), p_department); $function$;

-- update / delete → system admin only (original generic policy loop)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custody_items','asset_movement_log','suppliers','supplier_quotes','purchase_requests','purchase_request_items','movements','purchase_orders']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS role_update ON public.%I', t);
    EXECUTE format('CREATE POLICY role_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.app_can_modify_records())) WITH CHECK ((SELECT public.app_can_modify_records()))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['custody_items','disbursement_requests','suppliers','supplier_contracts','supplier_quotes','purchase_requests','purchase_request_items']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS role_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY role_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT public.app_can_modify_records()))', t);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS role_update ON public.disbursement_requests;
CREATE POLICY role_update ON public.disbursement_requests FOR UPDATE TO authenticated
  USING (((SELECT public.app_effective_role()) = ANY (ARRAY['system_admin','warehouse_admin'])) OR (created_by = (SELECT auth.uid()) AND status = 'pending'))
  WITH CHECK (((SELECT public.app_effective_role()) = ANY (ARRAY['system_admin','warehouse_admin'])) OR (created_by = (SELECT auth.uid()) AND status = 'rejected' AND approved_by IS NULL AND approved_at IS NULL AND issued_at IS NULL));

DROP POLICY IF EXISTS role_update ON public.supplier_contracts;
CREATE POLICY role_update ON public.supplier_contracts FOR UPDATE TO authenticated
  USING (((SELECT public.app_can_modify_records()) OR (SELECT public.app_effective_role()) = ANY (ARRAY['procurement_admin','system_admin'])))
  WITH CHECK (((SELECT public.app_can_modify_records()) OR (SELECT public.app_effective_role()) = ANY (ARRAY['procurement_admin','system_admin'])));

DROP POLICY IF EXISTS role_insert ON public.suppliers;
CREATE POLICY role_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.app_can_add_department('procurement'));

DROP POLICY IF EXISTS role_insert ON public.supplier_contracts;
CREATE POLICY role_insert ON public.supplier_contracts FOR INSERT TO authenticated
  WITH CHECK (((SELECT public.app_can_modify_records()) OR public.app_can_add_department('procurement')));

DROP POLICY IF EXISTS role_insert ON public.supplier_quotes;
CREATE POLICY role_insert ON public.supplier_quotes FOR INSERT TO authenticated
  WITH CHECK (((SELECT public.app_can_modify_records()) OR (public.app_can_add_department('procurement') AND NOT is_selected)));

DROP FUNCTION IF EXISTS public.app_can(text, text);
DROP FUNCTION IF EXISTS public.app_access_matrix();
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_access_matrix_shape;
-- The access_matrix column is intentionally kept (data); drop manually if desired:
-- ALTER TABLE public.app_users DROP COLUMN IF EXISTS access_matrix;
