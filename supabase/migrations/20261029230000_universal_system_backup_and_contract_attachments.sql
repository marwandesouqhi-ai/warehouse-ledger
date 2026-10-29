-- ==============================================================================
-- Migration: 20261029230000_universal_system_backup_and_contract_attachments.sql
-- Description: تعزيز الباك إند وقاعدة البيانات للنسخ الاحتياطي الشامل وإرفاق ملفات العقود
-- ==============================================================================

-- 1. التأكد من وجود عمود المرفقات في جدول عقود الموردين (supplier_contracts)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'supplier_contracts' 
          AND column_name = 'attachments'
    ) THEN
        ALTER TABLE public.supplier_contracts 
        ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;
END $$;

-- 2. التأكد من سياسات RLS لجدول عقود الموردين لدعم الإضافة والتحديث مع المرفقات
ALTER TABLE public.supplier_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage contracts" ON public.supplier_contracts;
CREATE POLICY "Authenticated users can manage contracts"
    ON public.supplier_contracts
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 3. دالة RPC لحساب إحصائيات النسخ الاحتياطي الشامل لكافة الجداول بطلب ذري واحد
CREATE OR REPLACE FUNCTION public.get_system_backup_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    -- 1. movements (حركات المخزن)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ledger_movements') THEN
        SELECT count(*) INTO v_movements FROM public.ledger_movements;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movements') THEN
        SELECT count(*) INTO v_movements FROM public.movements;
    END IF;

    -- 2. custody (العهدة)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'custody') THEN
        SELECT count(*) INTO v_custody FROM public.custody;
    END IF;

    -- 3. users (المستخدمون)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_users') THEN
        SELECT count(*) INTO v_users FROM public.app_users;
    END IF;

    -- 4. contracts (العقود)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_contracts') THEN
        SELECT count(*) INTO v_contracts FROM public.supplier_contracts;
    END IF;

    -- 5. disbursements (طلبات الصرف)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disbursement_requests') THEN
        SELECT count(*) INTO v_disbursements FROM public.disbursement_requests;
    END IF;

    -- 6. budget_plans (الميزانية)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'budget_plans') THEN
        SELECT count(*) INTO v_budget FROM public.budget_plans;
    END IF;

    -- 7. financial_reports (التقارير المالية)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_reports') THEN
        SELECT count(*) INTO v_financial FROM public.financial_reports;
    END IF;

    -- 8. asset_movement_log (حركة الأصول)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asset_movement_log') THEN
        SELECT count(*) INTO v_assets FROM public.asset_movement_log;
    END IF;

    -- 9. support_tickets (تذاكر الدعم)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_tickets') THEN
        SELECT count(*) INTO v_tickets FROM public.support_tickets;
    END IF;

    -- 10. technical_inspections (محاضر الفحص)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'technical_inspections') THEN
        SELECT count(*) INTO v_inspections FROM public.technical_inspections;
    END IF;

    -- 11. inventory_settlements (محاضر التسوية الجردية)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_settlements') THEN
        SELECT count(*) INTO v_settlements FROM public.inventory_settlements;
    END IF;

    -- 12. telegram_bot_settings (إعدادات البوت)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_bot_settings') THEN
        SELECT count(*) INTO v_telegram FROM public.telegram_bot_settings;
    END IF;

    -- 13. notifications (الإشعارات)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
        SELECT count(*) INTO v_notifications FROM public.notifications;
    END IF;

    -- 14. audit_logs (سجل التدقيق)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
        SELECT count(*) INTO v_audit_logs FROM public.audit_logs;
    END IF;

    -- 15. suppliers (الموردين)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
        SELECT count(*) INTO v_suppliers FROM public.suppliers;
    END IF;

    v_stats := jsonb_build_object(
        'movements', v_movements,
        'custody', v_custody,
        'users', v_users,
        'contracts', v_contracts,
        'disbursementRequests', v_disbursements,
        'budgetPlans', v_budget,
        'financialReports', v_financial,
        'assetMovements', v_assets,
        'supportTickets', v_tickets,
        'technicalInspections', v_inspections,
        'inventorySettlements', v_settlements,
        'telegramSettings', v_telegram,
        'notifications', v_notifications,
        'auditLogs', v_audit_logs,
        'suppliers', v_suppliers,
        'timestamp', now()
    );

    RETURN v_stats;
END;
$$;

-- منح الصلاحيات لمستخدمي النظام
GRANT EXECUTE ON FUNCTION public.get_system_backup_stats() TO authenticated, anon;

