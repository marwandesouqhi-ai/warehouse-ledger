-- Keep the established administrator login and remove its synthetic duplicate.
-- The real login is marwandesouqhi@gmail.com; the warehouse.local identity is legacy.
DO $$
DECLARE
  v_synthetic_id UUID;
  v_primary_id UUID;
BEGIN
  SELECT id
    INTO v_synthetic_id
    FROM auth.users
   WHERE lower(email) = 'marwan-desouky@warehouse.local'
   LIMIT 1;

  SELECT id
    INTO v_primary_id
    FROM auth.users
   WHERE lower(email) = 'marwandesouqhi@gmail.com'
   LIMIT 1;

  IF v_synthetic_id IS NOT NULL
     AND v_primary_id IS NOT NULL
     AND v_primary_id <> v_synthetic_id THEN
    UPDATE public.app_users
       SET auth_user_id = v_primary_id,
           must_change_password = true
     WHERE auth_user_id = v_synthetic_id
        OR lower(email) = 'marwandesouqhi@gmail.com';

    UPDATE public.automation_hub_commands SET owner_id = v_primary_id WHERE owner_id = v_synthetic_id;
    UPDATE public.automation_hub_events SET owner_id = v_primary_id WHERE owner_id = v_synthetic_id;
    UPDATE public.automation_hub_meta SET owner_id = v_primary_id WHERE owner_id = v_synthetic_id;
    UPDATE public.automation_hub_tasks SET owner_id = v_primary_id WHERE owner_id = v_synthetic_id;

    DELETE FROM auth.users WHERE id = v_synthetic_id;
  END IF;
END;
$$;
