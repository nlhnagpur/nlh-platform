
-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_splits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gst_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gst_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_ho_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','super_admin')
  );
$$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accounts','fiscal_years','journal_entries','journal_lines',
    'expenses','revenue_splits','bank_accounts','bank_transactions',
    'gst_config','gst_transactions','vendors','vendor_transactions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY ho_admin_only ON %I FOR ALL TO authenticated USING (is_ho_admin()) WITH CHECK (is_ho_admin())',
      tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- SEED: CHART OF ACCOUNTS
-- ============================================================
INSERT INTO accounts (code, name, type, subtype, is_system) VALUES
  ('1000','Current Assets','asset',NULL,true),
  ('1001','Cash in Hand','asset','cash',true),
  ('1010','HDFC Bank – Current A/c','asset','bank',false),
  ('1020','SBI Bank – Current A/c','asset','bank',false),
  ('1100','Accounts Receivable','asset','receivable',true),
  ('1110','Receivable – Franchisees','asset','receivable',false),
  ('1200','Kit Inventory','asset','inventory',false),
  ('1300','GST Input Credit','asset','tax',true),
  ('1310','CGST Input','asset','tax',true),
  ('1320','SGST Input','asset','tax',true),
  ('1330','IGST Input','asset','tax',true),
  ('2000','Current Liabilities','liability',NULL,true),
  ('2001','Accounts Payable – Vendors','liability','payable',true),
  ('2100','Revenue Payable – CF','liability','payable',true),
  ('2200','Revenue Payable – SMF','liability','payable',true),
  ('2300','GST Payable','liability','tax',true),
  ('2310','CGST Payable','liability','tax',true),
  ('2320','SGST Payable','liability','tax',true),
  ('2330','IGST Payable','liability','tax',true),
  ('2400','TDS Payable','liability','tax',false),
  ('3001','Owner''s Capital','equity','capital',true),
  ('3002','Retained Earnings','equity','retained',true),
  ('4000','Revenue','income',NULL,true),
  ('4001','Kit Sales Revenue','income','revenue',true),
  ('4002','Franchise Enrollment Fees','income','revenue',true),
  ('4003','Royalty Income','income','revenue',false),
  ('4004','Training Fees','income','revenue',false),
  ('4005','Other Income','income','revenue',false),
  ('5001','Kit Procurement Cost','expense','cogs',true),
  ('5002','Inward Freight','expense','cogs',false),
  ('6000','Operating Expenses','expense',NULL,true),
  ('6001','Staff Salaries','expense','opex',false),
  ('6002','Rent','expense','opex',false),
  ('6003','Marketing','expense','opex',false),
  ('6004','Software & SaaS','expense','opex',false),
  ('6005','Travel & Conveyance','expense','opex',false),
  ('6006','Office Supplies','expense','opex',false),
  ('6007','Utilities','expense','opex',false),
  ('6008','Professional Fees','expense','opex',false),
  ('6009','Bank Charges','expense','opex',false),
  ('6010','Miscellaneous','expense','opex',false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: FISCAL YEAR
-- ============================================================
INSERT INTO fiscal_years (name, start_date, end_date, is_current)
VALUES ('FY 2025-26','2025-04-01','2026-03-31',true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- SEED: GST CONFIG
-- ============================================================
INSERT INTO gst_config (category, label, rate_percent, cgst_percent, sgst_percent, igst_percent, hsn_sac_code, effective_from)
VALUES
  ('kit_sale','Kit / Material Sales',18,9,9,18,'4901','2024-04-01'),
  ('enrollment_fee','Franchise Enrollment Fee',18,9,9,18,'999293','2024-04-01'),
  ('training_fee','Training / Workshop Fee',18,9,9,18,'999293','2024-04-01')
ON CONFLICT (category) DO NOTHING;
