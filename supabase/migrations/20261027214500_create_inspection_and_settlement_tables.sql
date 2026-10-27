-- ==============================================================================
-- Migration: 20261027214500_create_inspection_and_settlement_tables.sql
-- Description: إنشاء جداول حفظ محاضر التسوية الجردية ومحاضر الفحص والاستلام الفني في Supabase
-- ==============================================================================

-- 1. جدول محاضر الفحص والاستلام الفني للواردات (technical_inspections)
CREATE TABLE IF NOT EXISTS public.technical_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_number TEXT UNIQUE NOT NULL, -- INSP-XXXXXXXX
    supplier TEXT NOT NULL,
    po_number TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    warehouse_name TEXT NOT NULL,
    inspection_date DATE NOT NULL,
    decision TEXT NOT NULL, -- 'مطابق ومقبول كلياً', 'مقبول مع ملاحظات', 'مرفوض كلياً'
    total_accepted_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    committee_head TEXT NOT NULL,
    technical_expert TEXT NOT NULL,
    custodian TEXT NOT NULL,
    final_notes TEXT DEFAULT '',
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. جدول محاضر التسوية الجردية والمطابقة الفعلية (inventory_settlements)
CREATE TABLE IF NOT EXISTS public.inventory_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_number TEXT UNIQUE NOT NULL, -- STL-XXXXXXXX
    warehouse_id TEXT NOT NULL,
    warehouse_name TEXT NOT NULL,
    settlement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committee_head TEXT NOT NULL,
    custodian TEXT NOT NULL,
    financial_auditor TEXT NOT NULL,
    total_matched INTEGER NOT NULL DEFAULT 0,
    total_deficit INTEGER NOT NULL DEFAULT 0,
    total_surplus INTEGER NOT NULL DEFAULT 0,
    total_deficit_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_surplus_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- فهارس لتحسين سرعة الاستعلامات والبحث
CREATE INDEX IF NOT EXISTS idx_technical_inspections_created_at ON public.technical_inspections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_technical_inspections_number ON public.technical_inspections (inspection_number);
CREATE INDEX IF NOT EXISTS idx_technical_inspections_warehouse ON public.technical_inspections (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_settlements_created_at ON public.inventory_settlements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_settlements_number ON public.inventory_settlements (settlement_number);
CREATE INDEX IF NOT EXISTS idx_inventory_settlements_warehouse ON public.inventory_settlements (warehouse_id);

-- تفعيل أمان مستوى الصفوف (Row Level Security)
ALTER TABLE public.technical_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_settlements ENABLE ROW LEVEL SECURITY;

-- سياسات RLS:
-- موظفو المخازن والمشتريات ومدير النظام يمكنهم القراءة والإضافة
DROP POLICY IF EXISTS "Authenticated users can insert inspections" ON public.technical_inspections;
CREATE POLICY "Authenticated users can insert inspections"
    ON public.technical_inspections FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read inspections" ON public.technical_inspections;
CREATE POLICY "Authenticated users can read inspections"
    ON public.technical_inspections FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert settlements" ON public.inventory_settlements;
CREATE POLICY "Authenticated users can insert settlements"
    ON public.inventory_settlements FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read settlements" ON public.inventory_settlements;
CREATE POLICY "Authenticated users can read settlements"
    ON public.inventory_settlements FOR SELECT
    TO authenticated
    USING (true);

GRANT SELECT, INSERT, UPDATE ON public.technical_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_settlements TO authenticated;

