-- ==============================================================================
-- Migration: 20261101103500_clean_backup_stats_lint.sql
-- Description: Use dynamic execution or direct movements table in get_system_backup_stats
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_system_backup_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_stats JSONB;
    v_movements BIGINT := 0;
    v_custody BIGINT := 0;
    v_users BIGINT := 0;
    v_contracts BIGINT := 0;
    v_disbursements BIGINT := 0;
    v_budget BIGINT := 0;
    v_financial BIGINT := 0;
    v_assets BIGINT := 0;
    v_tickets BIGINT := 0;
    v_inspections BIGINT := 0;
    v_settlements BIGINT := 0;
    v_telegram BIGINT := 0;
    v_notifications BIGINT := 0;
    v_audit_logs BIGINT := 0;
    v_suppliers BIGINT := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
        EXECUTE 'SELECT count(*) FROM public.movements' INTO v_movements;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'custody') THEN
        EXECUTE 'SELECT count(*) FROM public.custody' INTO v_custody;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_users') THEN
        EXECUTE 'SELECT count(*) FROM public.app_users' INTO v_users;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_contracts') THEN
        EXECUTE 'SELECT count(*) FROM public.supplier_contracts' INTO v_contracts;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disbursement_requests') THEN
        EXECUTE 'SELECT count(*) FROM public.disbursement_requests' INTO v_disbursements;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'budget_plans') THEN
        EXECUTE 'SELECT count(*) FROM public.budget_plans' INTO v_budget;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_reports') THEN
        EXECUTE 'SELECT count(*) FROM public.financial_reports' INTO v_financial;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asset_movement_log') THEN
        EXECUTE 'SELECT count(*) FROM public.asset_movement_log' INTO v_assets;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
        EXECUTE 'SELECT count(*) FROM public.support_tickets' INTO v_tickets;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'technical_inspections') THEN
        EXECUTE 'SELECT count(*) FROM public.technical_inspections' INTO v_inspections;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_settlements') THEN
        EXECUTE 'SELECT count(*) FROM public.inventory_settlements' INTO v_settlements;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_recipients') THEN
        EXECUTE 'SELECT count(*) FROM public.telegram_recipients' INTO v_telegram;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        EXECUTE 'SELECT count(*) FROM public.notifications' INTO v_notifications;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
        EXECUTE 'SELECT count(*) FROM public.audit_logs' INTO v_audit_logs;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
        EXECUTE 'SELECT count(*) FROM public.suppliers' INTO v_suppliers;
    END IF;

    v_stats := jsonb_build_object(
        'movements', v_movements,
        'custody', v_custody,
        'users', v_users,
        'contracts', v_contracts,
        'disbursements', v_disbursements,
        'budget_plans', v_budget,
        'financial_reports', v_financial,
        'asset_logs', v_assets,
        'support_tickets', v_tickets,
        'technical_inspections', v_inspections,
        'inventory_settlements', v_settlements,
        'telegram_recipients', v_telegram,
        'notifications', v_notifications,
        'audit_logs', v_audit_logs,
        'suppliers', v_suppliers,
        'calculated_at', now()
    );

    RETURN v_stats;
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_backup_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_system_backup_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_system_backup_stats() TO authenticated, service_role;
