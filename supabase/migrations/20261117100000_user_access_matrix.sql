-- Per-user access matrix (pages / tabs / create / update / delete) set by the system admin.
-- app_users.access_matrix = NULL keeps today's behaviour (role defaults). A non-NULL matrix is authoritative
-- for that user: the role is only a job title. system_admin is never restricted by a matrix.
-- Shape: {"v":1,"pages":{"custody":{"view":true,"create":true,"update":false,"delete":false}, ...}}
-- Rollback: supabase/rollbacks/20261117100000_user_access_matrix_rollback.sql

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS access_matrix jsonb;
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_access_matrix_shape;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_access_matrix_shape
  CHECK (access_matrix IS NULL OR (jsonb_typeof(access_matrix) = 'object' AND jsonb_typeof(access_matrix->'pages') = 'object'));

-- Matrix of the current (active) user; NULL = no matrix → legacy role behaviour.
CREATE OR REPLACE FUNCTION public.app_access_matrix()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT u.access_matrix
  FROM public.app_users u
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND u.status = 'active'
    AND u.role <> 'system_admin'
  ORDER BY u.created_at ASC
  LIMIT 1;
$function$;

-- Page-level check. view|create|update|delete. system_admin always true.
-- Without a matrix: view/create follow the role matrix of the page's department; update/delete are system_admin only.
CREATE OR REPLACE FUNCTION public.app_can(p_page text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role text := public.app_effective_role();
  v_matrix jsonb;
  v_dept text;
BEGIN
  IF v_role = 'system_admin' THEN RETURN true; END IF;
  IF v_role IS NULL OR p_action NOT IN ('view', 'create', 'update', 'delete') THEN RETURN false; END IF;

  v_matrix := public.app_access_matrix();
  IF v_matrix IS NULL THEN
    v_dept := CASE WHEN p_page IN ('purchases', 'suppliers', 'quotes', 'contracts') THEN 'procurement' ELSE 'warehouse' END;
    IF p_action = 'view' THEN RETURN public.role_can_read_department(v_role, v_dept); END IF;
    IF p_action = 'create' THEN RETURN public.role_can_add_department(v_role, v_dept); END IF;
    RETURN false;
  END IF;

  RETURN COALESCE((v_matrix -> 'pages' -> p_page ->> 'view')::boolean, false)
     AND COALESCE((v_matrix -> 'pages' -> p_page ->> p_action)::boolean, false);
END;
$function$;

-- Department-level helpers become matrix-aware (warehouse ↔ custody page, procurement ↔ purchases page).
CREATE OR REPLACE FUNCTION public.app_can_read_department(p_department text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE WHEN public.app_access_matrix() IS NULL
    THEN public.role_can_read_department(public.app_effective_role(), p_department)
    ELSE public.app_can(CASE WHEN p_department = 'procurement' THEN 'purchases' ELSE 'custody' END, 'view')
  END;
$function$;

CREATE OR REPLACE FUNCTION public.app_can_add_department(p_department text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT CASE WHEN public.app_access_matrix() IS NULL
    THEN public.role_can_add_department(public.app_effective_role(), p_department)
    ELSE public.app_can(CASE WHEN p_department = 'procurement' THEN 'purchases' ELSE 'custody' END, 'create')
  END;
$function$;

REVOKE ALL ON FUNCTION public.app_access_matrix() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_can(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_access_matrix() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_can(text, text) TO authenticated, service_role;

-- Update/delete policies per table → page.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('custody_items',          'custody'),
    ('asset_movement_log',     'custody'),
    ('disbursement_requests',  'custody'),
    ('suppliers',              'suppliers'),
    ('supplier_contracts',     'contracts'),
    ('supplier_quotes',        'quotes'),
    ('purchase_requests',      'purchases'),
    ('purchase_request_items', 'purchases')
  ) AS t(tbl, page)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN CONTINUE; END IF;

    -- UPDATE (asset_movement_log has no delete policy; disbursement_requests keeps its own creator/role branch)
    EXECUTE format('DROP POLICY IF EXISTS role_update ON public.%I', r.tbl);
    IF r.tbl = 'disbursement_requests' THEN
      EXECUTE $p$CREATE POLICY role_update ON public.disbursement_requests FOR UPDATE TO authenticated
        USING (
          (SELECT public.app_can('custody', 'update'))
          OR ((SELECT public.app_access_matrix()) IS NULL AND (
                (SELECT public.app_effective_role()) = 'warehouse_admin'
                OR (created_by = (SELECT auth.uid()) AND status = 'pending')))
        )
        WITH CHECK (
          (SELECT public.app_can('custody', 'update'))
          OR ((SELECT public.app_access_matrix()) IS NULL AND (
                (SELECT public.app_effective_role()) = 'warehouse_admin'
                OR (created_by = (SELECT auth.uid()) AND status = 'rejected' AND approved_by IS NULL
                    AND approved_at IS NULL AND issued_at IS NULL)))
        )$p$;
    ELSIF r.tbl = 'supplier_contracts' THEN
      EXECUTE $p$CREATE POLICY role_update ON public.supplier_contracts FOR UPDATE TO authenticated
        USING ((SELECT public.app_can('contracts', 'update'))
               OR ((SELECT public.app_access_matrix()) IS NULL AND (SELECT public.app_effective_role()) = 'procurement_admin'))
        WITH CHECK ((SELECT public.app_can('contracts', 'update'))
               OR ((SELECT public.app_access_matrix()) IS NULL AND (SELECT public.app_effective_role()) = 'procurement_admin'))$p$;
    ELSE
      EXECUTE format(
        'CREATE POLICY role_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.app_can(%L, ''update''))) WITH CHECK ((SELECT public.app_can(%L, ''update'')))',
        r.tbl, r.page, r.page);
    END IF;

    -- DELETE
    IF r.tbl <> 'asset_movement_log' THEN
      EXECUTE format('DROP POLICY IF EXISTS role_delete ON public.%I', r.tbl);
      EXECUTE format(
        'CREATE POLICY role_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT public.app_can(%L, ''delete'')))',
        r.tbl, r.page);
    END IF;
  END LOOP;
END
$$;

-- Insert on suppliers / contracts / quotes follows the page's own "create" right.
DROP POLICY IF EXISTS role_insert ON public.suppliers;
CREATE POLICY role_insert ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_can('suppliers', 'create')));

DROP POLICY IF EXISTS role_insert ON public.supplier_contracts;
CREATE POLICY role_insert ON public.supplier_contracts FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_can_modify_records()) OR (SELECT public.app_can('contracts', 'create')));

DROP POLICY IF EXISTS role_insert ON public.supplier_quotes;
CREATE POLICY role_insert ON public.supplier_quotes FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_can_modify_records()) OR ((SELECT public.app_can('quotes', 'create')) AND NOT is_selected));

-- movements: updates follow the page of the movement's department (purchases / custody).
DROP POLICY IF EXISTS role_update ON public.movements;
CREATE POLICY role_update ON public.movements FOR UPDATE TO authenticated
  USING ((SELECT public.app_can(CASE public.movement_department(kind, qty_in, qty_out) WHEN 'procurement' THEN 'purchases' ELSE 'custody' END, 'update')))
  WITH CHECK ((SELECT public.app_can(CASE public.movement_department(kind, qty_in, qty_out) WHEN 'procurement' THEN 'purchases' ELSE 'custody' END, 'update')));
