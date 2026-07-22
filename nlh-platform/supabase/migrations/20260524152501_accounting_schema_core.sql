
-- ============================================================
-- NLH HO ACCOUNTING SCHEMA — CORE TABLES
-- ============================================================

-- 1. CHART OF ACCOUNTS
CREATE TABLE IF NOT EXISTS accounts (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text    NOT NULL UNIQUE,
  name        text    NOT NULL,
  type        text    NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  subtype     text,
  parent_id   uuid    REFERENCES accounts(id),
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. FISCAL YEARS
CREATE TABLE IF NOT EXISTS fiscal_years (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text    NOT NULL UNIQUE,
  start_date  date    NOT NULL,
  end_date    date    NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  is_closed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);

-- 3. JOURNAL ENTRIES
CREATE TABLE IF NOT EXISTS journal_entries (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no        text    NOT NULL UNIQUE,
  date            date    NOT NULL,
  fiscal_year_id  uuid    NOT NULL REFERENCES fiscal_years(id),
  description     text    NOT NULL,
  source          text    NOT NULL CHECK (source IN ('manual','order','enrollment','expense','split','bank','opening','adjustment')),
  source_ref_id   uuid,
  source_ref_type text,
  status          text    NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','voided')),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. JOURNAL LINES
CREATE TABLE IF NOT EXISTS journal_lines (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid    NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id       uuid    NOT NULL REFERENCES accounts(id),
  debit            integer NOT NULL DEFAULT 0,
  credit           integer NOT NULL DEFAULT 0,
  description      text,
  CHECK (debit  >= 0),
  CHECK (credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);

-- 5. VENDORS
CREATE TABLE IF NOT EXISTS vendors (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text    NOT NULL,
  contact_person  text,
  phone           text,
  email           text,
  address         text,
  city            text,
  state           text,
  gstin           text,
  pan             text,
  payment_terms   integer DEFAULT 30,
  opening_balance integer NOT NULL DEFAULT 0,
  account_id      uuid    REFERENCES accounts(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 6. BANK ACCOUNTS (NLH's own)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text    NOT NULL,
  bank_name       text    NOT NULL,
  account_no      text    NOT NULL,
  ifsc            text,
  branch          text,
  opening_balance integer NOT NULL DEFAULT 0,
  opening_date    date,
  account_id      uuid    REFERENCES accounts(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 7. EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  date               date    NOT NULL,
  category           text    NOT NULL CHECK (category IN ('salary','rent','marketing','software','travel','procurement','utilities','professional_fees','office_supplies','other')),
  description        text    NOT NULL,
  vendor_name        text,
  vendor_id          uuid    REFERENCES vendors(id),
  amount             integer NOT NULL,
  gst_amount         integer NOT NULL DEFAULT 0,
  total_amount       integer NOT NULL,
  payment_mode       text    CHECK (payment_mode IN ('cash','bank_transfer','upi','cheque','card')),
  payment_ref        text,
  bank_account_id    uuid    REFERENCES bank_accounts(id),
  receipt_url        text,
  expense_account_id uuid    REFERENCES accounts(id),
  is_recurring       boolean NOT NULL DEFAULT false,
  recurrence         text    CHECK (recurrence IN ('monthly','quarterly','annual')),
  journal_entry_id   uuid    REFERENCES journal_entries(id),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 8. REVENUE SPLITS
CREATE TABLE IF NOT EXISTS revenue_splits (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month         integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year          integer NOT NULL,
  franchisee_id        uuid    NOT NULL REFERENCES franchisees(id),
  franchisee_tier      text    NOT NULL CHECK (franchisee_tier IN ('CF','SMF')),
  student_id           uuid    REFERENCES students(id),
  enrollment_id        uuid    REFERENCES enrollments(id),
  total_fee_collected  integer NOT NULL,
  split_percentage     integer NOT NULL,
  amount_owed          integer NOT NULL,
  amount_paid          integer NOT NULL DEFAULT 0,
  status               text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','part_paid','paid','waived')),
  paid_at              timestamptz,
  payment_ref          text,
  notes                text,
  journal_entry_id     uuid    REFERENCES journal_entries(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- 9. BANK TRANSACTIONS
CREATE TABLE IF NOT EXISTS bank_transactions (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id  uuid    NOT NULL REFERENCES bank_accounts(id),
  txn_date         date    NOT NULL,
  value_date       date,
  description      text    NOT NULL,
  ref_no           text,
  debit            integer NOT NULL DEFAULT 0,
  credit           integer NOT NULL DEFAULT 0,
  balance          integer,
  reconciled       boolean NOT NULL DEFAULT false,
  reconciled_at    timestamptz,
  journal_line_id  uuid    REFERENCES journal_lines(id),
  import_batch_id  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 10. GST CONFIG
CREATE TABLE IF NOT EXISTS gst_config (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  category          text    NOT NULL UNIQUE,
  label             text    NOT NULL,
  rate_percent      numeric(5,2) NOT NULL,
  cgst_percent      numeric(5,2) NOT NULL DEFAULT 0,
  sgst_percent      numeric(5,2) NOT NULL DEFAULT 0,
  igst_percent      numeric(5,2) NOT NULL DEFAULT 0,
  hsn_sac_code      text,
  is_gst_applicable boolean NOT NULL DEFAULT true,
  effective_from    date    NOT NULL,
  effective_to      date,
  notes             text
);

-- 11. GST TRANSACTIONS
CREATE TABLE IF NOT EXISTS gst_transactions (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month    integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year     integer NOT NULL,
  type            text    NOT NULL CHECK (type IN ('output','input')),
  source          text    NOT NULL,
  source_id       uuid    NOT NULL,
  taxable_amount  integer NOT NULL,
  cgst            integer NOT NULL DEFAULT 0,
  sgst            integer NOT NULL DEFAULT 0,
  igst            integer NOT NULL DEFAULT 0,
  total_gst       integer NOT NULL,
  hsn_sac_code    text,
  party_name      text,
  party_gstin     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 12. VENDOR TRANSACTIONS
CREATE TABLE IF NOT EXISTS vendor_transactions (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid    NOT NULL REFERENCES vendors(id),
  date             date    NOT NULL,
  type             text    NOT NULL CHECK (type IN ('purchase','payment','credit_note','debit_note')),
  description      text,
  amount           integer NOT NULL,
  ref_no           text,
  order_id         uuid    REFERENCES orders(id),
  expense_id       uuid    REFERENCES expenses(id),
  journal_entry_id uuid    REFERENCES journal_entries(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Sequential journal entry number
CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 1;

CREATE OR REPLACE FUNCTION next_journal_no()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  yr text := to_char(CURRENT_DATE, 'YYYY');
  n  int  := nextval('journal_entry_seq');
BEGIN
  RETURN 'JV-' || yr || '-' || LPAD(n::text, 4, '0');
END;
$$;
