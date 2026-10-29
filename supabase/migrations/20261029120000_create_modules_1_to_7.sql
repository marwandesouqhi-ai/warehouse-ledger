-- ==============================================================================
-- Migration: 20261029120000_create_modules_1_to_7.sql
-- Modules:
-- 1. disbursement_requests (طلبات الصرف الداخلي)
-- 2. notifications (نظام الإشعارات الداخلي)
-- 3. inventory_analytics_snapshots (لقطات تحليلات المخزون)
-- 4. supplier_contracts (إدارة العقود مع الموردين)
-- 5. asset_movement_log (سجل حركة الأصول المفصل)
-- 6. financial_reports (التقارير المالية الدورية)
-- 7. budget_plans (الميزانية والتخطيط المالي)
-- ==============================================================================

-- 1. طلبات الصرف الداخلي (disbursement_requests)
CREATE TABLE IF NOT EXISTS public.disbursement_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  requester_name TEXT NOT NULL,
  requester_department TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity_requested NUMERIC NOT NULL CHECK (quantity_requested > 0),
  unit TEXT DEFAULT 'قطعة',
  purpose TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'issued')),
  notes TEXT,
  rejection_reason TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  warehouse_id TEXT DEFAULT 'main',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.disbursement_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read disbursement_requests"
  ON public.disbursement_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert disbursement_requests"
  ON public.disbursement_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update disbursement_requests"
  ON public.disbursement_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow admin delete disbursement_requests"
  ON public.disbursement_requests FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
  );

-- 2. نظام الإشعارات الداخلي (notifications)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error', 'request', 'ticket')),
  is_read BOOLEAN DEFAULT false,
  action_url TEXT,
  related_id UUID,
  related_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    user_id IS NULL 
    OR user_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
  );

CREATE POLICY "Allow authenticated insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (
    user_id IS NULL 
    OR user_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
  )
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (
    user_id IS NULL 
    OR user_id = auth.uid()
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
  );

-- 3. تحليلات المخزون المتقدمة - لقطات دورية (inventory_analytics_snapshots)
CREATE TABLE IF NOT EXISTS public.inventory_analytics_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  warehouse_id TEXT NOT NULL DEFAULT 'main',
  total_items INTEGER DEFAULT 0,
  total_value NUMERIC DEFAULT 0,
  total_qty_in NUMERIC DEFAULT 0,
  total_qty_out NUMERIC DEFAULT 0,
  low_stock_count INTEGER DEFAULT 0,
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.inventory_analytics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read inventory_analytics_snapshots"
  ON public.inventory_analytics_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert inventory_analytics_snapshots"
  ON public.inventory_analytics_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 4. إدارة العقود مع الموردين (supplier_contracts)
CREATE TABLE IF NOT EXISTS public.supplier_contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_number TEXT NOT NULL UNIQUE,
  supplier_id UUID,
  supplier_name TEXT NOT NULL,
  contract_title TEXT NOT NULL,
  contract_type TEXT DEFAULT 'supply' CHECK (contract_type IN ('supply', 'service', 'maintenance', 'consulting')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  contract_value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'EGP',
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'renewed')),
  auto_renewal BOOLEAN DEFAULT false,
  renewal_notice_days INTEGER DEFAULT 30,
  terms TEXT,
  attachments JSONB DEFAULT '[]',
  linked_po_ids JSONB DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.supplier_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read supplier_contracts"
  ON public.supplier_contracts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert supplier_contracts"
  ON public.supplier_contracts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update supplier_contracts"
  ON public.supplier_contracts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow admin delete supplier_contracts"
  ON public.supplier_contracts FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
  );

-- 5. سجل حركة الأصل المفصل (asset_movement_log)
CREATE TABLE IF NOT EXISTS public.asset_movement_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_code TEXT NOT NULL,
  asset_name TEXT NOT NULL,
  from_location TEXT,
  to_location TEXT NOT NULL,
  movement_type TEXT DEFAULT 'transfer' CHECK (movement_type IN ('inward', 'outward', 'transfer', 'inspection', 'maintenance', 'writeoff')),
  quantity NUMERIC DEFAULT 1,
  condition_before TEXT,
  condition_after TEXT,
  notes TEXT,
  performed_by TEXT,
  performed_by_email TEXT,
  performed_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.asset_movement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read asset_movement_log"
  ON public.asset_movement_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert asset_movement_log"
  ON public.asset_movement_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow admin delete asset_movement_log"
  ON public.asset_movement_log FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
  );

-- 6. التقارير المالية الدورية (financial_reports)
CREATE TABLE IF NOT EXISTS public.financial_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_number TEXT NOT NULL UNIQUE,
  report_title TEXT NOT NULL,
  report_type TEXT DEFAULT 'monthly' CHECK (report_type IN ('monthly', 'quarterly', 'annual', 'custom')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  total_purchases NUMERIC DEFAULT 0,
  total_disbursements NUMERIC DEFAULT 0,
  budget_allocated NUMERIC DEFAULT 0,
  budget_remaining NUMERIC DEFAULT 0,
  summary_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'approved')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.financial_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read financial_reports"
  ON public.financial_reports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert financial_reports"
  ON public.financial_reports FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update financial_reports"
  ON public.financial_reports FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow admin delete financial_reports"
  ON public.financial_reports FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
  );

-- 7. موديول الميزانية والتخطيط (budget_plans)
CREATE TABLE IF NOT EXISTS public.budget_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  department TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  allocated_amount NUMERIC NOT NULL DEFAULT 0,
  spent_amount NUMERIC DEFAULT 0,
  remaining_amount NUMERIC GENERATED ALWAYS AS (allocated_amount - spent_amount) STORED,
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'closed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fiscal_year, department, category)
);

ALTER TABLE public.budget_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read budget_plans"
  ON public.budget_plans FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert budget_plans"
  ON public.budget_plans FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update budget_plans"
  ON public.budget_plans FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow admin delete budget_plans"
  ON public.budget_plans FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'system_admin'
    OR (auth.jwt() ->> 'email') = 'marwandesowky2@gmail.com'
  );

-- Indexes for maximum query performance
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_status ON public.disbursement_requests(status);
CREATE INDEX IF NOT EXISTS idx_disbursement_requests_created_by ON public.disbursement_requests(created_by);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_status ON public.supplier_contracts(status);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_end_date ON public.supplier_contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_asset_movement_log_asset_code ON public.asset_movement_log(asset_code);
CREATE INDEX IF NOT EXISTS idx_financial_reports_period ON public.financial_reports(period_from, period_to);
CREATE INDEX IF NOT EXISTS idx_budget_plans_fiscal_year ON public.budget_plans(fiscal_year);
