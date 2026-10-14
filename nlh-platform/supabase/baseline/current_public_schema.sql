-- ============================================================================
-- NLH platform — baseline of the CURRENT `public` schema (schema only, no data)
--
-- Reconstructed 2026-10-13 from READ-ONLY catalog queries against the live
-- project (pg_class / pg_attribute / pg_constraint / pg_indexes / pg_proc /
-- pg_trigger / pg_policies / ACLs / storage.buckets). Nothing was written to
-- the live database and no data row was read.
--
-- PURPOSE: let an ISOLATED database (local Supabase or a Supabase branch)
-- reproduce the schema, because 11 core tables were never created by any file
-- in supabase/migrations/. This is a snapshot, not a migration:
--   * do NOT add it to supabase/migrations/;
--   * do NOT run it against the production project;
--   * load it into an empty isolated database and mark the 160 migrations as
--     already applied instead of replaying them.
--
-- EXPECTED OBJECT COUNTS after loading (compare with the live project):
--   62 tables, 11 sequences, 68 functions, 37 triggers, 305 policies
--   (57+98+45+105), 162 indexes in total (constraint-backed + explicit),
--   RLS enabled on 62/62 tables, 1 storage bucket, 3 storage.objects policies.
--
-- AUTHENTICATION AREA: functions admin_change_email, align_user_id_to_auth,
-- user_last_signins and users_id_mismatches and trigger tr_align_user_id touch
-- auth.users. They are reproduced for fidelity only. Authentication and
-- temporary-password behaviour are out of scope and are not exercised.
--
-- Platform extensions supplied by Supabase itself (not created here):
-- supabase_vault, pg_stat_statements, pg_graphql, pg_net.
-- ============================================================================
set check_function_bodies = off;
set client_min_messages = warning;
set search_path = public, extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- Sequences (11). Counters start fresh in each environment.
-- ---------------------------------------------------------------------------
create sequence if not exists public.credit_note_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.franchisee_agreement_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.franchisee_enrollment_invoice_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.inventory_item_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.invoice_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.journal_entry_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.order_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.proforma_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.receipt_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.sale_return_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;
create sequence if not exists public.student_invoice_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle;

-- ---------------------------------------------------------------------------
-- Tables (a)
-- ---------------------------------------------------------------------------
create table public.access_requests (
  id uuid default uuid_generate_v4() not null,
  full_name text not null,
  email text not null,
  phone text,
  role_requested text not null,
  city text,
  state text,
  message text,
  status text default 'pending'::text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  pincode text,
  date_of_birth date,
  qualification text,
  programs_requested text[],
  first_name text,
  last_name text,
  address text,
  area text,
  business_name text
);

create table public.accounts (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  type text not null,
  subtype text,
  parent_id uuid,
  is_system boolean default false not null,
  is_active boolean default true not null,
  description text,
  created_at timestamp with time zone default now() not null
);

create table public.bank_accounts (
  id uuid default gen_random_uuid() not null,
  name text not null,
  bank_name text not null,
  account_no text not null,
  ifsc text,
  branch text,
  opening_balance integer default 0 not null,
  opening_date date,
  account_id uuid,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table public.bank_transactions (
  id uuid default gen_random_uuid() not null,
  bank_account_id uuid not null,
  txn_date date not null,
  value_date date,
  description text not null,
  ref_no text,
  debit integer default 0 not null,
  credit integer default 0 not null,
  balance integer,
  reconciled boolean default false not null,
  reconciled_at timestamp with time zone,
  journal_line_id uuid,
  import_batch_id text,
  created_at timestamp with time zone default now() not null
);

create table public.batch_sessions (
  id uuid default gen_random_uuid() not null,
  batch_id uuid not null,
  session_date date not null,
  session_number integer not null,
  instructor_id uuid,
  is_substitute boolean default false,
  notes text,
  created_at timestamp with time zone default now(),
  created_by uuid,
  is_holiday boolean default false
);

create table public.batch_students (
  id uuid default gen_random_uuid() not null,
  batch_id uuid not null,
  enrollment_id uuid not null,
  assigned_at timestamp with time zone default now() not null,
  removed_at timestamp with time zone,
  assigned_by uuid,
  notes text
);

create table public.batches (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid,
  instructor_id uuid not null,
  sku_id uuid,
  name text not null,
  is_individual boolean default false not null,
  schedule_days text,
  schedule_time time without time zone,
  is_active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  start_date date,
  sessions_done integer default 0 not null
);

create table public.cf_commission_terms (
  id uuid default gen_random_uuid() not null,
  school_id uuid not null,
  kind text not null,
  sku_id uuid,
  ci_assignment_id uuid,
  share_amount integer default 0 not null,
  updated_by text,
  updated_at timestamp with time zone default now() not null
);

create table public.city_codes (
  city text not null,
  code text not null,
  station text,
  note text
);

create table public.coupon_redemptions (
  id uuid default gen_random_uuid() not null,
  coupon_id uuid not null,
  context text not null,
  ref_id uuid not null,
  order_id uuid,
  student_id uuid,
  franchisee_id uuid,
  base_amount integer default 0 not null,
  discount_amount integer default 0 not null,
  redeemed_by uuid,
  redeemed_at timestamp with time zone default now() not null
);

create table public.coupons (
  id uuid default gen_random_uuid() not null,
  code text not null,
  description text,
  discount_type text not null,
  discount_value numeric not null,
  applies_to text default 'both'::text not null,
  min_amount integer default 0 not null,
  max_discount integer,
  usage_limit integer,
  per_franchisee_limit integer,
  used_count integer default 0 not null,
  valid_from timestamp with time zone,
  valid_until timestamp with time zone,
  active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table public.courses (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  group_name text not null,
  age_min integer,
  age_max integer,
  billing_type text not null,
  description text,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamp with time zone default now()
);

create table public.email_log (
  id uuid default gen_random_uuid() not null,
  type text,
  recipient text,
  recipient_name text,
  subject text,
  status text default 'sent'::text not null,
  error text,
  message_id text,
  bcc text,
  created_at timestamp with time zone default now()
);

create table public.enrollments (
  id uuid default uuid_generate_v4() not null,
  student_id uuid not null,
  sku_id uuid not null,
  franchisee_id uuid,
  enrolled_at timestamp with time zone default now(),
  fee_paid integer default 0,
  payment_ref text,
  payment_mode text,
  status text default 'active'::text,
  next_level_unlocked boolean default false,
  completed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  cert_emailed_at timestamp with time zone,
  cert_wa_sent_at timestamp with time zone,
  cert_wa_message_id text,
  cert_wa_status text,
  fee_amount integer,
  list_price integer,
  waived integer default 0 not null,
  sessions_per_week integer,
  sessions_per_cycle integer,
  cycle_started_at date,
  marks_obtained numeric,
  marks_total numeric,
  marks_remarks text,
  marks_submitted_at timestamp with time zone,
  marks_submitted_by text,
  cert_status text,
  cert_reviewed_at timestamp with time zone,
  cert_reviewed_by text,
  cert_reject_note text,
  cert_issued_at timestamp with time zone,
  cert_issued_by text,
  cert_issued_note text,
  cycle_days text
);

create table public.expenses (
  id uuid default gen_random_uuid() not null,
  date date not null,
  category text not null,
  description text not null,
  vendor_name text,
  vendor_id uuid,
  amount integer not null,
  gst_amount integer default 0 not null,
  total_amount integer not null,
  payment_mode text,
  payment_ref text,
  bank_account_id uuid,
  receipt_url text,
  expense_account_id uuid,
  is_recurring boolean default false not null,
  recurrence text,
  journal_entry_id uuid,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

-- ---------------------------------------------------------------------------
-- Tables (b)
-- ---------------------------------------------------------------------------
create table public.fiscal_years (
  id uuid default gen_random_uuid() not null,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean default false not null,
  is_closed boolean default false not null,
  created_at timestamp with time zone default now() not null
);

create table public.franchisee_agreements (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid not null,
  agreement_no text,
  fee integer not null,
  term_years integer default 3 not null,
  term_start date not null,
  term_end date not null,
  courses jsonb default '[]'::jsonb not null,
  kit jsonb default '[]'::jsonb not null,
  status text default 'draft'::text not null,
  generated_at timestamp with time zone default now() not null,
  generated_by text,
  verification_code text not null,
  signed_at timestamp with time zone,
  signed_name text,
  signed_ip text,
  doc_hash text,
  boldsign_document_id text,
  kind text default 'unit_franchise'::text not null,
  service_model text,
  extra jsonb default '{}'::jsonb not null
);

create table public.franchisee_credit_notes (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid not null,
  order_id uuid,
  suggested_amount integer,
  amount integer not null,
  reason text,
  credit_note_no text,
  status text default 'pending'::text not null,
  requested_by text,
  requested_at timestamp with time zone default now() not null,
  approved_by text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.franchisee_payments (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid not null,
  amount integer not null,
  payment_date date default CURRENT_DATE not null,
  payment_mode text,
  reference_no text,
  notes text,
  recorded_by text,
  created_at timestamp with time zone default now() not null,
  receipt_no text,
  receipt_date date default CURRENT_DATE not null
);

create table public.franchisee_stock_returns (
  id uuid default gen_random_uuid() not null,
  return_no text,
  returning_franchisee_id uuid not null,
  sku_id uuid not null,
  qty integer not null,
  unit_value integer default 0 not null,
  total_credit integer default 0 not null,
  source_order_id uuid,
  source_order_item_id uuid,
  fulfills_order_id uuid,
  status text default 'pending'::text not null,
  reason text,
  requested_by text,
  requested_at timestamp with time zone default now() not null,
  approved_by text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  cancelled_at timestamp with time zone,
  cancelled_by text,
  cancel_reason text,
  fulfills_order_item_id uuid,
  kind text default 'cf_fulfillment'::text not null,
  note text,
  applied_order_id uuid,
  applied_order_payment_id uuid,
  applied_amount integer,
  destination_franchisee_id uuid,
  excluded_kit_items jsonb default '[]'::jsonb not null
);

create table public.franchisees (
  id uuid default uuid_generate_v4() not null,
  parent_id uuid,
  tier text not null,
  business_name text not null,
  owner_name text not null,
  phone text not null,
  email text not null,
  address text,
  city text not null,
  state text not null,
  pincode text,
  gstin text,
  enrollment_fee integer default 0 not null,
  contract_start date,
  contract_end date,
  renewal_fee integer default 0,
  status text default 'active'::text,
  registered_courses text[],
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  registered_skus text[],
  fee_paid integer default 0,
  payment_status text default 'unpaid'::text,
  area text,
  country text default 'India'::text,
  cert_emailed_at timestamp with time zone,
  valid_till date,
  centre_code text,
  enrollment_invoice_no text,
  date_of_birth date,
  qualification text,
  phone2 text
);

create table public.gst_config (
  id uuid default gen_random_uuid() not null,
  category text not null,
  label text not null,
  rate_percent numeric(5,2) not null,
  cgst_percent numeric(5,2) default 0 not null,
  sgst_percent numeric(5,2) default 0 not null,
  igst_percent numeric(5,2) default 0 not null,
  hsn_sac_code text,
  is_gst_applicable boolean default true not null,
  effective_from date not null,
  effective_to date,
  notes text
);

create table public.gst_transactions (
  id uuid default gen_random_uuid() not null,
  period_month integer not null,
  period_year integer not null,
  type text not null,
  source text not null,
  source_id uuid not null,
  taxable_amount integer not null,
  cgst integer default 0 not null,
  sgst integer default 0 not null,
  igst integer default 0 not null,
  total_gst integer not null,
  hsn_sac_code text,
  party_name text,
  party_gstin text,
  created_at timestamp with time zone default now() not null
);

create table public.instructor_attendance (
  id uuid default gen_random_uuid() not null,
  instructor_id uuid not null,
  att_date date not null,
  status text not null,
  created_at timestamp with time zone default now() not null,
  created_by uuid
);

create table public.instructor_courses (
  id uuid default gen_random_uuid() not null,
  instructor_id uuid not null,
  trained_by_nlh boolean default false not null,
  training_fee integer,
  training_date date,
  remuneration_mode text not null,
  remuneration_rate integer not null,
  appointed_at date default CURRENT_DATE not null,
  removed_at date,
  status text default 'active'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  sku_id uuid
);

create table public.instructor_payment_items (
  id uuid default gen_random_uuid() not null,
  payment_id uuid not null,
  item_type text not null,
  description text not null,
  session_id uuid,
  enrollment_id uuid,
  quantity integer default 1 not null,
  rate integer default 0 not null,
  amount integer default 0 not null
);

create table public.instructor_payments (
  id uuid default gen_random_uuid() not null,
  instructor_id uuid not null,
  franchisee_id uuid,
  period_month integer not null,
  period_year integer not null,
  gross_amount integer default 0 not null,
  caution_deduction integer default 0 not null,
  other_deductions integer default 0 not null,
  other_deductions_note text,
  net_amount integer default 0 not null,
  status text default 'draft'::text not null,
  paid_at date,
  paid_mode text,
  paid_ref text,
  notes text,
  generated_by uuid,
  created_at timestamp with time zone default now() not null
);

create table public.instructors (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid,
  full_name text not null,
  phone text,
  email text,
  photo_url text,
  address text,
  area text,
  city text,
  state text,
  pincode text,
  joined_at date,
  left_at date,
  status text default 'active'::text not null,
  caution_amount integer default 0 not null,
  caution_paid_at date,
  caution_mode text,
  caution_status text default 'held'::text not null,
  caution_settled_at date,
  caution_settlement_amount integer,
  caution_notes text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  conveyance_monthly integer default 0 not null,
  office_salary_monthly integer default 0 not null
);

create table public.inventory_items (
  id uuid default gen_random_uuid() not null,
  item_code text,
  name text not null,
  category text default 'component'::text not null,
  unit text default 'pcs'::text not null,
  hsn_code text,
  default_cost integer default 0 not null,
  reorder_level integer default 0 not null,
  is_active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  sell_price integer default 0 not null
);

create table public.journal_entries (
  id uuid default gen_random_uuid() not null,
  entry_no text not null,
  date date not null,
  fiscal_year_id uuid not null,
  description text not null,
  source text not null,
  source_ref_id uuid,
  source_ref_type text,
  status text default 'posted'::text not null,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table public.journal_lines (
  id uuid default gen_random_uuid() not null,
  journal_entry_id uuid not null,
  account_id uuid not null,
  debit integer default 0 not null,
  credit integer default 0 not null,
  description text
);

create table public.kit_items (
  id uuid default gen_random_uuid() not null,
  sku_id uuid not null,
  item_id uuid not null,
  quantity numeric default 1 not null,
  created_at timestamp with time zone default now() not null
);

create table public.kit_price_history (
  id uuid default uuid_generate_v4() not null,
  sku_id uuid not null,
  old_uf integer,
  new_uf integer,
  old_cf integer,
  new_cf integer,
  old_smf integer,
  new_smf integer,
  changed_by text default 'NLH Admin'::text not null,
  changed_at timestamp with time zone default now()
);

create table public.messages (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid not null,
  sender_id uuid,
  sender_name text,
  from_ho boolean not null,
  body text default ''::text,
  created_at timestamp with time zone default now(),
  read_by_ho boolean default false,
  read_by_franchisee boolean default false,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  broadcast_id uuid
);

create table public.order_commission_lines (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  order_item_id uuid,
  kind text not null,
  description text,
  qty integer,
  share_amount integer not null,
  created_at timestamp with time zone default now() not null
);

create table public.order_fulfillment_audit (
  id uuid default gen_random_uuid() not null,
  order_item_id uuid not null,
  order_id uuid not null,
  old_franchisee_id uuid,
  new_franchisee_id uuid,
  changed_by text,
  changed_at timestamp with time zone default now() not null
);

create table public.order_items (
  id uuid default uuid_generate_v4() not null,
  order_id uuid not null,
  sku_id uuid,
  ordered_qty integer default 0 not null,
  sent_qty integer default 0 not null,
  rate integer default 0 not null,
  line_total integer generated always as ((sent_qty * rate)) stored,
  created_at timestamp with time zone default now(),
  item_id uuid,
  excluded_kit_items uuid[] default '{}'::uuid[] not null,
  cf_commission_rate integer,
  fulfilled_by_franchisee_id uuid,
  description text
);

create table public.order_payments (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  amount integer not null,
  paid_on date default CURRENT_DATE not null,
  mode text default 'upi'::text not null,
  reference text,
  note text,
  recorded_by text,
  created_at timestamp with time zone default now() not null,
  receipt_no text,
  receipt_date date default CURRENT_DATE not null
);

create table public.orders (
  id uuid default uuid_generate_v4() not null,
  order_ref text not null,
  placer_id uuid not null,
  placer_tier text not null,
  status text default 'pending'::text not null,
  deliver_to text,
  invoice_no text,
  invoice_url text,
  courier_partner text,
  awb_number text,
  courier_charges integer default 0,
  subtotal integer default 0,
  gst_amount integer default 0,
  grand_total integer default 0,
  payment_mode text,
  payment_ref text,
  paid_at timestamp with time zone,
  dispatched_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  supplier text default 'NLH'::text,
  payment_submitted_at timestamp with time zone,
  payment_verified_at timestamp with time zone,
  amount_paid integer default 0,
  bill_to_name text,
  ship_to text,
  invoice_cancelled_at timestamp with time zone,
  invoice_cancelled_by text,
  bill_to_franchisee_id uuid,
  ship_to_franchisee_id uuid,
  dispatch_date date,
  dispatch_weight numeric(8,3),
  dispatch_freight integer default 0,
  last_reminded_at timestamp with time zone,
  reminder_count integer default 0,
  coupon_id uuid,
  coupon_code text,
  discount_amount integer default 0 not null,
  proforma_no text,
  proforma_generated_at timestamp with time zone,
  invoiced_at timestamp with time zone,
  kind text default 'kit'::text not null,
  service_month date,
  cancel_reason text
);

create table public.payroll_extras (
  id uuid default gen_random_uuid() not null,
  instructor_id uuid not null,
  month text not null,
  incentive integer default 0 not null,
  misc integer default 0 not null,
  misc_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.payroll_overrides (
  id uuid default uuid_generate_v4() not null,
  instructor_id uuid not null,
  month text not null,
  final_amount integer not null,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ---------------------------------------------------------------------------
-- Tables (c)
-- ---------------------------------------------------------------------------
create table public.receipt_counters (
  series text not null,
  centre_code text not null,
  year integer not null,
  last_no integer default 0 not null
);

create table public.revenue_splits (
  id uuid default gen_random_uuid() not null,
  period_month integer not null,
  period_year integer not null,
  franchisee_id uuid not null,
  franchisee_tier text not null,
  student_id uuid,
  enrollment_id uuid,
  total_fee_collected integer not null,
  split_percentage integer not null,
  amount_owed integer not null,
  amount_paid integer default 0 not null,
  status text default 'pending'::text not null,
  paid_at timestamp with time zone,
  payment_ref text,
  notes text,
  journal_entry_id uuid,
  created_at timestamp with time zone default now() not null,
  payment_mode text
);

create table public.school_ci_assignments (
  id uuid default gen_random_uuid() not null,
  school_id uuid not null,
  instructor_id uuid,
  ci_name text not null,
  program text not null,
  level_label text,
  monthly_charge integer not null,
  frequency text default 'Monthly'::text not null,
  starts_on date default CURRENT_DATE not null,
  ends_on date,
  created_by text,
  created_at timestamp with time zone default now() not null
);

create table public.school_sku_rates (
  id uuid default gen_random_uuid() not null,
  franchisee_id uuid not null,
  sku_id uuid not null,
  rate integer default 0 not null,
  cf_cut integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.session_attendance (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  enrollment_id uuid not null,
  student_id uuid not null,
  attended boolean default true not null,
  notes text
);

create table public.skus (
  id uuid default uuid_generate_v4() not null,
  course_id uuid,
  level_name text not null,
  sessions text,
  age_range text,
  uf_rate integer default 0 not null,
  cf_rate integer default 0 not null,
  smf_rate integer default 0 not null,
  student_fee integer default 0 not null,
  uf_share integer default 0 not null,
  warehouse_qty integer default 0 not null,
  min_qty integer default 20 not null,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  total_sessions integer,
  sku_type text default 'course_kit'::text not null,
  supply_category text
);

create table public.stock_ledger (
  id uuid default gen_random_uuid() not null,
  item_id uuid not null,
  location_type text default 'ho'::text not null,
  franchisee_id uuid,
  movement_type text not null,
  qty integer not null,
  unit_cost integer,
  ref_type text,
  ref_id uuid,
  note text,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table public.stock_movements (
  id uuid default uuid_generate_v4() not null,
  sku_id uuid not null,
  movement_type text not null,
  from_entity text,
  to_entity text,
  qty integer not null,
  order_id uuid,
  note text,
  moved_at timestamp with time zone default now(),
  created_by uuid
);

create table public.stock_return_audit (
  id uuid default gen_random_uuid() not null,
  stock_return_id uuid not null,
  action text not null,
  changed_by text,
  changed_at timestamp with time zone default now() not null,
  detail jsonb default '{}'::jsonb not null
);

create table public.student_fee_events (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  enrollment_id uuid,
  field text not null,
  old_value text,
  new_value text,
  delta integer,
  actor text,
  at timestamp with time zone default now() not null
);

create table public.student_invoices (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  franchisee_id uuid,
  invoice_no text,
  invoice_date date default CURRENT_DATE not null,
  items jsonb default '[]'::jsonb not null,
  subtotal integer default 0 not null,
  discount integer default 0 not null,
  coupon_code text,
  total integer default 0 not null,
  amount_paid integer default 0 not null,
  status text default 'unpaid'::text not null,
  notes text,
  created_by text,
  created_at timestamp with time zone default now(),
  enrollment_id uuid
);

create table public.student_no_class (
  id uuid default gen_random_uuid() not null,
  enrollment_id uuid not null,
  class_date date not null,
  batch_id uuid,
  created_at timestamp with time zone default now() not null
);

create table public.student_payments (
  id uuid default gen_random_uuid() not null,
  student_id uuid not null,
  franchisee_id uuid,
  amount integer not null,
  mode text,
  reference text,
  paid_at date default CURRENT_DATE not null,
  note text,
  created_at timestamp with time zone default now(),
  receipt_no text,
  receipt_date date default CURRENT_DATE not null,
  receipt_no_previous text
);

create table public.students (
  id uuid default uuid_generate_v4() not null,
  full_name text not null,
  dob date,
  gender text,
  parent_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  channel text default 'franchise'::text not null,
  franchisee_id uuid,
  is_active boolean default true,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  pincode text,
  fee_total integer default 0,
  fee_paid integer default 0,
  payment_mode text,
  payment_status text default 'unpaid'::text,
  country text default 'India'::text,
  area text,
  registered_at date,
  camp_name text,
  coupon_id uuid,
  coupon_code text,
  discount_amount integer default 0 not null,
  other_charges integer default 0 not null,
  closed_at timestamp with time zone,
  close_reason text,
  waived_amount integer default 0 not null
);

create table public.transaction_items (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  sku_id uuid,
  item_id uuid,
  enrollment_id uuid,
  name text,
  qty integer default 1 not null,
  sent_qty integer,
  rate integer default 0 not null,
  amount integer,
  excluded_kit_items uuid[] default '{}'::uuid[] not null,
  cf_commission_rate integer,
  created_at timestamp with time zone default now() not null
);

create table public.transaction_payments (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  amount integer not null,
  paid_on date not null,
  mode text,
  reference text,
  note text,
  recorded_by text,
  receipt_no text,
  created_at timestamp with time zone default now() not null
);

create table public.transactions (
  id uuid default gen_random_uuid() not null,
  type text not null,
  party_id uuid not null,
  bill_to_party_id uuid,
  person_id uuid,
  placer_id uuid,
  placer_tier text,
  status text default 'draft'::text not null,
  subtotal integer default 0 not null,
  discount_amount integer default 0 not null,
  coupon_id uuid,
  coupon_code text,
  tax_amount integer default 0 not null,
  total integer default 0 not null,
  amount_paid integer default 0 not null,
  document_type text,
  document_no text,
  paid_at timestamp with time zone,
  payment_verified_at timestamp with time zone,
  payment_submitted_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.users (
  id uuid default uuid_generate_v4() not null,
  email text not null,
  phone text,
  full_name text not null,
  role text not null,
  franchisee_id uuid,
  student_id uuid,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  permissions jsonb default '{}'::jsonb not null
);

create table public.vendor_transactions (
  id uuid default gen_random_uuid() not null,
  vendor_id uuid not null,
  date date not null,
  type text not null,
  description text,
  amount integer not null,
  ref_no text,
  order_id uuid,
  expense_id uuid,
  journal_entry_id uuid,
  created_at timestamp with time zone default now() not null
);

create table public.vendors (
  id uuid default gen_random_uuid() not null,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  gstin text,
  pan text,
  payment_terms integer default 30,
  opening_balance integer default 0 not null,
  account_id uuid,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table public.whatsapp_messages (
  id uuid default gen_random_uuid() not null,
  wa_message_id text,
  direction text not null,
  from_number text,
  to_number text,
  message_type text,
  message_body text,
  media_id text,
  status text,
  raw jsonb,
  created_at timestamp with time zone default now() not null,
  media_url text
);

-- ---------------------------------------------------------------------------
-- Primary keys, unique and check constraints
-- ---------------------------------------------------------------------------
alter table public.access_requests add constraint access_requests_pkey PRIMARY KEY (id);
alter table public.access_requests add constraint access_requests_role_requested_check CHECK ((role_requested = ANY (ARRAY['smf'::text, 'cf'::text, 'uf'::text, 'staff'::text, 'student'::text])));
alter table public.access_requests add constraint access_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);
alter table public.accounts add constraint accounts_code_key UNIQUE (code);
alter table public.accounts add constraint accounts_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text, 'income'::text, 'expense'::text])));
alter table public.bank_accounts add constraint bank_accounts_pkey PRIMARY KEY (id);
alter table public.bank_transactions add constraint bank_transactions_pkey PRIMARY KEY (id);
alter table public.batch_sessions add constraint batch_sessions_pkey PRIMARY KEY (id);
alter table public.batch_students add constraint batch_students_pkey PRIMARY KEY (id);
alter table public.batch_students add constraint batch_students_batch_id_enrollment_id_assigned_at_key UNIQUE (batch_id, enrollment_id, assigned_at);
alter table public.batches add constraint batches_pkey PRIMARY KEY (id);
alter table public.cf_commission_terms add constraint cf_commission_terms_pkey PRIMARY KEY (id);
alter table public.cf_commission_terms add constraint cf_commission_terms_check CHECK ((((kind = 'kit'::text) AND (sku_id IS NOT NULL) AND (ci_assignment_id IS NULL)) OR ((kind = 'ci'::text) AND (ci_assignment_id IS NOT NULL) AND (sku_id IS NULL))));
alter table public.cf_commission_terms add constraint cf_commission_terms_kind_check CHECK ((kind = ANY (ARRAY['kit'::text, 'ci'::text])));
alter table public.cf_commission_terms add constraint cf_commission_terms_share_amount_check CHECK ((share_amount >= 0));
alter table public.city_codes add constraint city_codes_pkey PRIMARY KEY (city);
alter table public.coupon_redemptions add constraint coupon_redemptions_pkey PRIMARY KEY (id);
alter table public.coupon_redemptions add constraint coupon_redemptions_context_check CHECK ((context = ANY (ARRAY['order'::text, 'student'::text])));
alter table public.coupons add constraint coupons_pkey PRIMARY KEY (id);
alter table public.coupons add constraint coupons_code_key UNIQUE (code);
alter table public.coupons add constraint coupons_applies_to_check CHECK ((applies_to = ANY (ARRAY['orders'::text, 'students'::text, 'both'::text])));
alter table public.coupons add constraint coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'flat'::text])));
alter table public.coupons add constraint coupons_discount_value_check CHECK ((discount_value > (0)::numeric));
alter table public.coupons add constraint coupons_valid_until_after_from CHECK (((valid_from IS NULL) OR (valid_until IS NULL) OR (valid_until >= valid_from)));
alter table public.courses add constraint courses_pkey PRIMARY KEY (id);
alter table public.courses add constraint courses_billing_type_check CHECK ((billing_type = ANY (ARRAY['session'::text, 'monthly'::text])));
alter table public.email_log add constraint email_log_pkey PRIMARY KEY (id);
alter table public.enrollments add constraint enrollments_pkey PRIMARY KEY (id);
alter table public.enrollments add constraint enrollments_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['upi'::text, 'neft'::text, 'cash'::text, 'cheque'::text, 'razorpay'::text])));
alter table public.enrollments add constraint enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'dropped'::text])));
alter table public.expenses add constraint expenses_pkey PRIMARY KEY (id);
alter table public.expenses add constraint expenses_category_check CHECK ((category = ANY (ARRAY['salary'::text, 'rent'::text, 'marketing'::text, 'software'::text, 'travel'::text, 'procurement'::text, 'utilities'::text, 'professional_fees'::text, 'office_supplies'::text, 'other'::text])));
alter table public.expenses add constraint expenses_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'upi'::text, 'cheque'::text, 'card'::text])));
alter table public.expenses add constraint expenses_recurrence_check CHECK ((recurrence = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'annual'::text])));
alter table public.fiscal_years add constraint fiscal_years_pkey PRIMARY KEY (id);
alter table public.fiscal_years add constraint fiscal_years_name_key UNIQUE (name);
alter table public.fiscal_years add constraint fiscal_years_check CHECK ((end_date > start_date));
alter table public.franchisee_agreements add constraint franchisee_agreements_pkey PRIMARY KEY (id);
alter table public.franchisee_agreements add constraint franchisee_agreements_agreement_no_key UNIQUE (agreement_no);
alter table public.franchisee_agreements add constraint franchisee_agreements_kind_check CHECK ((kind = ANY (ARRAY['unit_franchise'::text, 'school'::text])));
alter table public.franchisee_agreements add constraint franchisee_agreements_service_model_check CHECK (((service_model IS NULL) OR (service_model = ANY (ARRAY['inhouse'::text, 'full_service'::text]))));
alter table public.franchisee_agreements add constraint franchisee_agreements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'signed'::text])));
alter table public.franchisee_credit_notes add constraint franchisee_credit_notes_pkey PRIMARY KEY (id);
alter table public.franchisee_credit_notes add constraint franchisee_credit_notes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.franchisee_payments add constraint franchisee_payments_pkey PRIMARY KEY (id);
alter table public.franchisee_payments add constraint franchisee_payments_receipt_no_key UNIQUE (receipt_no);
alter table public.franchisee_payments add constraint franchisee_payments_amount_check CHECK ((amount > 0));
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_pkey PRIMARY KEY (id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_kind_check CHECK ((kind = ANY (ARRAY['cf_fulfillment'::text, 'physical_return'::text])));
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_qty_check CHECK ((qty > 0));
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_status_check CHECK ((status = ANY (ARRAY['approved'::text, 'cancelled'::text])));
alter table public.franchisees add constraint franchisees_pkey PRIMARY KEY (id);
alter table public.franchisees add constraint franchisees_centre_code_key UNIQUE (centre_code);
alter table public.franchisees add constraint franchisees_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text, 'expired'::text])));
alter table public.franchisees add constraint franchisees_tier_check CHECK ((tier = ANY (ARRAY['SMF'::text, 'CF'::text, 'UF'::text, 'NLH'::text, 'SCHOOL'::text])));
alter table public.gst_config add constraint gst_config_pkey PRIMARY KEY (id);
alter table public.gst_config add constraint gst_config_category_key UNIQUE (category);
alter table public.gst_transactions add constraint gst_transactions_pkey PRIMARY KEY (id);
alter table public.gst_transactions add constraint gst_transactions_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12)));
alter table public.gst_transactions add constraint gst_transactions_type_check CHECK ((type = ANY (ARRAY['output'::text, 'input'::text])));
alter table public.instructor_attendance add constraint instructor_attendance_pkey PRIMARY KEY (id);
alter table public.instructor_attendance add constraint instructor_attendance_instructor_id_att_date_key UNIQUE (instructor_id, att_date);
alter table public.instructor_attendance add constraint instructor_attendance_status_check CHECK ((status = ANY (ARRAY['P'::text, 'O'::text])));
alter table public.instructor_courses add constraint instructor_courses_pkey PRIMARY KEY (id);
alter table public.instructor_courses add constraint instructor_courses_instructor_id_sku_id_appointed_at_key UNIQUE (instructor_id, sku_id, appointed_at);
alter table public.instructor_courses add constraint instructor_courses_remuneration_mode_check CHECK ((remuneration_mode = ANY (ARRAY['per_student'::text, 'per_session'::text, 'monthly'::text, 'per_student_month'::text])));
alter table public.instructor_courses add constraint instructor_courses_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
alter table public.instructor_payment_items add constraint instructor_payment_items_pkey PRIMARY KEY (id);
alter table public.instructor_payment_items add constraint instructor_payment_items_item_type_check CHECK ((item_type = ANY (ARRAY['session_fee'::text, 'enrollment_completion'::text, 'monthly_base'::text, 'bonus'::text, 'deduction'::text, 'other'::text])));
alter table public.instructor_payments add constraint instructor_payments_pkey PRIMARY KEY (id);
alter table public.instructor_payments add constraint instructor_payments_instructor_id_period_month_period_year_key UNIQUE (instructor_id, period_month, period_year);
alter table public.instructor_payments add constraint instructor_payments_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12)));
alter table public.instructor_payments add constraint instructor_payments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'paid'::text])));
alter table public.instructors add constraint instructors_pkey PRIMARY KEY (id);
alter table public.instructors add constraint instructors_caution_mode_check CHECK ((caution_mode = ANY (ARRAY['upfront'::text, 'deducted'::text, 'waived'::text])));
alter table public.instructors add constraint instructors_caution_status_check CHECK ((caution_status = ANY (ARRAY['held'::text, 'refunded'::text, 'forfeited'::text, 'partial'::text])));
alter table public.instructors add constraint instructors_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'resigned'::text, 'terminated'::text])));
alter table public.inventory_items add constraint inventory_items_pkey PRIMARY KEY (id);
alter table public.inventory_items add constraint inventory_items_item_code_key UNIQUE (item_code);
alter table public.journal_entries add constraint journal_entries_pkey PRIMARY KEY (id);
alter table public.journal_entries add constraint journal_entries_entry_no_key UNIQUE (entry_no);
alter table public.journal_entries add constraint journal_entries_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'order'::text, 'enrollment'::text, 'expense'::text, 'split'::text, 'bank'::text, 'opening'::text, 'adjustment'::text])));
alter table public.journal_entries add constraint journal_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'voided'::text])));
alter table public.journal_lines add constraint journal_lines_pkey PRIMARY KEY (id);
alter table public.journal_lines add constraint journal_lines_check CHECK ((NOT ((debit > 0) AND (credit > 0))));
alter table public.journal_lines add constraint journal_lines_credit_check CHECK ((credit >= 0));
alter table public.journal_lines add constraint journal_lines_debit_check CHECK ((debit >= 0));
alter table public.kit_items add constraint kit_items_pkey PRIMARY KEY (id);
alter table public.kit_items add constraint kit_items_sku_id_item_id_key UNIQUE (sku_id, item_id);
alter table public.kit_items add constraint kit_items_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.kit_price_history add constraint kit_price_history_pkey PRIMARY KEY (id);
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.order_commission_lines add constraint order_commission_lines_pkey PRIMARY KEY (id);
alter table public.order_commission_lines add constraint order_commission_lines_kind_check CHECK ((kind = ANY (ARRAY['kit'::text, 'ci'::text])));
alter table public.order_commission_lines add constraint order_commission_lines_share_amount_check CHECK ((share_amount >= 0));
alter table public.order_fulfillment_audit add constraint order_fulfillment_audit_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_sku_or_item CHECK (((sku_id IS NOT NULL) OR (item_id IS NOT NULL) OR (description IS NOT NULL)));
alter table public.order_payments add constraint order_payments_pkey PRIMARY KEY (id);
alter table public.order_payments add constraint order_payments_amount_check CHECK ((amount > 0));
alter table public.order_payments add constraint order_payments_mode_check CHECK ((mode = ANY (ARRAY['upi'::text, 'neft'::text, 'cash'::text, 'cheque'::text, 'razorpay'::text, 'other'::text, 'credit_note'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_invoice_no_key UNIQUE (invoice_no);
alter table public.orders add constraint orders_order_ref_key UNIQUE (order_ref);
alter table public.orders add constraint orders_kind_check CHECK ((kind = ANY (ARRAY['kit'::text, 'service'::text])));
alter table public.orders add constraint orders_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['upi'::text, 'neft'::text, 'cash'::text, 'cheque'::text, 'razorpay'::text, 'other'::text, 'credit_note'::text])));
alter table public.orders add constraint orders_placer_tier_check CHECK ((placer_tier = ANY (ARRAY['SMF'::text, 'CF'::text, 'UF'::text])));
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'proforma'::text, 'invoiced'::text, 'part_paid'::text, 'payment_submitted'::text, 'dispatched'::text, 'closed'::text, 'cancelled'::text])));
alter table public.payroll_extras add constraint payroll_extras_pkey PRIMARY KEY (id);
alter table public.payroll_extras add constraint payroll_extras_instructor_id_month_key UNIQUE (instructor_id, month);
alter table public.payroll_overrides add constraint payroll_overrides_pkey PRIMARY KEY (id);
alter table public.payroll_overrides add constraint payroll_overrides_instructor_id_month_key UNIQUE (instructor_id, month);
alter table public.receipt_counters add constraint receipt_counters_pkey PRIMARY KEY (series, centre_code, year);
alter table public.revenue_splits add constraint revenue_splits_pkey PRIMARY KEY (id);
alter table public.revenue_splits add constraint revenue_splits_franchisee_tier_check CHECK ((franchisee_tier = ANY (ARRAY['CF'::text, 'SMF'::text])));
alter table public.revenue_splits add constraint revenue_splits_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'upi'::text, 'cheque'::text, 'card'::text])));
alter table public.revenue_splits add constraint revenue_splits_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12)));
alter table public.revenue_splits add constraint revenue_splits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'part_paid'::text, 'paid'::text, 'waived'::text])));
alter table public.school_ci_assignments add constraint school_ci_assignments_pkey PRIMARY KEY (id);
alter table public.school_ci_assignments add constraint school_ci_assignments_monthly_charge_check CHECK ((monthly_charge >= 0));
alter table public.school_sku_rates add constraint school_sku_rates_pkey PRIMARY KEY (id);
alter table public.school_sku_rates add constraint school_sku_rates_franchisee_id_sku_id_key UNIQUE (franchisee_id, sku_id);
alter table public.session_attendance add constraint session_attendance_pkey PRIMARY KEY (id);
alter table public.session_attendance add constraint session_attendance_session_enrollment_key UNIQUE (session_id, enrollment_id);
alter table public.skus add constraint skus_pkey PRIMARY KEY (id);
alter table public.stock_ledger add constraint stock_ledger_pkey PRIMARY KEY (id);
alter table public.stock_movements add constraint stock_movements_pkey PRIMARY KEY (id);
alter table public.stock_movements add constraint stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['intake'::text, 'dispatch'::text, 'return'::text, 'adjustment'::text])));
alter table public.stock_return_audit add constraint stock_return_audit_pkey PRIMARY KEY (id);
alter table public.stock_return_audit add constraint stock_return_audit_action_check CHECK ((action = ANY (ARRAY['created'::text, 'cancelled'::text])));
alter table public.student_fee_events add constraint student_fee_events_pkey PRIMARY KEY (id);
alter table public.student_invoices add constraint student_invoices_pkey PRIMARY KEY (id);
alter table public.student_invoices add constraint student_invoices_invoice_no_key UNIQUE (invoice_no);
alter table public.student_no_class add constraint student_no_class_pkey PRIMARY KEY (id);
alter table public.student_no_class add constraint student_no_class_enrollment_id_class_date_key UNIQUE (enrollment_id, class_date);
alter table public.student_payments add constraint student_payments_pkey PRIMARY KEY (id);
alter table public.student_payments add constraint student_payments_amount_positive CHECK ((amount > 0));
alter table public.student_payments add constraint student_payments_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['cash'::text, 'upi'::text, 'bank_transfer'::text, 'cheque'::text, 'card'::text, 'online'::text, 'neft'::text, 'razorpay'::text, 'other'::text, 'opening'::text]))));
alter table public.students add constraint students_pkey PRIMARY KEY (id);
alter table public.students add constraint students_channel_check CHECK ((channel = ANY (ARRAY['franchise'::text, 'own_centre'::text, 'international'::text, 'walk-in'::text, 'referral'::text, 'online'::text, 'camp'::text, 'school'::text, 'other'::text])));
alter table public.students add constraint students_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text])));
alter table public.transaction_items add constraint transaction_items_pkey PRIMARY KEY (id);
alter table public.transaction_payments add constraint transaction_payments_pkey PRIMARY KEY (id);
alter table public.transaction_payments add constraint transaction_payments_receipt_no_key UNIQUE (receipt_no);
alter table public.transactions add constraint transactions_pkey PRIMARY KEY (id);
alter table public.transactions add constraint transactions_document_type_check CHECK ((document_type = ANY (ARRAY['invoice'::text, 'proforma'::text, 'credit_note'::text])));
alter table public.transactions add constraint transactions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'part_paid'::text, 'paid'::text, 'cancelled'::text])));
alter table public.transactions add constraint transactions_type_check CHECK ((type = ANY (ARRAY['kit_order'::text, 'course_fee'::text, 'franchise_fee'::text, 'commission_payout'::text])));
alter table public.users add constraint users_pkey PRIMARY KEY (id);
alter table public.users add constraint users_email_key UNIQUE (email);
alter table public.users add constraint users_phone_key UNIQUE (phone);
alter table public.users add constraint users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text, 'manager'::text, 'staff'::text, 'smf'::text, 'cf'::text, 'uf'::text, 'student'::text, 'school'::text])));
alter table public.vendor_transactions add constraint vendor_transactions_pkey PRIMARY KEY (id);
alter table public.vendor_transactions add constraint vendor_transactions_type_check CHECK ((type = ANY (ARRAY['purchase'::text, 'payment'::text, 'credit_note'::text, 'debit_note'::text])));
alter table public.vendors add constraint vendors_pkey PRIMARY KEY (id);
alter table public.whatsapp_messages add constraint whatsapp_messages_pkey PRIMARY KEY (id);
alter table public.whatsapp_messages add constraint whatsapp_messages_wa_message_id_key UNIQUE (wa_message_id);
alter table public.whatsapp_messages add constraint whatsapp_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
alter table public.accounts add constraint accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES accounts(id);
alter table public.bank_accounts add constraint bank_accounts_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id);
alter table public.bank_transactions add constraint bank_transactions_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
alter table public.bank_transactions add constraint bank_transactions_journal_line_id_fkey FOREIGN KEY (journal_line_id) REFERENCES journal_lines(id);
alter table public.batch_sessions add constraint batch_sessions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE;
alter table public.batch_sessions add constraint batch_sessions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id);
alter table public.batch_students add constraint batch_students_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.batch_students add constraint batch_students_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE;
alter table public.batch_students add constraint batch_students_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
alter table public.batches add constraint batches_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.batches add constraint batches_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.batches add constraint batches_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE;
alter table public.cf_commission_terms add constraint cf_commission_terms_ci_assignment_id_fkey FOREIGN KEY (ci_assignment_id) REFERENCES school_ci_assignments(id) ON DELETE CASCADE;
alter table public.cf_commission_terms add constraint cf_commission_terms_school_id_fkey FOREIGN KEY (school_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.cf_commission_terms add constraint cf_commission_terms_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE;
alter table public.coupon_redemptions add constraint coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE;
alter table public.enrollments add constraint enrollments_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.enrollments add constraint enrollments_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.enrollments add constraint enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.expenses add constraint expenses_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
alter table public.expenses add constraint expenses_expense_account_id_fkey FOREIGN KEY (expense_account_id) REFERENCES accounts(id);
alter table public.expenses add constraint expenses_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id);
alter table public.expenses add constraint expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
alter table public.franchisee_agreements add constraint franchisee_agreements_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.franchisee_credit_notes add constraint franchisee_credit_notes_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id);
alter table public.franchisee_credit_notes add constraint franchisee_credit_notes_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.franchisee_payments add constraint franchisee_payments_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_applied_order_id_fkey FOREIGN KEY (applied_order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_applied_order_payment_id_fkey FOREIGN KEY (applied_order_payment_id) REFERENCES order_payments(id) ON DELETE SET NULL;
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_destination_franchisee_id_fkey FOREIGN KEY (destination_franchisee_id) REFERENCES franchisees(id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_fulfills_order_id_fkey FOREIGN KEY (fulfills_order_id) REFERENCES orders(id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_fulfills_order_item_id_fkey FOREIGN KEY (fulfills_order_item_id) REFERENCES order_items(id) ON DELETE SET NULL;
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_returning_franchisee_id_fkey FOREIGN KEY (returning_franchisee_id) REFERENCES franchisees(id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES orders(id);
alter table public.franchisee_stock_returns add constraint franchisee_stock_returns_source_order_item_id_fkey FOREIGN KEY (source_order_item_id) REFERENCES order_items(id);
alter table public.franchisees add constraint franchisees_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.instructor_attendance add constraint instructor_attendance_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.instructor_courses add constraint instructor_courses_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.instructor_courses add constraint instructor_courses_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE;
alter table public.instructor_payment_items add constraint instructor_payment_items_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL;
alter table public.instructor_payment_items add constraint instructor_payment_items_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES instructor_payments(id) ON DELETE CASCADE;
alter table public.instructor_payments add constraint instructor_payments_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.instructor_payments add constraint instructor_payments_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.instructor_payments add constraint instructor_payments_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.instructors add constraint instructors_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.journal_entries add constraint journal_entries_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id);
alter table public.journal_lines add constraint journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id);
alter table public.journal_lines add constraint journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
alter table public.kit_items add constraint kit_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT;
alter table public.kit_items add constraint kit_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE;
alter table public.kit_price_history add constraint kit_price_history_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.order_commission_lines add constraint order_commission_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_commission_lines add constraint order_commission_lines_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_fulfilled_by_franchisee_id_fkey FOREIGN KEY (fulfilled_by_franchisee_id) REFERENCES franchisees(id);
alter table public.order_items add constraint order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id);
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.order_payments add constraint order_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_bill_to_franchisee_id_fkey FOREIGN KEY (bill_to_franchisee_id) REFERENCES franchisees(id);
alter table public.orders add constraint orders_placer_id_fkey FOREIGN KEY (placer_id) REFERENCES franchisees(id);
alter table public.orders add constraint orders_ship_to_franchisee_id_fkey FOREIGN KEY (ship_to_franchisee_id) REFERENCES franchisees(id);
alter table public.payroll_extras add constraint payroll_extras_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.payroll_overrides add constraint payroll_overrides_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE;
alter table public.revenue_splits add constraint revenue_splits_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id);
alter table public.revenue_splits add constraint revenue_splits_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id);
alter table public.revenue_splits add constraint revenue_splits_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id);
alter table public.revenue_splits add constraint revenue_splits_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id);
alter table public.school_ci_assignments add constraint school_ci_assignments_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE SET NULL;
alter table public.school_ci_assignments add constraint school_ci_assignments_school_id_fkey FOREIGN KEY (school_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.school_sku_rates add constraint school_sku_rates_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE;
alter table public.school_sku_rates add constraint school_sku_rates_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.session_attendance add constraint session_attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
alter table public.session_attendance add constraint session_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES batch_sessions(id) ON DELETE CASCADE;
alter table public.session_attendance add constraint session_attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.skus add constraint skus_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public.stock_ledger add constraint stock_ledger_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id);
alter table public.stock_ledger add constraint stock_ledger_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT;
alter table public.stock_movements add constraint stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.stock_movements add constraint stock_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.stock_movements add constraint stock_movements_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.student_fee_events add constraint student_fee_events_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL;
alter table public.student_fee_events add constraint student_fee_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_invoices add constraint student_invoices_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL;
alter table public.student_invoices add constraint student_invoices_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id);
alter table public.student_invoices add constraint student_invoices_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_no_class add constraint student_no_class_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL;
alter table public.student_no_class add constraint student_no_class_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE;
alter table public.student_payments add constraint student_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.students add constraint students_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.transaction_items add constraint transaction_items_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollments(id);
alter table public.transaction_items add constraint transaction_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id);
alter table public.transaction_items add constraint transaction_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES skus(id);
alter table public.transaction_items add constraint transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
alter table public.transaction_payments add constraint transaction_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
alter table public.transactions add constraint transactions_bill_to_party_id_fkey FOREIGN KEY (bill_to_party_id) REFERENCES franchisees(id);
alter table public.transactions add constraint transactions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id);
alter table public.transactions add constraint transactions_party_id_fkey FOREIGN KEY (party_id) REFERENCES franchisees(id);
alter table public.transactions add constraint transactions_person_id_fkey FOREIGN KEY (person_id) REFERENCES students(id);
alter table public.transactions add constraint transactions_placer_id_fkey FOREIGN KEY (placer_id) REFERENCES franchisees(id);
alter table public.users add constraint fk_users_franchisee FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE SET NULL;
alter table public.users add constraint fk_users_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;
alter table public.vendor_transactions add constraint vendor_transactions_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id);
alter table public.vendor_transactions add constraint vendor_transactions_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id);
alter table public.vendor_transactions add constraint vendor_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.vendor_transactions add constraint vendor_transactions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
alter table public.vendors add constraint vendors_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id);

-- ---------------------------------------------------------------------------
-- Indexes (those not created by a constraint)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_access_requests_email ON public.access_requests USING btree (email);
CREATE INDEX idx_access_requests_status ON public.access_requests USING btree (status);
CREATE INDEX idx_batch_sessions_batch ON public.batch_sessions USING btree (batch_id, session_date DESC);
CREATE INDEX idx_batch_sessions_batch_id ON public.batch_sessions USING btree (batch_id);
CREATE INDEX batch_students_batch_id_idx ON public.batch_students USING btree (batch_id) WHERE (removed_at IS NULL);
CREATE INDEX idx_batch_students_enrollment_id ON public.batch_students USING btree (enrollment_id);
CREATE INDEX batches_instructor_id_is_active_idx ON public.batches USING btree (instructor_id, is_active);
CREATE INDEX batches_sku_id_idx ON public.batches USING btree (sku_id);
CREATE INDEX idx_batches_franchisee_id ON public.batches USING btree (franchisee_id);
CREATE UNIQUE INDEX cf_commission_ci_uq ON public.cf_commission_terms USING btree (ci_assignment_id) WHERE (kind = 'ci'::text);
CREATE UNIQUE INDEX cf_commission_kit_uq ON public.cf_commission_terms USING btree (school_id, sku_id) WHERE (kind = 'kit'::text);
CREATE INDEX idx_redemption_coupon ON public.coupon_redemptions USING btree (coupon_id);
CREATE UNIQUE INDEX uq_redemption_ref ON public.coupon_redemptions USING btree (coupon_id, context, ref_id);
CREATE INDEX idx_email_log_created ON public.email_log USING btree (created_at DESC);
CREATE INDEX idx_enrollments_franchisee_id ON public.enrollments USING btree (franchisee_id);
CREATE INDEX idx_enrollments_sku ON public.enrollments USING btree (sku_id);
CREATE INDEX idx_enrollments_student ON public.enrollments USING btree (student_id);
CREATE INDEX franchisee_agreements_boldsign_doc_idx ON public.franchisee_agreements USING btree (boldsign_document_id);
CREATE INDEX franchisee_agreements_franchisee_idx ON public.franchisee_agreements USING btree (franchisee_id);
CREATE INDEX credit_notes_franchisee_idx ON public.franchisee_credit_notes USING btree (franchisee_id);
CREATE INDEX franchisee_payments_franchisee_idx ON public.franchisee_payments USING btree (franchisee_id);
CREATE INDEX franchisee_stock_returns_destination_idx ON public.franchisee_stock_returns USING btree (destination_franchisee_id);
CREATE INDEX franchisee_stock_returns_fulfills_idx ON public.franchisee_stock_returns USING btree (fulfills_order_id);
CREATE INDEX franchisee_stock_returns_return_no_idx ON public.franchisee_stock_returns USING btree (return_no);
CREATE INDEX franchisee_stock_returns_returning_idx ON public.franchisee_stock_returns USING btree (returning_franchisee_id);
CREATE INDEX idx_franchisees_city ON public.franchisees USING btree (city, state);
CREATE INDEX idx_franchisees_parent_id ON public.franchisees USING btree (parent_id);
CREATE INDEX idx_franchisees_state ON public.franchisees USING btree (state);
CREATE INDEX idx_franchisees_tier ON public.franchisees USING btree (tier);
CREATE INDEX instructor_attendance_date_idx ON public.instructor_attendance USING btree (att_date);
CREATE INDEX idx_instructor_courses_instr_id ON public.instructor_courses USING btree (instructor_id);
CREATE INDEX instructor_courses_instructor_id_status_idx ON public.instructor_courses USING btree (instructor_id, status);
CREATE INDEX instructor_courses_sku_id_idx ON public.instructor_courses USING btree (sku_id);
CREATE INDEX idx_instr_pay_items_payment_id ON public.instructor_payment_items USING btree (payment_id);
CREATE INDEX idx_instructor_payments_fr_id ON public.instructor_payments USING btree (franchisee_id);
CREATE INDEX instructor_payments_instructor_id_period_year_period_month_idx ON public.instructor_payments USING btree (instructor_id, period_year, period_month);
CREATE INDEX idx_instructors_franchisee_id ON public.instructors USING btree (franchisee_id);
CREATE INDEX instructors_franchisee_id_status_idx ON public.instructors USING btree (franchisee_id, status);
CREATE INDEX idx_kit_items_sku ON public.kit_items USING btree (sku_id);
CREATE INDEX idx_kit_price_hist_sku ON public.kit_price_history USING btree (sku_id);
CREATE INDEX idx_messages_broadcast ON public.messages USING btree (broadcast_id);
CREATE INDEX idx_messages_thread ON public.messages USING btree (franchisee_id, created_at);
CREATE INDEX order_commission_lines_order_idx ON public.order_commission_lines USING btree (order_id);
CREATE INDEX order_fulfillment_audit_item_idx ON public.order_fulfillment_audit USING btree (order_item_id);
CREATE INDEX idx_order_items_item ON public.order_items USING btree (item_id);
CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX order_payments_order_idx ON public.order_payments USING btree (order_id, paid_on DESC);
CREATE INDEX order_payments_receipt_no_idx ON public.order_payments USING btree (receipt_no);
CREATE INDEX idx_orders_placer_id ON public.orders USING btree (placer_id);
CREATE INDEX idx_orders_status ON public.orders USING btree (status);
CREATE UNIQUE INDEX orders_service_month_uq ON public.orders USING btree (bill_to_franchisee_id, service_month) WHERE ((kind = 'service'::text) AND (invoice_cancelled_at IS NULL));
CREATE INDEX school_ci_assignments_school_idx ON public.school_ci_assignments USING btree (school_id);
CREATE INDEX idx_session_att_enr ON public.session_attendance USING btree (enrollment_id);
CREATE INDEX idx_session_att_session ON public.session_attendance USING btree (session_id);
CREATE INDEX idx_skus_course ON public.skus USING btree (course_id);
CREATE INDEX idx_stock_ledger_item ON public.stock_ledger USING btree (item_id);
CREATE INDEX idx_stock_ledger_ref ON public.stock_ledger USING btree (ref_type, ref_id);
CREATE INDEX idx_stock_movements_sku ON public.stock_movements USING btree (sku_id);
CREATE INDEX stock_return_audit_sr_idx ON public.stock_return_audit USING btree (stock_return_id);
CREATE INDEX student_fee_events_student_idx ON public.student_fee_events USING btree (student_id, at DESC);
CREATE INDEX idx_student_invoices_enrollment ON public.student_invoices USING btree (enrollment_id);
CREATE INDEX idx_student_invoices_student ON public.student_invoices USING btree (student_id);
CREATE INDEX student_no_class_date_idx ON public.student_no_class USING btree (class_date);
CREATE INDEX idx_student_payments_student ON public.student_payments USING btree (student_id);
CREATE INDEX idx_students_franchisee_id ON public.students USING btree (franchisee_id);
CREATE INDEX transaction_items_transaction_id_idx ON public.transaction_items USING btree (transaction_id);
CREATE INDEX transaction_payments_transaction_id_idx ON public.transaction_payments USING btree (transaction_id);
CREATE UNIQUE INDEX transactions_document_no_key ON public.transactions USING btree (document_no) WHERE (document_no IS NOT NULL);
CREATE INDEX transactions_party_id_idx ON public.transactions USING btree (party_id);
CREATE INDEX transactions_person_id_idx ON public.transactions USING btree (person_id) WHERE (person_id IS NOT NULL);
CREATE INDEX transactions_type_status_idx ON public.transactions USING btree (type, status);
CREATE INDEX idx_users_franchisee_id ON public.users USING btree (franchisee_id);
CREATE INDEX wa_messages_created_idx ON public.whatsapp_messages USING btree (created_at DESC);
CREATE INDEX wa_messages_from_idx ON public.whatsapp_messages USING btree (from_number);

-- ---------------------------------------------------------------------------
-- Functions (a): _coupon_discount .. default_enrollment_fee
-- NOTE admin_change_email and align_user_id_to_auth are in the authentication
-- area (out of scope for this programme). They are reproduced only so the
-- schema is faithful; they are not exercised or modified by Phase 2.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._coupon_discount(p_type text, p_value numeric, p_max integer, p_amount numeric)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(0, LEAST(
    CASE WHEN p_type = 'percent' THEN round(p_amount * p_value / 100.0) ELSE p_value END,
    COALESCE(p_max, 2147483647),
    p_amount
  ))::integer
$function$
;

CREATE OR REPLACE FUNCTION public.admin_change_email(p_old text, p_new text, p_table text, p_row uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_uid uuid;
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_new IS NULL OR p_old IS NULL OR position('@' in p_new) = 0 THEN
    RAISE EXCEPTION 'Invalid email';
  END IF;

  -- New email must not already belong to a different login
  IF EXISTS (SELECT 1 FROM public.users WHERE email ILIKE p_new AND NOT (email ILIKE p_old)) THEN
    RAISE EXCEPTION 'That email is already in use by another account';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email ILIKE p_new AND NOT (email ILIKE p_old)) THEN
    RAISE EXCEPTION 'That email is already in use by another account';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE email ILIKE p_old LIMIT 1;

  IF v_uid IS NOT NULL THEN
    UPDATE auth.users
      SET email = p_new,
          email_confirmed_at = COALESCE(email_confirmed_at, now())
      WHERE id = v_uid;
    UPDATE auth.identities
      SET identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email}', to_jsonb(p_new))
      WHERE user_id = v_uid AND provider = 'email';
    UPDATE public.users SET email = p_new WHERE id = v_uid;
  END IF;

  IF p_table = 'franchisees' AND p_row IS NOT NULL THEN
    UPDATE public.franchisees SET email = p_new WHERE id = p_row;
  ELSIF p_table = 'students' AND p_row IS NOT NULL THEN
    UPDATE public.students SET email = p_new WHERE id = p_row;
  END IF;

  RETURN json_build_object('success', true, 'had_login', v_uid IS NOT NULL);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.align_user_id_to_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_auth uuid;
BEGIN
  SELECT id INTO v_auth FROM auth.users WHERE lower(email) = lower(NEW.email) LIMIT 1;
  IF v_auth IS NOT NULL THEN
    NEW.id := v_auth;   -- align to the auth UID
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_centre_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_stem text; v_n int;
begin
  if NEW.centre_code is null then
    if NEW.tier = 'NLH' then NEW.centre_code := 'HO'; return NEW; end if;
    v_stem := city_code(NEW.city);
    select coalesce(max(nullif(regexp_replace(centre_code, '^[A-Z]+', ''), '')::int), 0) + 1
      into v_n from franchisees where centre_code ~ ('^' || v_stem || '[0-9]+$');
    NEW.centre_code := v_stem || lpad(v_n::text, 2, '0');
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_franchisee_agreement_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int;
begin
  if new.agreement_no is null then
    n := nextval('franchisee_agreement_seq');
    new.agreement_no := 'AGR-HO-' || lpad(n::text, 4, '0');
    new.verification_code := 'NLH-AGR-' || lpad(n::text, 4, '0') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.assign_franchisee_enrollment_invoice_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.enrollment_invoice_no is null then
    new.enrollment_invoice_no := 'FEI-HO-' || lpad(nextval('franchisee_enrollment_invoice_seq')::text, 4, '0');
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.assign_franchisee_receipt_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('FR', 'HO',
                                      extract(year from coalesce(NEW.payment_date, current_date))::int);
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_franchisee_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.users
  SET
    role          = lower(NEW.tier),
    franchisee_id = NEW.id
  WHERE email ILIKE NEW.email;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_item_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.item_code IS NULL OR NEW.item_code = '' THEN
    NEW.item_code := 'ITM-' || lpad(nextval('public.inventory_item_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.assign_order_receipt_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('OR', 'HO',
                                      extract(year from coalesce(NEW.paid_on, current_date))::int);
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_receipt_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.receipt_no IS NULL THEN
    NEW.receipt_no := 'RCP-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('public.receipt_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.assign_student_invoice_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.invoice_no is null then
    NEW.invoice_no := 'SINV-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('public.student_invoice_seq')::text, 4, '0');
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_student_receipt_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('ST', centre_of_student(NEW.student_id),
                                      extract(year from coalesce(NEW.paid_at, current_date))::int);
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.centre_of_student(p_student uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(f.centre_code, 'HO') from students s
  left join franchisees f on f.id = s.franchisee_id where s.id = p_student
$function$
;

CREATE OR REPLACE FUNCTION public.check_franchisee_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_other integer; v_fee integer;
begin
  select coalesce(sum(amount),0) into v_other
    from franchisee_payments where franchisee_id = NEW.franchisee_id and id <> NEW.id;
  select coalesce(enrollment_fee,0) into v_fee from franchisees where id = NEW.franchisee_id;
  if v_fee > 0 and v_other + NEW.amount > v_fee then
    raise exception 'Payment of % would take the total to % against a franchise fee of %',
      NEW.amount, v_other + NEW.amount, v_fee;
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.check_order_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total integer; v_grand integer;
begin
  select coalesce(sum(amount),0) into v_total
  from order_payments where order_id = NEW.order_id and id <> NEW.id;
  select grand_total into v_grand from orders where id = NEW.order_id;
  if v_grand > 0 and v_total + NEW.amount > v_grand then
    raise exception 'Payment of % would take the total to % on an invoice of %',
      NEW.amount, v_total + NEW.amount, v_grand;
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.check_student_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_other integer; v_total integer;
begin
  select coalesce(sum(amount),0) into v_other
  from student_payments where student_id = NEW.student_id and id <> NEW.id;
  select coalesce(fee_total,0) into v_total from students where id = NEW.student_id;
  if v_total > 0 and v_other + NEW.amount > v_total then
    raise exception 'Payment of % would take the total to % against a fee of %',
      NEW.amount, v_other + NEW.amount, v_total;
  end if;
  return NEW;
end $function$
;

CREATE OR REPLACE FUNCTION public.city_code(p_city text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select code from city_codes where lower(city) = lower(trim(p_city))),
    upper(regexp_replace(left(coalesce(nullif(trim(p_city),''),'XXX'), 3), '[^A-Za-z]', 'X', 'g'))
  )
$function$
;

CREATE OR REPLACE FUNCTION public.clear_coupon_redemption(p_context text, p_ref uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cids uuid[];
BEGIN
  IF NOT nlh_is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT array_agg(DISTINCT coupon_id) INTO cids FROM coupon_redemptions WHERE context = p_context AND ref_id = p_ref;
  DELETE FROM coupon_redemptions WHERE context = p_context AND ref_id = p_ref;
  IF cids IS NOT NULL THEN
    UPDATE coupons SET used_count = (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = coupons.id)
    WHERE id = ANY(cids);
  END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.default_enrollment_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_list integer;
begin
  select coalesce(student_fee, 0) into v_list from skus where id = NEW.sku_id;
  if NEW.list_price is null then NEW.list_price := coalesce(v_list, 0); end if;
  if NEW.fee_amount is null then NEW.fee_amount := coalesce(v_list, 0); end if;
  return NEW;
end $function$
;

-- ---------------------------------------------------------------------------
-- Functions (b): export_migrations .. my_franchisee_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_migrations()
 RETURNS TABLE(version text, name text, sql text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'supabase_migrations'
AS $function$
  select version,
         coalesce(name, 'migration'),
         array_to_string(statements, E';\n\n') || E';\n'
  from supabase_migrations.schema_migrations
  order by version
$function$
;

CREATE OR REPLACE FUNCTION public.fee_event_actor()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$ select coalesce(auth.jwt() ->> 'email', 'system') $function$
;

CREATE OR REPLACE FUNCTION public.generate_credit_note_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'approved' and old.status = 'pending' and new.credit_note_no is null then
    new.credit_note_no := 'CN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('credit_note_seq')::text, 4, '0');
    new.approved_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_invoice_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'invoiced' and old.status in ('pending','proforma') and new.invoice_no is null then
    new.invoice_no := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0');
    new.invoiced_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_order_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.order_ref := 'ORD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('order_seq')::text, 4, '0');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_proforma_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'proforma' and old.status = 'pending' and new.proforma_no is null then
    new.proforma_no := 'PF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('proforma_seq')::text, 4, '0');
    new.proforma_generated_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_sale_return_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'approved' and new.return_no is null then
    new.return_no := 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sale_return_seq')::text, 4, '0');
    if new.approved_at is null then
      new.approved_at := now();
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_app_secret(secret_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = secret_name;
  return v;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_descendant_ids(root_id uuid)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH RECURSIVE hierarchy AS (
    -- Seed: direct children of root
    SELECT f.id
    FROM   public.franchisees f
    WHERE  f.parent_id = root_id

    UNION ALL

    -- Recurse: children of each node already in the tree
    SELECT f.id
    FROM   public.franchisees f
    INNER JOIN hierarchy h ON f.parent_id = h.id
  )
  SELECT h.id FROM hierarchy h;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_franchisee_agreement_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (select public.nlh_is_admin()) then
    if old.status = 'signed' then
      raise exception 'This agreement has already been signed and cannot be changed.';
    end if;
    if new.franchisee_id  is distinct from old.franchisee_id
    or new.agreement_no   is distinct from old.agreement_no
    or new.fee             is distinct from old.fee
    or new.term_years      is distinct from old.term_years
    or new.term_start      is distinct from old.term_start
    or new.term_end        is distinct from old.term_end
    or new.courses         is distinct from old.courses
    or new.kit              is distinct from old.kit
    then
      raise exception 'Only NLH staff can edit agreement terms.';
    end if;
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.guard_order_fulfillment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_live boolean;
BEGIN
  IF OLD.fulfilled_by_franchisee_id IS NOT NULL AND NEW.fulfilled_by_franchisee_id IS DISTINCT FROM OLD.fulfilled_by_franchisee_id THEN
    SELECT EXISTS (
      SELECT 1 FROM public.franchisee_stock_returns sr
      WHERE sr.status = 'approved'
        AND (sr.fulfills_order_item_id = OLD.id
             OR (sr.fulfills_order_item_id IS NULL AND sr.fulfills_order_id = OLD.order_id AND sr.sku_id = OLD.sku_id))
    ) INTO v_live;
    IF v_live THEN
      RAISE EXCEPTION 'This line has a live Sale Return crediting a franchisee for it — cancel that return first before changing who fulfilled it.';
    END IF;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.guard_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  IF current_setting('nlh.syncing', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1;

  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  IF
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR
    NEW.invoice_no IS DISTINCT FROM OLD.invoice_no OR
    NEW.invoice_url IS DISTINCT FROM OLD.invoice_url OR
    NEW.invoice_cancelled_at IS DISTINCT FROM OLD.invoice_cancelled_at OR
    NEW.invoice_cancelled_by IS DISTINCT FROM OLD.invoice_cancelled_by OR
    NEW.payment_verified_at IS DISTINCT FROM OLD.payment_verified_at OR
    NEW.courier_partner IS DISTINCT FROM OLD.courier_partner OR
    NEW.awb_number IS DISTINCT FROM OLD.awb_number OR
    NEW.courier_charges IS DISTINCT FROM OLD.courier_charges OR
    NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at OR
    NEW.dispatch_date IS DISTINCT FROM OLD.dispatch_date OR
    NEW.dispatch_weight IS DISTINCT FROM OLD.dispatch_weight OR
    NEW.dispatch_freight IS DISTINCT FROM OLD.dispatch_freight OR
    NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
    NEW.gst_amount IS DISTINCT FROM OLD.gst_amount OR
    NEW.grand_total IS DISTINCT FROM OLD.grand_total OR
    NEW.placer_id IS DISTINCT FROM OLD.placer_id OR
    NEW.placer_tier IS DISTINCT FROM OLD.placer_tier OR
    NEW.supplier IS DISTINCT FROM OLD.supplier OR
    NEW.bill_to_franchisee_id IS DISTINCT FROM OLD.bill_to_franchisee_id OR
    NEW.ship_to_franchisee_id IS DISTINCT FROM OLD.ship_to_franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: only admins can modify order status, amounts, or dispatch details';
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.guard_user_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1;

  -- Admins may update anything
  IF v_role IN ('owner','super_admin','admin','manager','staff') THEN
    RETURN NEW;
  END IF;

  -- Allow first-time franchisee onboarding only:
  --   franchisee_id is being set for the first time (NULL → value)
  --   AND the new role is not an elevated admin role
  IF OLD.franchisee_id IS NULL
     AND NEW.franchisee_id IS NOT NULL
     AND NEW.role NOT IN ('owner','super_admin','admin','manager','staff')
  THEN
    RETURN NEW;
  END IF;

  -- All other role or franchisee_id changes are blocked for non-admins
  IF
    NEW.role           IS DISTINCT FROM OLD.role           OR
    NEW.franchisee_id  IS DISTINCT FROM OLD.franchisee_id
  THEN
    RAISE EXCEPTION 'Permission denied: role and franchisee_id can only be changed by an administrator';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_ho_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('owner','super_admin','admin','manager')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_enrollment_fee_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a text := fee_event_actor();
begin
  if TG_OP = 'INSERT' then
    insert into student_fee_events(student_id, enrollment_id, field, new_value, delta, actor)
    values (NEW.student_id, NEW.id, 'fee_amount', NEW.fee_amount::text, coalesce(NEW.fee_amount,0), a);
    return null;
  end if;
  if NEW.fee_amount is distinct from OLD.fee_amount then
    insert into student_fee_events(student_id, enrollment_id, field, old_value, new_value, delta, actor)
    values (NEW.student_id, NEW.id, 'fee_amount', OLD.fee_amount::text, NEW.fee_amount::text,
            coalesce(NEW.fee_amount,0) - coalesce(OLD.fee_amount,0), a);
  end if;
  if NEW.waived is distinct from OLD.waived then
    insert into student_fee_events(student_id, enrollment_id, field, old_value, new_value, delta, actor)
    values (NEW.student_id, NEW.id, 'waived', OLD.waived::text, NEW.waived::text,
            coalesce(NEW.waived,0) - coalesce(OLD.waived,0), a);
  end if;
  if NEW.status is distinct from OLD.status then
    insert into student_fee_events(student_id, enrollment_id, field, old_value, new_value, actor)
    values (NEW.student_id, NEW.id, 'status', OLD.status, NEW.status, a);
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_order_fulfillment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fulfilled_by_franchisee_id IS DISTINCT FROM OLD.fulfilled_by_franchisee_id THEN
    INSERT INTO public.order_fulfillment_audit (order_item_id, order_id, old_franchisee_id, new_franchisee_id, changed_by)
    VALUES (NEW.id, NEW.order_id, OLD.fulfilled_by_franchisee_id, NEW.fulfilled_by_franchisee_id,
      COALESCE((SELECT email FROM public.users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), auth.jwt() ->> 'email'));
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.log_stock_return_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stock_return_audit (stock_return_id, action, changed_by, detail)
    VALUES (NEW.id, 'created', NEW.requested_by, jsonb_build_object('qty', NEW.qty, 'unit_value', NEW.unit_value, 'total_credit', NEW.total_credit, 'returning_franchisee_id', NEW.returning_franchisee_id));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO public.stock_return_audit (stock_return_id, action, changed_by, detail)
    VALUES (NEW.id, 'cancelled', NEW.cancelled_by, jsonb_build_object('reason', NEW.cancel_reason, 'was_credit', OLD.total_credit));
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.log_student_fee_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a text := fee_event_actor();
begin
  if NEW.fee_total is distinct from OLD.fee_total then
    insert into student_fee_events(student_id, field, old_value, new_value, delta, actor)
    values (NEW.id, 'fee_total', OLD.fee_total::text, NEW.fee_total::text,
            coalesce(NEW.fee_total,0) - coalesce(OLD.fee_total,0), a);
  end if;
  if NEW.other_charges is distinct from OLD.other_charges then
    insert into student_fee_events(student_id, field, old_value, new_value, delta, actor)
    values (NEW.id, 'other_charges', OLD.other_charges::text, NEW.other_charges::text,
            coalesce(NEW.other_charges,0) - coalesce(OLD.other_charges,0), a);
  end if;
  if NEW.waived_amount is distinct from OLD.waived_amount then
    insert into student_fee_events(student_id, field, old_value, new_value, delta, actor)
    values (NEW.id, 'waived_amount', OLD.waived_amount::text, NEW.waived_amount::text,
            coalesce(NEW.waived_amount,0) - coalesce(OLD.waived_amount,0), a);
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_franchisee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT franchisee_id FROM public.users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1 $function$
;

-- ---------------------------------------------------------------------------
-- Functions (c): next_journal_no .. wa_update_status
-- NOTE user_last_signins and users_id_mismatches read auth.users and sit in
-- the authentication area (out of scope; reproduced for fidelity only).
-- NOTE wa_log_outbound embeds the business WhatsApp sender number as a literal;
-- it has been REPLACED here by the placeholder 910000000000 (not a real number).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_journal_no()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  yr text := to_char(CURRENT_DATE, 'YYYY');
  n  int  := nextval('journal_entry_seq');
BEGIN
  RETURN 'JV-' || yr || '-' || LPAD(n::text, 4, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_order_receipt_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN public.next_receipt_no('OR', 'HO', extract(year from now())::int);
END $function$
;

CREATE OR REPLACE FUNCTION public.next_order_ref()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  yr  text := to_char(NOW(), 'YYYY');
  seq int;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(order_ref, '^ORD-\\d{4}-', ''), '')::int
  ), 0) + 1
  INTO seq
  FROM orders
  WHERE order_ref LIKE 'ORD-' || yr || '-%';

  RETURN 'ORD-' || yr || '-' || LPAD(seq::text, 4, '0');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_receipt_no(p_series text, p_centre text, p_year integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_year int := coalesce(p_year, extract(year from now())::int);
        v_centre text := coalesce(nullif(p_centre,''), 'HO');
        v_no int;
begin
  insert into receipt_counters (series, centre_code, year, last_no)
  values (p_series, v_centre, v_year, 1)
  on conflict (series, centre_code, year)
    do update set last_no = receipt_counters.last_no + 1
  returning last_no into v_no;
  return p_series || '-' || v_centre || '-' || v_year || '-' || lpad(v_no::text, 4, '0');
end $function$
;

CREATE OR REPLACE FUNCTION public.next_sale_return_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.nlh_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sale_return_seq')::text, 4, '0');
END $function$
;

CREATE OR REPLACE FUNCTION public.nlh_accessible_franchisee_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE tree AS (
    SELECT id FROM franchisees
    WHERE id = (
      SELECT franchisee_id FROM users
      WHERE email ILIKE (auth.jwt() ->> 'email')
      LIMIT 1
    )
    UNION ALL
    SELECT f.id FROM franchisees f
    INNER JOIN tree t ON f.parent_id = t.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) FROM tree
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role IN ('owner','super_admin','admin','manager','staff')
     FROM users
     WHERE email ILIKE (auth.jwt() ->> 'email')
     LIMIT 1),
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_is_manager_or_above()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT role IN ('owner','super_admin','admin','manager')
     FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1),
    false
  )
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_is_senior()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT role IN ('owner','super_admin','admin') FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), false)
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT role = 'staff' FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1), false)
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_my_franchisee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT franchisee_id
  FROM users
  WHERE email ILIKE (auth.jwt() ->> 'email')
  LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.nlh_staff_can(keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE WHEN u.role <> 'staff' THEN true
      ELSE EXISTS (SELECT 1 FROM unnest(keys) k WHERE COALESCE((u.permissions ->> k)::boolean, false))
    END
    FROM users u WHERE u.email ILIKE (auth.jwt() ->> 'email') LIMIT 1
  ), true)
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_franchisee_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT nlh_is_admin() THEN
    IF NEW.tier               IS DISTINCT FROM OLD.tier               THEN
      RAISE EXCEPTION 'Permission denied: cannot change tier';
    END IF;
    IF NEW.parent_id          IS DISTINCT FROM OLD.parent_id          THEN
      RAISE EXCEPTION 'Permission denied: cannot change parent_id';
    END IF;
    IF NEW.status             IS DISTINCT FROM OLD.status             THEN
      RAISE EXCEPTION 'Permission denied: cannot change status';
    END IF;
    IF NEW.registered_courses IS DISTINCT FROM OLD.registered_courses THEN
      RAISE EXCEPTION 'Permission denied: cannot change registered_courses';
    END IF;
    IF NEW.registered_skus    IS DISTINCT FROM OLD.registered_skus    THEN
      RAISE EXCEPTION 'Permission denied: cannot change registered_skus';
    END IF;
    IF NEW.enrollment_fee     IS DISTINCT FROM OLD.enrollment_fee     THEN
      RAISE EXCEPTION 'Permission denied: cannot change enrollment_fee';
    END IF;
    IF NEW.renewal_fee        IS DISTINCT FROM OLD.renewal_fee        THEN
      RAISE EXCEPTION 'Permission denied: cannot change renewal_fee';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- If caller is not an admin, block changes to sensitive columns
  IF NOT nlh_is_admin() THEN
    IF NEW.role         IS DISTINCT FROM OLD.role         THEN
      RAISE EXCEPTION 'Permission denied: cannot change role';
    END IF;
    IF NEW.franchisee_id IS DISTINCT FROM OLD.franchisee_id THEN
      RAISE EXCEPTION 'Permission denied: cannot change franchisee_id';
    END IF;
    IF NEW.is_active    IS DISTINCT FROM OLD.is_active    THEN
      RAISE EXCEPTION 'Permission denied: cannot change is_active';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_order_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE orders o
  SET
    subtotal    = COALESCE((SELECT SUM(ordered_qty * rate) FROM order_items WHERE order_id = o.id), 0),
    grand_total = COALESCE((SELECT SUM(ordered_qty * rate) FROM order_items WHERE order_id = o.id), 0)
                  + COALESCE(o.courier_charges, 0)
  WHERE o.id = COALESCE(NEW.order_id, OLD.order_id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_order_payment_status(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total  integer;
  v_grand  integer;
  v_status text;
begin
  select coalesce(sum(amount),0) into v_total from order_payments where order_id = p_order_id;
  select grand_total, status into v_grand, v_status from orders where id = p_order_id;
  if v_status not in ('invoiced','part_paid','closed') then return; end if;

  perform set_config('nlh.syncing', 'on', true);
  update orders set
    status = case
      when v_grand > 0 and v_total >= v_grand then 'closed'
      when v_total > 0 then 'part_paid'
      else 'invoiced'
    end,
    payment_verified_at = case
      when v_grand > 0 and v_total >= v_grand then coalesce(payment_verified_at, now())
      else payment_verified_at
    end
  where id = p_order_id;
  perform set_config('nlh.syncing', 'off', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.recompute_student_fee_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student uuid;
  v_paid    integer;
  v_total   integer;
  v_status  text;
  v_active  boolean;
BEGIN
  v_student := COALESCE(NEW.student_id, OLD.student_id);
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.student_payments WHERE student_id = v_student;
  SELECT COALESCE(fee_total, 0), is_active INTO v_total, v_active FROM public.students WHERE id = v_student;

  IF    v_total = 0        THEN v_status := 'none';
  ELSIF v_paid  <= 0       THEN v_status := 'pending';
  ELSIF v_paid  >= v_total THEN v_status := 'paid';
  ELSE  v_status := 'partial';
  END IF;

  -- Only move a live student's status; leave a closed/waived one settled.
  IF v_active = false THEN
    UPDATE public.students SET fee_paid = v_paid WHERE id = v_student;
  ELSE
    UPDATE public.students SET fee_paid = v_paid, payment_status = v_status WHERE id = v_student;
  END IF;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.redeem_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_ref uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.coupons; v jsonb; disc int; uid uuid; existing boolean;
BEGIN
  SELECT * INTO c FROM coupons WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Coupon not found'); END IF;
  SELECT EXISTS (SELECT 1 FROM coupon_redemptions WHERE coupon_id = c.id AND context = p_context AND ref_id = p_ref) INTO existing;
  v := public.validate_coupon(p_code, p_context, p_amount, p_franchisee);
  IF NOT (v->>'valid')::boolean AND NOT existing THEN RETURN v; END IF;
  disc := public._coupon_discount(c.discount_type, c.discount_value, c.max_discount, p_amount);
  uid  := (SELECT id FROM users WHERE email ILIKE (auth.jwt() ->> 'email') LIMIT 1);
  INSERT INTO coupon_redemptions(coupon_id, context, ref_id, order_id, student_id, franchisee_id, base_amount, discount_amount, redeemed_by)
  VALUES (c.id, p_context, p_ref,
          CASE WHEN p_context = 'order'   THEN p_ref END,
          CASE WHEN p_context = 'student' THEN p_ref END,
          p_franchisee, p_amount::int, disc, uid)
  ON CONFLICT (coupon_id, context, ref_id)
  DO UPDATE SET base_amount = EXCLUDED.base_amount, discount_amount = EXCLUDED.discount_amount;
  UPDATE coupons SET used_count = (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = c.id) WHERE id = c.id;
  RETURN jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount', disc);
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_franchisee_fee_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_fr uuid := coalesce(NEW.franchisee_id, OLD.franchisee_id);
begin
  update franchisees
    set fee_paid = coalesce((select sum(amount) from franchisee_payments where franchisee_id = v_fr), 0)
    where id = v_fr;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_order_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order   uuid := coalesce(NEW.order_id, OLD.order_id);
  v_total   integer;
  v_grand   integer;
  v_status  text;
  v_last    record;
begin
  select coalesce(sum(amount),0) into v_total from order_payments where order_id = v_order;
  select grand_total, status into v_grand, v_status from orders where id = v_order;

  select paid_on, mode, reference into v_last
  from order_payments where order_id = v_order
  order by paid_on desc, created_at desc limit 1;

  perform set_config('nlh.syncing', 'on', true);

  -- A proforma order moving into part_paid/closed needs a real invoice
  -- number first — flip it through 'invoiced' in its own statement so
  -- trg_invoice_no's old.status = 'proforma' condition actually fires.
  if v_status = 'proforma' and v_total > 0 then
    update orders set status = 'invoiced' where id = v_order and invoice_no is null;
    v_status := 'invoiced';
  end if;

  update orders set
    amount_paid  = v_total,
    paid_at      = case when v_last.paid_on is not null
                        then v_last.paid_on::timestamptz else null end,
    payment_mode = coalesce(v_last.mode, payment_mode),
    payment_ref  = v_last.reference,
    -- Only move between the payment statuses; never disturb pending/dispatched.
    status = case
      when v_status not in ('invoiced','part_paid','closed') then v_status
      when v_grand > 0 and v_total >= v_grand then 'closed'
      when v_total > 0 then 'part_paid'
      else 'invoiced'
    end,
    payment_verified_at = case
      when v_grand > 0 and v_total >= v_grand then coalesce(payment_verified_at, now())
      else null
    end
  where id = v_order;

  perform set_config('nlh.syncing', 'off', true);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_transaction_payment_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx      uuid := coalesce(new.transaction_id, old.transaction_id);
  v_paid    integer;
  v_type    text;
  v_party   uuid;
  v_status  text;
  v_total   integer;
begin
  select coalesce(sum(amount), 0) into v_paid from transaction_payments where transaction_id = v_tx;
  select type, party_id, status, total into v_type, v_party, v_status, v_total from transactions where id = v_tx;

  if v_type = 'franchise_fee' then
    select coalesce(enrollment_fee, 0) into v_total from franchisees where id = v_party;
  end if;

  update transactions set
    total = v_total,
    amount_paid = v_paid,
    status = case
      when v_status = 'cancelled' then v_status
      when v_total > 0 and v_paid >= v_total then 'paid'
      when v_paid > 0 then 'part_paid'
      else v_status
    end
  where id = v_tx;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transactions_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.user_last_signins()
 RETURNS TABLE(email text, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT au.email, au.last_sign_in_at
  FROM auth.users au
  WHERE public.nlh_is_admin()
$function$
;

CREATE OR REPLACE FUNCTION public.users_guard_privileged_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / dashboard
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.is_active IS DISTINCT FROM OLD.is_active)
     AND NOT (public.nlh_is_senior() OR (public.nlh_is_admin() AND NOT public.nlh_is_staff() AND NEW.role NOT IN ('owner','super_admin','admin') AND OLD.role NOT IN ('owner','super_admin','admin')))
  THEN
    RAISE EXCEPTION 'Not allowed to change role, permissions or active status';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.users_id_mismatches()
 RETURNS TABLE(email text, users_id uuid, auth_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT u.email, u.id, au.id
  FROM public.users u
  JOIN auth.users au ON lower(au.email) = lower(u.email)
  WHERE u.id <> au.id
$function$
;

CREATE OR REPLACE FUNCTION public.validate_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid DEFAULT NULL::uuid, p_exclude_ref uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.coupons; used int; fused int; disc int;
BEGIN
  SELECT * INTO c FROM coupons WHERE code = upper(trim(p_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'message', 'Coupon not found'); END IF;
  IF NOT c.active THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is inactive'); END IF;
  IF c.valid_from  IS NOT NULL AND now() < c.valid_from  THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon is not active yet'); END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN RETURN jsonb_build_object('valid', false, 'message', 'This coupon has expired'); END IF;
  IF c.applies_to <> 'both' AND c.applies_to <> p_context || 's' THEN
     RETURN jsonb_build_object('valid', false, 'message', 'This coupon cannot be used here');
  END IF;
  IF p_amount < COALESCE(c.min_amount, 0) THEN
     RETURN jsonb_build_object('valid', false, 'message', 'Requires a minimum of ' || c.min_amount);
  END IF;
  -- Exclude this ref's own existing redemption so re-applying on the same order/student is allowed
  SELECT count(*) INTO used FROM coupon_redemptions
    WHERE coupon_id = c.id AND (p_exclude_ref IS NULL OR ref_id <> p_exclude_ref);
  IF c.usage_limit IS NOT NULL AND used >= c.usage_limit THEN
     RETURN jsonb_build_object('valid', false, 'message', 'This coupon has reached its usage limit');
  END IF;
  IF c.per_franchisee_limit IS NOT NULL AND p_franchisee IS NOT NULL THEN
     SELECT count(*) INTO fused FROM coupon_redemptions
       WHERE coupon_id = c.id AND franchisee_id = p_franchisee AND (p_exclude_ref IS NULL OR ref_id <> p_exclude_ref);
     IF fused >= c.per_franchisee_limit THEN
        RETURN jsonb_build_object('valid', false, 'message', 'This coupon has already been used');
     END IF;
  END IF;
  disc := public._coupon_discount(c.discount_type, c.discount_value, c.max_discount, p_amount);
  RETURN jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount', disc,
     'discount_type', c.discount_type, 'discount_value', c.discount_value, 'description', c.description);
END $function$
;

CREATE OR REPLACE FUNCTION public.wa_log_outbound(p_to text, p_body text, p_type text DEFAULT 'auto_reply'::text, p_wa_message_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_to is null then return; end if;
  insert into whatsapp_messages (direction, from_number, to_number, message_type, message_body, status, wa_message_id)
  values ('outbound', '910000000000', p_to, coalesce(p_type,'auto_reply'), p_body, 'sent', p_wa_message_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.wa_should_autoreply(p_number text, p_window interval DEFAULT '06:00:00'::interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare recent int;
begin
  if p_number is null then return false; end if;
  select count(*) into recent
    from whatsapp_messages
   where to_number = p_number
     and direction = 'outbound'
     and message_type = 'auto_reply'
     and created_at > now() - p_window;
  return recent = 0;
end $function$
;

CREATE OR REPLACE FUNCTION public.wa_update_status(p_wa_message_id text, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_wa_message_id is null or p_status is null then return; end if;
  update whatsapp_messages set status = p_status where wa_message_id = p_wa_message_id;
  update enrollments   set cert_wa_status = p_status where cert_wa_message_id = p_wa_message_id;
end $function$
;

-- ---------------------------------------------------------------------------
-- Triggers (37, all enabled)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_default_enrollment_fee BEFORE INSERT ON public.enrollments FOR EACH ROW EXECUTE FUNCTION default_enrollment_fee();
CREATE TRIGGER trg_log_enrollment_fee AFTER INSERT OR UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION log_enrollment_fee_change();
CREATE TRIGGER trg_franchisee_agreement_no BEFORE INSERT ON public.franchisee_agreements FOR EACH ROW EXECUTE FUNCTION assign_franchisee_agreement_no();
CREATE TRIGGER trg_guard_franchisee_agreement_update BEFORE UPDATE ON public.franchisee_agreements FOR EACH ROW EXECUTE FUNCTION guard_franchisee_agreement_update();
CREATE TRIGGER trg_credit_note_no BEFORE UPDATE ON public.franchisee_credit_notes FOR EACH ROW EXECUTE FUNCTION generate_credit_note_no();
CREATE TRIGGER trg_check_franchisee_payment BEFORE INSERT OR UPDATE ON public.franchisee_payments FOR EACH ROW EXECUTE FUNCTION check_franchisee_payment_total();
CREATE TRIGGER trg_fr_receipt_no BEFORE INSERT ON public.franchisee_payments FOR EACH ROW EXECUTE FUNCTION assign_franchisee_receipt_no();
CREATE TRIGGER trg_sync_franchisee_fee AFTER INSERT OR DELETE OR UPDATE ON public.franchisee_payments FOR EACH ROW EXECUTE FUNCTION sync_franchisee_fee_paid();
CREATE TRIGGER trg_log_stock_return_insert AFTER INSERT ON public.franchisee_stock_returns FOR EACH ROW EXECUTE FUNCTION log_stock_return_change();
CREATE TRIGGER trg_log_stock_return_update AFTER UPDATE ON public.franchisee_stock_returns FOR EACH ROW EXECUTE FUNCTION log_stock_return_change();
CREATE TRIGGER trg_sale_return_no BEFORE INSERT OR UPDATE ON public.franchisee_stock_returns FOR EACH ROW EXECUTE FUNCTION generate_sale_return_no();
CREATE TRIGGER tr_franchisee_onboarded AFTER INSERT ON public.franchisees FOR EACH ROW EXECUTE FUNCTION assign_franchisee_role();
CREATE TRIGGER trg_centre_code BEFORE INSERT ON public.franchisees FOR EACH ROW EXECUTE FUNCTION assign_centre_code();
CREATE TRIGGER trg_fr_enrollment_invoice_no BEFORE INSERT ON public.franchisees FOR EACH ROW EXECUTE FUNCTION assign_franchisee_enrollment_invoice_no();
CREATE TRIGGER trg_prevent_franchisee_escalation BEFORE UPDATE ON public.franchisees FOR EACH ROW EXECUTE FUNCTION prevent_franchisee_escalation();
CREATE TRIGGER trg_item_code BEFORE INSERT ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION assign_item_code();
CREATE TRIGGER trg_guard_order_fulfillment_change BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION guard_order_fulfillment_change();
CREATE TRIGGER trg_log_order_fulfillment_change AFTER UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION log_order_fulfillment_change();
CREATE TRIGGER trg_order_items_totals AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION recalc_order_totals();
CREATE TRIGGER trg_check_order_payment BEFORE INSERT OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION check_order_payment_total();
CREATE TRIGGER trg_order_receipt_no BEFORE INSERT ON public.order_payments FOR EACH ROW EXECUTE FUNCTION assign_order_receipt_no();
CREATE TRIGGER trg_sync_order_payment AFTER INSERT OR DELETE OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION sync_order_payment_total();
CREATE TRIGGER trg_guard_order_update BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION guard_order_update();
CREATE TRIGGER trg_invoice_no BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION generate_invoice_no();
CREATE TRIGGER trg_order_ref BEFORE INSERT ON public.orders FOR EACH ROW WHEN (((new.order_ref IS NULL) OR (new.order_ref = ''::text))) EXECUTE FUNCTION generate_order_ref();
CREATE TRIGGER trg_proforma_no BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION generate_proforma_no();
CREATE TRIGGER trg_student_invoice_no BEFORE INSERT ON public.student_invoices FOR EACH ROW EXECUTE FUNCTION assign_student_invoice_no();
CREATE TRIGGER tr_recompute_fee_paid AFTER INSERT OR DELETE OR UPDATE ON public.student_payments FOR EACH ROW EXECUTE FUNCTION recompute_student_fee_paid();
CREATE TRIGGER trg_check_student_payment BEFORE INSERT OR UPDATE ON public.student_payments FOR EACH ROW EXECUTE FUNCTION check_student_payment_total();
CREATE TRIGGER trg_receipt_no BEFORE INSERT ON public.student_payments FOR EACH ROW EXECUTE FUNCTION assign_student_receipt_no();
CREATE TRIGGER trg_log_student_fee AFTER UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION log_student_fee_change();
CREATE TRIGGER trg_sync_transaction_payment_total AFTER INSERT OR DELETE OR UPDATE ON public.transaction_payments FOR EACH ROW EXECUTE FUNCTION sync_transaction_payment_total();
CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION transactions_set_updated_at();
CREATE TRIGGER tr_align_user_id BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION align_user_id_to_auth();
CREATE TRIGGER trg_guard_user_update BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION guard_user_update();
CREATE TRIGGER trg_prevent_role_escalation BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();
CREATE TRIGGER trg_users_guard_privileged_cols BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION users_guard_privileged_cols();

-- ---------------------------------------------------------------------------
-- Row level security: enabled on all 62 tables (none forced)
-- ---------------------------------------------------------------------------
alter table public.access_requests enable row level security;
alter table public.accounts enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.batch_sessions enable row level security;
alter table public.batch_students enable row level security;
alter table public.batches enable row level security;
alter table public.cf_commission_terms enable row level security;
alter table public.city_codes enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.coupons enable row level security;
alter table public.courses enable row level security;
alter table public.email_log enable row level security;
alter table public.enrollments enable row level security;
alter table public.expenses enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.franchisee_agreements enable row level security;
alter table public.franchisee_credit_notes enable row level security;
alter table public.franchisee_payments enable row level security;
alter table public.franchisee_stock_returns enable row level security;
alter table public.franchisees enable row level security;
alter table public.gst_config enable row level security;
alter table public.gst_transactions enable row level security;
alter table public.instructor_attendance enable row level security;
alter table public.instructor_courses enable row level security;
alter table public.instructor_payment_items enable row level security;
alter table public.instructor_payments enable row level security;
alter table public.instructors enable row level security;
alter table public.inventory_items enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.kit_items enable row level security;
alter table public.kit_price_history enable row level security;
alter table public.messages enable row level security;
alter table public.order_commission_lines enable row level security;
alter table public.order_fulfillment_audit enable row level security;
alter table public.order_items enable row level security;
alter table public.order_payments enable row level security;
alter table public.orders enable row level security;
alter table public.payroll_extras enable row level security;
alter table public.payroll_overrides enable row level security;
alter table public.receipt_counters enable row level security;
alter table public.revenue_splits enable row level security;
alter table public.school_ci_assignments enable row level security;
alter table public.school_sku_rates enable row level security;
alter table public.session_attendance enable row level security;
alter table public.skus enable row level security;
alter table public.stock_ledger enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_return_audit enable row level security;
alter table public.student_fee_events enable row level security;
alter table public.student_invoices enable row level security;
alter table public.student_no_class enable row level security;
alter table public.student_payments enable row level security;
alter table public.students enable row level security;
alter table public.transaction_items enable row level security;
alter table public.transaction_payments enable row level security;
alter table public.transactions enable row level security;
alter table public.users enable row level security;
alter table public.vendor_transactions enable row level security;
alter table public.vendors enable row level security;
alter table public.whatsapp_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Policies (a): tables a..e  (57)
-- ---------------------------------------------------------------------------
create policy access_requests_select on public.access_requests as permissive for select to authenticated using (nlh_is_admin());
create policy access_requests_update on public.access_requests as permissive for update to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy anyone_can_request on public.access_requests as permissive for insert to public with check (true);
create policy staff_perm_access_requests_select on public.access_requests as restrictive for select to authenticated using ((NOT nlh_is_staff()));
create policy staff_perm_access_requests_update on public.access_requests as restrictive for update to authenticated using ((NOT nlh_is_staff())) with check ((NOT nlh_is_staff()));
create policy ho_admin_only on public.accounts as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy ho_admin_only on public.bank_accounts as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy ho_admin_only on public.bank_transactions as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy batch_sessions_delete on public.batch_sessions as permissive for delete to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM batches b
  WHERE ((b.id = batch_sessions.batch_id) AND (b.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_sessions_insert on public.batch_sessions as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM batches b
  WHERE ((b.id = batch_sessions.batch_id) AND (b.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_sessions_select on public.batch_sessions as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM batches b
  WHERE ((b.id = batch_sessions.batch_id) AND (b.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_sessions_update on public.batch_sessions as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM batches b
  WHERE ((b.id = batch_sessions.batch_id) AND (b.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_batch_sessions on public.batch_sessions as restrictive for delete to authenticated using (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_insert_batch_sessions on public.batch_sessions as restrictive for insert to authenticated with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_select_batch_sessions on public.batch_sessions as restrictive for select to authenticated using (nlh_staff_can('{batches.view}'::text[]));
create policy staff_perm_update_batch_sessions on public.batch_sessions as restrictive for update to authenticated using (nlh_staff_can('{batches.edit}'::text[])) with check (nlh_staff_can('{batches.edit}'::text[]));
create policy batch_students_delete on public.batch_students as permissive for delete to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = batch_students.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_students_insert on public.batch_students as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = batch_students.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_students_select on public.batch_students as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = batch_students.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy batch_students_update on public.batch_students as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = batch_students.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_batch_students on public.batch_students as restrictive for delete to authenticated using (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_insert_batch_students on public.batch_students as restrictive for insert to authenticated with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_select_batch_students on public.batch_students as restrictive for select to authenticated using (nlh_staff_can('{batches.view}'::text[]));
create policy staff_perm_update_batch_students on public.batch_students as restrictive for update to authenticated using (nlh_staff_can('{batches.edit}'::text[])) with check (nlh_staff_can('{batches.edit}'::text[]));
create policy batches_delete on public.batches as permissive for delete to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy batches_insert on public.batches as permissive for insert to authenticated with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy batches_select on public.batches as permissive for select to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy batches_update on public.batches as permissive for update to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_batches on public.batches as restrictive for delete to authenticated using (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_insert_batches on public.batches as restrictive for insert to authenticated with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_select_batches on public.batches as restrictive for select to authenticated using (nlh_staff_can('{batches.view}'::text[]));
create policy staff_perm_update_batches on public.batches as restrictive for update to authenticated using (nlh_staff_can('{batches.edit}'::text[])) with check (nlh_staff_can('{batches.edit}'::text[]));
create policy cft_admin on public.cf_commission_terms as permissive for all to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_cf_terms on public.cf_commission_terms as restrictive for all to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy redemptions_read on public.coupon_redemptions as permissive for select to public using (nlh_is_admin());
create policy staff_perm_select_coupon_redemptions on public.coupon_redemptions as restrictive for select to authenticated using (nlh_staff_can('{coupons.view}'::text[]));
create policy coupons_delete on public.coupons as permissive for delete to public using (nlh_is_manager_or_above());
create policy coupons_read on public.coupons as permissive for select to public using (nlh_is_admin());
create policy coupons_update on public.coupons as permissive for update to public using (nlh_is_manager_or_above());
create policy coupons_write on public.coupons as permissive for insert to public with check (nlh_is_manager_or_above());
create policy staff_perm_select_coupons on public.coupons as restrictive for select to authenticated using (nlh_staff_can('{coupons.view}'::text[]));
create policy courses_write_del on public.courses as permissive for delete to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy courses_write_ins on public.courses as permissive for insert to public with check (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy courses_write_upd on public.courses as permissive for update to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy read_courses on public.courses as permissive for select to public using (true);
create policy email_log_insert on public.email_log as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy email_log_select on public.email_log as permissive for select to public using (nlh_is_admin());
create policy staff_perm_select_email_log on public.email_log as restrictive for select to authenticated using (nlh_staff_can('{email-log.view}'::text[]));
create policy enrollments_delete on public.enrollments as permissive for delete to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy enrollments_insert on public.enrollments as permissive for insert to authenticated with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy enrollments_select on public.enrollments as permissive for select to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy enrollments_update on public.enrollments as permissive for update to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_enrollments on public.enrollments as restrictive for delete to authenticated using (nlh_staff_can('{students.delete}'::text[]));
create policy staff_perm_insert_enrollments on public.enrollments as restrictive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_enrollments on public.enrollments as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_update_enrollments on public.enrollments as restrictive for update to authenticated using (nlh_staff_can('{students.edit,students.complete}'::text[])) with check (nlh_staff_can('{students.edit,students.complete}'::text[]));
create policy ho_admin_only on public.expenses as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());

-- ---------------------------------------------------------------------------
-- Policies (b): tables f..n  (98)
-- NOTE: the four staff_perm_*_instructor_attendance policies are PERMISSIVE in
-- production (every other staff_perm_* table uses RESTRICTIVE). Reproduced
-- exactly; see docs/phase-1/security-permissions-audit.md finding S-10.
-- ---------------------------------------------------------------------------
create policy ho_admin_only on public.fiscal_years as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy fa_delete on public.franchisee_agreements as permissive for delete to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy fa_insert on public.franchisee_agreements as permissive for insert to public with check (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy fa_select on public.franchisee_agreements as permissive for select to public using ((( SELECT nlh_is_admin() AS nlh_is_admin) OR (franchisee_id = ( SELECT my_franchisee_id() AS my_franchisee_id))));
create policy fa_update on public.franchisee_agreements as permissive for update to public using ((( SELECT nlh_is_admin() AS nlh_is_admin) OR (franchisee_id = ( SELECT my_franchisee_id() AS my_franchisee_id))));
create policy staff_perm_delete_franchisee_agreements on public.franchisee_agreements as restrictive for delete to authenticated using (nlh_staff_can('{franchisees.delete}'::text[]));
create policy staff_perm_insert_franchisee_agreements on public.franchisee_agreements as restrictive for insert to authenticated with check (nlh_staff_can('{franchisees.edit}'::text[]));
create policy staff_perm_select_franchisee_agreements on public.franchisee_agreements as restrictive for select to authenticated using (nlh_staff_can('{franchisees.view}'::text[]));
create policy staff_perm_update_franchisee_agreements on public.franchisee_agreements as restrictive for update to authenticated using (nlh_staff_can('{franchisees.edit}'::text[])) with check (nlh_staff_can('{franchisees.edit}'::text[]));
create policy credit_notes_select on public.franchisee_credit_notes as permissive for select to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy credit_notes_write on public.franchisee_credit_notes as permissive for all to public using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_delete_franchisee_credit_notes on public.franchisee_credit_notes as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_franchisee_credit_notes on public.franchisee_credit_notes as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_franchisee_credit_notes on public.franchisee_credit_notes as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_franchisee_credit_notes on public.franchisee_credit_notes as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy fp_select on public.franchisee_payments as permissive for select to public using ((( SELECT nlh_is_admin() AS nlh_is_admin) OR (franchisee_id = ( SELECT my_franchisee_id() AS my_franchisee_id))));
create policy fp_write_del on public.franchisee_payments as permissive for delete to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy fp_write_ins on public.franchisee_payments as permissive for insert to public with check (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy fp_write_upd on public.franchisee_payments as permissive for update to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy staff_perm_delete_franchisee_payments on public.franchisee_payments as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_franchisee_payments on public.franchisee_payments as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_franchisee_payments on public.franchisee_payments as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_franchisee_payments on public.franchisee_payments as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_delete_franchisee_stock_returns on public.franchisee_stock_returns as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_franchisee_stock_returns on public.franchisee_stock_returns as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_franchisee_stock_returns on public.franchisee_stock_returns as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_franchisee_stock_returns on public.franchisee_stock_returns as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy stock_returns_select on public.franchisee_stock_returns as permissive for select to public using ((nlh_is_admin() OR (returning_franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy stock_returns_write on public.franchisee_stock_returns as permissive for all to public using (nlh_is_admin()) with check (nlh_is_admin());
create policy franchisees_delete on public.franchisees as permissive for delete to authenticated using (nlh_is_admin());
create policy franchisees_insert on public.franchisees as permissive for insert to authenticated with check (nlh_is_admin());
create policy franchisees_select on public.franchisees as permissive for select to authenticated using ((nlh_is_admin() OR (id = ANY (nlh_accessible_franchisee_ids()))));
create policy franchisees_update on public.franchisees as permissive for update to authenticated using ((nlh_is_admin() OR (id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_franchisees on public.franchisees as restrictive for delete to authenticated using (nlh_staff_can('{franchisees.delete}'::text[]));
create policy staff_perm_insert_franchisees on public.franchisees as restrictive for insert to authenticated with check (nlh_staff_can('{franchisees.edit}'::text[]));
create policy staff_perm_select_franchisees on public.franchisees as restrictive for select to authenticated using (nlh_staff_can('{franchisees.view}'::text[]));
create policy staff_perm_update_franchisees on public.franchisees as restrictive for update to authenticated using (nlh_staff_can('{franchisees.edit}'::text[])) with check (nlh_staff_can('{franchisees.edit}'::text[]));
create policy ho_admin_only on public.gst_config as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy ho_admin_only on public.gst_transactions as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy instructor_attendance_delete on public.instructor_attendance as permissive for delete to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_attendance.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_attendance_insert on public.instructor_attendance as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_attendance.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_attendance_select on public.instructor_attendance as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_attendance.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_attendance_update on public.instructor_attendance as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_attendance.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_instructor_attendance on public.instructor_attendance as permissive for delete to authenticated using (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_insert_instructor_attendance on public.instructor_attendance as permissive for insert to authenticated with check (nlh_staff_can('{batches.edit}'::text[]));
create policy staff_perm_select_instructor_attendance on public.instructor_attendance as permissive for select to authenticated using (nlh_staff_can('{batches.view}'::text[]));
create policy staff_perm_update_instructor_attendance on public.instructor_attendance as permissive for update to authenticated using (nlh_staff_can('{batches.edit}'::text[])) with check (nlh_staff_can('{batches.edit}'::text[]));
create policy instructor_courses_delete on public.instructor_courses as permissive for delete to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_courses.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_courses_insert on public.instructor_courses as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_courses.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_courses_select on public.instructor_courses as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_courses.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_courses_update on public.instructor_courses as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructors i
  WHERE ((i.id = instructor_courses.instructor_id) AND (i.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_instructor_courses on public.instructor_courses as restrictive for delete to authenticated using (nlh_staff_can('{instructors.edit}'::text[]));
create policy staff_perm_insert_instructor_courses on public.instructor_courses as restrictive for insert to authenticated with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy staff_perm_select_instructor_courses on public.instructor_courses as restrictive for select to authenticated using (nlh_staff_can('{instructors.view}'::text[]));
create policy staff_perm_update_instructor_courses on public.instructor_courses as restrictive for update to authenticated using (nlh_staff_can('{instructors.edit}'::text[])) with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy instructor_payment_items_insert on public.instructor_payment_items as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructor_payments ip
  WHERE ((ip.id = instructor_payment_items.payment_id) AND (ip.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_payment_items_select on public.instructor_payment_items as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructor_payments ip
  WHERE ((ip.id = instructor_payment_items.payment_id) AND (ip.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy instructor_payment_items_update on public.instructor_payment_items as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM instructor_payments ip
  WHERE ((ip.id = instructor_payment_items.payment_id) AND (ip.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_insert_instructor_payment_items on public.instructor_payment_items as restrictive for insert to authenticated with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy staff_perm_select_instructor_payment_items on public.instructor_payment_items as restrictive for select to authenticated using (nlh_staff_can('{instructors.view}'::text[]));
create policy staff_perm_update_instructor_payment_items on public.instructor_payment_items as restrictive for update to authenticated using (nlh_staff_can('{instructors.edit}'::text[])) with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy instructor_payments_insert on public.instructor_payments as permissive for insert to authenticated with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy instructor_payments_select on public.instructor_payments as permissive for select to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy instructor_payments_update on public.instructor_payments as permissive for update to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_insert_instructor_payments on public.instructor_payments as restrictive for insert to authenticated with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy staff_perm_select_instructor_payments on public.instructor_payments as restrictive for select to authenticated using (nlh_staff_can('{instructors.view}'::text[]));
create policy staff_perm_update_instructor_payments on public.instructor_payments as restrictive for update to authenticated using (nlh_staff_can('{instructors.edit}'::text[])) with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy instructors_delete on public.instructors as permissive for delete to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy instructors_insert on public.instructors as permissive for insert to authenticated with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy instructors_select on public.instructors as permissive for select to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy instructors_update on public.instructors as permissive for update to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_instructors on public.instructors as restrictive for delete to authenticated using (nlh_staff_can('{instructors.delete}'::text[]));
create policy staff_perm_insert_instructors on public.instructors as restrictive for insert to authenticated with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy staff_perm_select_instructors on public.instructors as restrictive for select to authenticated using (nlh_staff_can('{instructors.view}'::text[]));
create policy staff_perm_update_instructors on public.instructors as restrictive for update to authenticated using (nlh_staff_can('{instructors.edit}'::text[])) with check (nlh_staff_can('{instructors.edit}'::text[]));
create policy inv_items_del on public.inventory_items as permissive for delete to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy inv_items_ins on public.inventory_items as permissive for insert to public with check (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy inv_items_read on public.inventory_items as permissive for select to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy inv_items_upd on public.inventory_items as permissive for update to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy staff_perm_select_inventory_items on public.inventory_items as restrictive for select to authenticated using (nlh_staff_can('{inventory.view}'::text[]));
create policy ho_admin_only on public.journal_entries as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy ho_admin_only on public.journal_lines as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy kit_items_del on public.kit_items as permissive for delete to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy kit_items_ins on public.kit_items as permissive for insert to public with check (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy kit_items_read on public.kit_items as permissive for select to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy kit_items_upd on public.kit_items as permissive for update to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy staff_perm_select_kit_items on public.kit_items as restrictive for select to authenticated using (nlh_staff_can('{inventory.view}'::text[]));
create policy kit_price_history_all on public.kit_price_history as permissive for all to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_delete_kit_price_history on public.kit_price_history as restrictive for delete to authenticated using (nlh_staff_can('{prices.edit}'::text[]));
create policy staff_perm_insert_kit_price_history on public.kit_price_history as restrictive for insert to authenticated with check (nlh_staff_can('{prices.edit}'::text[]));
create policy staff_perm_select_kit_price_history on public.kit_price_history as restrictive for select to authenticated using (nlh_staff_can('{prices.view}'::text[]));
create policy staff_perm_update_kit_price_history on public.kit_price_history as restrictive for update to authenticated using (nlh_staff_can('{prices.edit}'::text[])) with check (nlh_staff_can('{prices.edit}'::text[]));
create policy messages_insert on public.messages as permissive for insert to public with check ((nlh_is_admin() OR (franchisee_id = my_franchisee_id())));
create policy messages_select on public.messages as permissive for select to public using ((nlh_is_admin() OR (franchisee_id = my_franchisee_id())));
create policy messages_update on public.messages as permissive for update to public using ((nlh_is_admin() OR (franchisee_id = my_franchisee_id())));
create policy staff_perm_insert_messages on public.messages as restrictive for insert to authenticated with check (nlh_staff_can('{messages.reply}'::text[]));
create policy staff_perm_select_messages on public.messages as restrictive for select to authenticated using (nlh_staff_can('{messages.view}'::text[]));
create policy staff_perm_update_messages on public.messages as restrictive for update to authenticated using (nlh_staff_can('{messages.view}'::text[])) with check (nlh_staff_can('{messages.view}'::text[]));

-- ---------------------------------------------------------------------------
-- Policies (c): tables o..r  (45)
-- NOTE: the four staff_perm_*_payroll_extras policies are PERMISSIVE in
-- production (other staff_perm_* policies are RESTRICTIVE). Reproduced
-- exactly; see docs/phase-1/security-permissions-audit.md finding S-10.
-- ---------------------------------------------------------------------------
create policy ocl_admin on public.order_commission_lines as permissive for all to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_order_commission on public.order_commission_lines as restrictive for all to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy ofa_admin_select on public.order_fulfillment_audit as permissive for select to authenticated using (nlh_is_admin());
create policy staff_perm_select_order_fulfillment_audit on public.order_fulfillment_audit as restrictive for select to authenticated using (nlh_staff_can('{orders.view}'::text[]));
create policy order_items_delete on public.order_items as permissive for delete to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.placer_id = ANY (nlh_accessible_franchisee_ids())) OR (o.bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))))))));
create policy order_items_insert on public.order_items as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.placer_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy order_items_select on public.order_items as permissive for select to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.placer_id = ANY (nlh_accessible_franchisee_ids())) OR (o.bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))))))));
create policy order_items_update on public.order_items as permissive for update to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND ((o.placer_id = ANY (nlh_accessible_franchisee_ids())) OR (o.bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))))))));
create policy staff_perm_delete_order_items on public.order_items as restrictive for delete to authenticated using (nlh_staff_can('{orders.edit}'::text[]));
create policy staff_perm_insert_order_items on public.order_items as restrictive for insert to authenticated with check (nlh_staff_can('{orders.edit}'::text[]));
create policy staff_perm_select_order_items on public.order_items as restrictive for select to authenticated using (nlh_staff_can('{orders.view}'::text[]));
create policy staff_perm_update_order_items on public.order_items as restrictive for update to authenticated using (nlh_staff_can('{orders.edit,orders.invoice,orders.dispatch}'::text[])) with check (nlh_staff_can('{orders.edit,orders.invoice,orders.dispatch}'::text[]));
create policy order_payments_delete on public.order_payments as permissive for delete to public using (nlh_is_admin());
create policy order_payments_insert on public.order_payments as permissive for insert to public with check (nlh_is_admin());
create policy order_payments_select on public.order_payments as permissive for select to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_payments.order_id) AND ((o.placer_id = ANY (nlh_accessible_franchisee_ids())) OR (o.bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))))))));
create policy order_payments_update on public.order_payments as permissive for update to public using (nlh_is_admin());
create policy staff_perm_delete_order_payments on public.order_payments as restrictive for delete to authenticated using (nlh_staff_can('{orders.payments}'::text[]));
create policy staff_perm_insert_order_payments on public.order_payments as restrictive for insert to authenticated with check (nlh_staff_can('{orders.payments}'::text[]));
create policy staff_perm_select_order_payments on public.order_payments as restrictive for select to authenticated using (nlh_staff_can('{orders.view}'::text[]));
create policy staff_perm_update_order_payments on public.order_payments as restrictive for update to authenticated using (nlh_staff_can('{orders.payments}'::text[])) with check (nlh_staff_can('{orders.payments}'::text[]));
create policy orders_delete on public.orders as permissive for delete to public using ((nlh_is_admin() AND (status = 'proforma'::text) AND (invoice_no IS NULL)));
create policy orders_insert on public.orders as permissive for insert to authenticated with check ((nlh_is_admin() OR (placer_id = ANY (nlh_accessible_franchisee_ids()))));
create policy orders_select on public.orders as permissive for select to public using ((nlh_is_admin() OR (placer_id = ANY (nlh_accessible_franchisee_ids())) OR (bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy orders_update on public.orders as permissive for update to public using ((nlh_is_admin() OR (placer_id = ANY (nlh_accessible_franchisee_ids())) OR (bill_to_franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_orders on public.orders as restrictive for delete to authenticated using (nlh_staff_can('{orders.delete}'::text[]));
create policy staff_perm_insert_orders on public.orders as restrictive for insert to authenticated with check (nlh_staff_can('{orders.edit}'::text[]));
create policy staff_perm_select_orders on public.orders as restrictive for select to authenticated using (nlh_staff_can('{orders.view}'::text[]));
create policy staff_perm_update_orders on public.orders as restrictive for update to authenticated using (nlh_staff_can('{orders.edit,orders.invoice,orders.payments,orders.dispatch}'::text[])) with check (nlh_staff_can('{orders.edit,orders.invoice,orders.payments,orders.dispatch}'::text[]));
create policy payroll_extras_delete on public.payroll_extras as permissive for delete to public using (nlh_is_admin());
create policy payroll_extras_insert on public.payroll_extras as permissive for insert to public with check (nlh_is_admin());
create policy payroll_extras_select on public.payroll_extras as permissive for select to public using (nlh_is_admin());
create policy payroll_extras_update on public.payroll_extras as permissive for update to public using (nlh_is_admin());
create policy staff_perm_delete_payroll_extras on public.payroll_extras as permissive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_payroll_extras on public.payroll_extras as permissive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_payroll_extras on public.payroll_extras as permissive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_payroll_extras on public.payroll_extras as permissive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy payroll_overrides_delete on public.payroll_overrides as permissive for delete to public using (nlh_is_admin());
create policy payroll_overrides_insert on public.payroll_overrides as permissive for insert to public with check (nlh_is_admin());
create policy payroll_overrides_select on public.payroll_overrides as permissive for select to public using (nlh_is_admin());
create policy payroll_overrides_update on public.payroll_overrides as permissive for update to public using (nlh_is_admin());
create policy staff_perm_delete_payroll_overrides on public.payroll_overrides as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_payroll_overrides on public.payroll_overrides as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_payroll_overrides on public.payroll_overrides as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_payroll_overrides on public.payroll_overrides as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy ho_admin_only on public.revenue_splits as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());

-- ---------------------------------------------------------------------------
-- Policies (d): tables s..z  (105)
-- NOTE: the three staff_perm_*_student_no_class policies are PERMISSIVE in
-- production (see S-10 in docs/phase-1/security-permissions-audit.md).
-- ---------------------------------------------------------------------------
create policy sci_select on public.school_ci_assignments as permissive for select to authenticated using ((nlh_is_admin() OR (school_id = ANY (nlh_accessible_franchisee_ids()))));
create policy sci_write on public.school_ci_assignments as permissive for all to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_select_school_ci on public.school_ci_assignments as restrictive for select to authenticated using (nlh_staff_can('{franchisees.view}'::text[]));
create policy staff_perm_write_school_ci on public.school_ci_assignments as restrictive for all to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy school_sku_rates_select on public.school_sku_rates as permissive for select to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy school_sku_rates_write on public.school_sku_rates as permissive for all to public using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_delete_school_sku_rates on public.school_sku_rates as restrictive for delete to authenticated using (nlh_staff_can('{prices.edit}'::text[]));
create policy staff_perm_insert_school_sku_rates on public.school_sku_rates as restrictive for insert to authenticated with check (nlh_staff_can('{prices.edit}'::text[]));
create policy staff_perm_select_school_sku_rates on public.school_sku_rates as restrictive for select to authenticated using (nlh_staff_can('{courses.view}'::text[]));
create policy staff_perm_update_school_sku_rates on public.school_sku_rates as restrictive for update to authenticated using (nlh_staff_can('{prices.edit}'::text[])) with check (nlh_staff_can('{prices.edit}'::text[]));
create policy session_attendance_delete on public.session_attendance as permissive for delete to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = session_attendance.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy session_attendance_insert on public.session_attendance as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = session_attendance.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy session_attendance_select on public.session_attendance as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = session_attendance.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy session_attendance_update on public.session_attendance as permissive for update to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = session_attendance.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_session_attendance on public.session_attendance as restrictive for delete to authenticated using (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_insert_session_attendance on public.session_attendance as restrictive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_session_attendance on public.session_attendance as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_update_session_attendance on public.session_attendance as restrictive for update to authenticated using (nlh_staff_can('{students.edit}'::text[])) with check (nlh_staff_can('{students.edit}'::text[]));
create policy read_skus on public.skus as permissive for select to public using (true);
create policy skus_write_del on public.skus as permissive for delete to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy skus_write_ins on public.skus as permissive for insert to public with check (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy skus_write_upd on public.skus as permissive for update to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy staff_perm_insert_stock_ledger on public.stock_ledger as restrictive for insert to authenticated with check (nlh_staff_can('{inventory.edit}'::text[]));
create policy staff_perm_select_stock_ledger on public.stock_ledger as restrictive for select to authenticated using (nlh_staff_can('{inventory.view}'::text[]));
create policy staff_perm_update_stock_ledger on public.stock_ledger as restrictive for update to authenticated using (nlh_staff_can('{inventory.edit}'::text[])) with check (nlh_staff_can('{inventory.edit}'::text[]));
create policy stock_del on public.stock_ledger as permissive for delete to public using (( SELECT nlh_is_manager_or_above() AS nlh_is_manager_or_above));
create policy stock_ins on public.stock_ledger as permissive for insert to public with check (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy stock_read on public.stock_ledger as permissive for select to public using (( SELECT nlh_is_admin() AS nlh_is_admin));
create policy stock_upd on public.stock_ledger as permissive for update to public using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_delete_stock_movements on public.stock_movements as restrictive for delete to authenticated using (nlh_staff_can('{inventory.edit}'::text[]));
create policy staff_perm_insert_stock_movements on public.stock_movements as restrictive for insert to authenticated with check (nlh_staff_can('{inventory.edit}'::text[]));
create policy staff_perm_select_stock_movements on public.stock_movements as restrictive for select to authenticated using (nlh_staff_can('{inventory.view}'::text[]));
create policy staff_perm_update_stock_movements on public.stock_movements as restrictive for update to authenticated using (nlh_staff_can('{inventory.edit}'::text[])) with check (nlh_staff_can('{inventory.edit}'::text[]));
create policy stock_movements_all on public.stock_movements as permissive for all to authenticated using (nlh_is_admin()) with check (nlh_is_admin());
create policy sra_admin_select on public.stock_return_audit as permissive for select to authenticated using (nlh_is_admin());
create policy staff_perm_select_stock_return_audit on public.stock_return_audit as restrictive for select to authenticated using (nlh_staff_can('{inventory.view}'::text[]));
create policy staff_perm_select_student_fee_events on public.student_fee_events as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy student_fee_events_select on public.student_fee_events as permissive for select to public using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = student_fee_events.student_id) AND (s.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_student_invoices on public.student_invoices as restrictive for delete to authenticated using (nlh_staff_can('{students.delete}'::text[]));
create policy staff_perm_insert_student_invoices on public.student_invoices as restrictive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_student_invoices on public.student_invoices as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_update_student_invoices on public.student_invoices as restrictive for update to authenticated using (nlh_staff_can('{students.edit}'::text[])) with check (nlh_staff_can('{students.edit}'::text[]));
create policy student_invoices_delete on public.student_invoices as permissive for delete to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_invoices_insert on public.student_invoices as permissive for insert to public with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_invoices_select on public.student_invoices as permissive for select to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_invoices_update on public.student_invoices as permissive for update to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_student_no_class on public.student_no_class as permissive for delete to authenticated using (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_insert_student_no_class on public.student_no_class as permissive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_student_no_class on public.student_no_class as permissive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy student_no_class_delete on public.student_no_class as permissive for delete to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = student_no_class.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy student_no_class_insert on public.student_no_class as permissive for insert to authenticated with check ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = student_no_class.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy student_no_class_select on public.student_no_class as permissive for select to authenticated using ((nlh_is_admin() OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.id = student_no_class.enrollment_id) AND (e.franchisee_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_student_payments on public.student_payments as restrictive for delete to authenticated using (nlh_staff_can('{students.delete}'::text[]));
create policy staff_perm_insert_student_payments on public.student_payments as restrictive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_student_payments on public.student_payments as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_update_student_payments on public.student_payments as restrictive for update to authenticated using (nlh_staff_can('{students.edit}'::text[])) with check (nlh_staff_can('{students.edit}'::text[]));
create policy student_payments_delete on public.student_payments as permissive for delete to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_payments_insert on public.student_payments as permissive for insert to public with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_payments_select on public.student_payments as permissive for select to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy student_payments_update on public.student_payments as permissive for update to public using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_students on public.students as restrictive for delete to authenticated using (nlh_staff_can('{students.delete}'::text[]));
create policy staff_perm_insert_students on public.students as restrictive for insert to authenticated with check (nlh_staff_can('{students.edit}'::text[]));
create policy staff_perm_select_students on public.students as restrictive for select to authenticated using (nlh_staff_can('{students.view}'::text[]));
create policy staff_perm_update_students on public.students as restrictive for update to authenticated using (nlh_staff_can('{students.edit,students.complete}'::text[])) with check (nlh_staff_can('{students.edit,students.complete}'::text[]));
create policy students_delete on public.students as permissive for delete to authenticated using (nlh_is_admin());
create policy students_insert on public.students as permissive for insert to authenticated with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy students_select on public.students as permissive for select to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy students_update on public.students as permissive for update to authenticated using ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (franchisee_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_delete_transaction_items on public.transaction_items as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_transaction_items on public.transaction_items as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_transaction_items on public.transaction_items as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_transaction_items on public.transaction_items as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy transaction_items_delete on public.transaction_items as permissive for delete to public using (nlh_is_admin());
create policy transaction_items_insert on public.transaction_items as permissive for insert to public with check ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_items.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy transaction_items_select on public.transaction_items as permissive for select to public using ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_items.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy transaction_items_update on public.transaction_items as permissive for update to public using ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_items.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids()))))))) with check ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_items.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy staff_perm_delete_transaction_payments on public.transaction_payments as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_transaction_payments on public.transaction_payments as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_transaction_payments on public.transaction_payments as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_transaction_payments on public.transaction_payments as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy transaction_payments_delete on public.transaction_payments as permissive for delete to public using (nlh_is_admin());
create policy transaction_payments_insert on public.transaction_payments as permissive for insert to public with check ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_payments.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy transaction_payments_select on public.transaction_payments as permissive for select to public using ((EXISTS ( SELECT 1
   FROM transactions t
  WHERE ((t.id = transaction_payments.transaction_id) AND (nlh_is_admin() OR (t.party_id = ANY (nlh_accessible_franchisee_ids())))))));
create policy transaction_payments_update on public.transaction_payments as permissive for update to public using (nlh_is_admin()) with check (nlh_is_admin());
create policy staff_perm_delete_transactions on public.transactions as restrictive for delete to authenticated using (nlh_staff_can('{accounting.delete}'::text[]));
create policy staff_perm_insert_transactions on public.transactions as restrictive for insert to authenticated with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy staff_perm_select_transactions on public.transactions as restrictive for select to authenticated using (nlh_staff_can('{accounting.view}'::text[]));
create policy staff_perm_update_transactions on public.transactions as restrictive for update to authenticated using (nlh_staff_can('{accounting.edit}'::text[])) with check (nlh_staff_can('{accounting.edit}'::text[]));
create policy transactions_delete on public.transactions as permissive for delete to public using ((nlh_is_admin() AND (status = 'draft'::text)));
create policy transactions_insert on public.transactions as permissive for insert to public with check ((nlh_is_admin() OR (party_id = ANY (nlh_accessible_franchisee_ids()))));
create policy transactions_select on public.transactions as permissive for select to public using ((nlh_is_admin() OR (party_id = ANY (nlh_accessible_franchisee_ids()))));
create policy transactions_update on public.transactions as permissive for update to public using ((nlh_is_admin() OR (party_id = ANY (nlh_accessible_franchisee_ids())))) with check ((nlh_is_admin() OR (party_id = ANY (nlh_accessible_franchisee_ids()))));
create policy staff_perm_users_delete on public.users as restrictive for delete to authenticated using ((NOT nlh_is_staff()));
create policy staff_perm_users_insert on public.users as restrictive for insert to authenticated with check ((NOT nlh_is_staff()));
create policy staff_perm_users_select on public.users as restrictive for select to authenticated using (((NOT nlh_is_staff()) OR (email ~~* (auth.jwt() ->> 'email'::text))));
create policy staff_perm_users_update on public.users as restrictive for update to authenticated using (((NOT nlh_is_staff()) OR (email ~~* (auth.jwt() ->> 'email'::text)))) with check (((NOT nlh_is_staff()) OR (email ~~* (auth.jwt() ->> 'email'::text))));
create policy users_delete on public.users as permissive for delete to authenticated using (nlh_is_admin());
create policy users_insert on public.users as permissive for insert to authenticated with check (nlh_is_admin());
create policy users_select on public.users as permissive for select to authenticated using ((nlh_is_admin() OR (email ~~* (auth.jwt() ->> 'email'::text))));
create policy users_update on public.users as permissive for update to authenticated using ((nlh_is_admin() OR (email ~~* (auth.jwt() ->> 'email'::text)))) with check ((nlh_is_admin() OR (email ~~* (auth.jwt() ->> 'email'::text))));
create policy ho_admin_only on public.vendor_transactions as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy ho_admin_only on public.vendors as permissive for all to authenticated using (is_ho_admin()) with check (is_ho_admin());
create policy admins_all on public.whatsapp_messages as permissive for all to public using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.email ~~* (auth.jwt() ->> 'email'::text)) AND (users.role = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text, 'manager'::text, 'staff'::text]))))));
create policy wa_outbound_insert on public.whatsapp_messages as permissive for insert to authenticated with check ((direction = 'outbound'::text));
create policy webhook_insert on public.whatsapp_messages as permissive for insert to anon with check ((direction = 'inbound'::text));

-- ---------------------------------------------------------------------------
-- Privileges
-- Tables and sequences: in production anon, authenticated, service_role (and
-- postgres) hold ALL privileges on every public table and sequence (Supabase
-- default privileges). Reproduced explicitly.
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- Functions: explicit EXECUTE grants exactly as in production (68 functions).
revoke all on function public._coupon_discount(p_type text, p_value numeric, p_max integer, p_amount numeric) from public, anon, authenticated, service_role;
grant execute on function public._coupon_discount(p_type text, p_value numeric, p_max integer, p_amount numeric) to public, anon, authenticated, service_role;
revoke all on function public.admin_change_email(p_old text, p_new text, p_table text, p_row uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_change_email(p_old text, p_new text, p_table text, p_row uuid) to authenticated, service_role;
revoke all on function public.align_user_id_to_auth() from public, anon, authenticated, service_role;
grant execute on function public.align_user_id_to_auth() to service_role;
revoke all on function public.assign_centre_code() from public, anon, authenticated, service_role;
grant execute on function public.assign_centre_code() to public, anon, authenticated, service_role;
revoke all on function public.assign_franchisee_agreement_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_franchisee_agreement_no() to public, anon, authenticated, service_role;
revoke all on function public.assign_franchisee_enrollment_invoice_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_franchisee_enrollment_invoice_no() to public, anon, authenticated, service_role;
revoke all on function public.assign_franchisee_receipt_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_franchisee_receipt_no() to public, anon, authenticated, service_role;
revoke all on function public.assign_franchisee_role() from public, anon, authenticated, service_role;
grant execute on function public.assign_franchisee_role() to service_role;
revoke all on function public.assign_item_code() from public, anon, authenticated, service_role;
grant execute on function public.assign_item_code() to service_role;
revoke all on function public.assign_order_receipt_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_order_receipt_no() to public, anon, authenticated, service_role;
revoke all on function public.assign_receipt_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_receipt_no() to service_role;
revoke all on function public.assign_student_invoice_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_student_invoice_no() to public, anon, authenticated, service_role;
revoke all on function public.assign_student_receipt_no() from public, anon, authenticated, service_role;
grant execute on function public.assign_student_receipt_no() to public, anon, authenticated, service_role;
revoke all on function public.centre_of_student(p_student uuid) from public, anon, authenticated, service_role;
grant execute on function public.centre_of_student(p_student uuid) to public, anon, authenticated, service_role;
revoke all on function public.check_franchisee_payment_total() from public, anon, authenticated, service_role;
grant execute on function public.check_franchisee_payment_total() to public, anon, authenticated, service_role;
revoke all on function public.check_order_payment_total() from public, anon, authenticated, service_role;
grant execute on function public.check_order_payment_total() to public, anon, authenticated, service_role;
revoke all on function public.check_student_payment_total() from public, anon, authenticated, service_role;
grant execute on function public.check_student_payment_total() to public, anon, authenticated, service_role;
revoke all on function public.city_code(p_city text) from public, anon, authenticated, service_role;
grant execute on function public.city_code(p_city text) to public, anon, authenticated, service_role;
revoke all on function public.clear_coupon_redemption(p_context text, p_ref uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_coupon_redemption(p_context text, p_ref uuid) to authenticated, service_role;
revoke all on function public.default_enrollment_fee() from public, anon, authenticated, service_role;
grant execute on function public.default_enrollment_fee() to public, anon, authenticated, service_role;
revoke all on function public.export_migrations() from public, anon, authenticated, service_role;
grant execute on function public.export_migrations() to service_role;
revoke all on function public.fee_event_actor() from public, anon, authenticated, service_role;
grant execute on function public.fee_event_actor() to public, anon, authenticated, service_role;
revoke all on function public.generate_credit_note_no() from public, anon, authenticated, service_role;
grant execute on function public.generate_credit_note_no() to public, anon, authenticated, service_role;
revoke all on function public.generate_invoice_no() from public, anon, authenticated, service_role;
grant execute on function public.generate_invoice_no() to service_role;
revoke all on function public.generate_order_ref() from public, anon, authenticated, service_role;
grant execute on function public.generate_order_ref() to service_role;
revoke all on function public.generate_proforma_no() from public, anon, authenticated, service_role;
grant execute on function public.generate_proforma_no() to public, anon, authenticated, service_role;
revoke all on function public.generate_sale_return_no() from public, anon, authenticated, service_role;
grant execute on function public.generate_sale_return_no() to public, anon, authenticated, service_role;
revoke all on function public.get_app_secret(secret_name text) from public, anon, authenticated, service_role;
grant execute on function public.get_app_secret(secret_name text) to service_role;
revoke all on function public.get_descendant_ids(root_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_descendant_ids(root_id uuid) to authenticated, service_role;
revoke all on function public.guard_franchisee_agreement_update() from public, anon, authenticated, service_role;
grant execute on function public.guard_franchisee_agreement_update() to public, anon, authenticated, service_role;
revoke all on function public.guard_order_fulfillment_change() from public, anon, authenticated, service_role;
grant execute on function public.guard_order_fulfillment_change() to public, anon, authenticated, service_role;
revoke all on function public.guard_order_update() from public, anon, authenticated, service_role;
grant execute on function public.guard_order_update() to service_role;
revoke all on function public.guard_user_update() from public, anon, authenticated, service_role;
grant execute on function public.guard_user_update() to service_role;
revoke all on function public.is_ho_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_ho_admin() to authenticated, service_role;
revoke all on function public.log_enrollment_fee_change() from public, anon, authenticated, service_role;
grant execute on function public.log_enrollment_fee_change() to public, anon, authenticated, service_role;
revoke all on function public.log_order_fulfillment_change() from public, anon, authenticated, service_role;
grant execute on function public.log_order_fulfillment_change() to public, anon, authenticated, service_role;
revoke all on function public.log_stock_return_change() from public, anon, authenticated, service_role;
grant execute on function public.log_stock_return_change() to public, anon, authenticated, service_role;
revoke all on function public.log_student_fee_change() from public, anon, authenticated, service_role;
grant execute on function public.log_student_fee_change() to public, anon, authenticated, service_role;
revoke all on function public.my_franchisee_id() from public, anon, authenticated, service_role;
grant execute on function public.my_franchisee_id() to authenticated, service_role;
revoke all on function public.next_journal_no() from public, anon, authenticated, service_role;
grant execute on function public.next_journal_no() to public, anon, authenticated, service_role;
revoke all on function public.next_order_receipt_no() from public, anon, authenticated, service_role;
grant execute on function public.next_order_receipt_no() to public, anon, authenticated, service_role;
revoke all on function public.next_order_ref() from public, anon, authenticated, service_role;
grant execute on function public.next_order_ref() to public, anon, authenticated, service_role;
revoke all on function public.next_receipt_no(p_series text, p_centre text, p_year integer) from public, anon, authenticated, service_role;
grant execute on function public.next_receipt_no(p_series text, p_centre text, p_year integer) to public, anon, authenticated, service_role;
revoke all on function public.next_sale_return_no() from public, anon, authenticated, service_role;
grant execute on function public.next_sale_return_no() to public, anon, authenticated, service_role;
revoke all on function public.nlh_accessible_franchisee_ids() from public, anon, authenticated, service_role;
grant execute on function public.nlh_accessible_franchisee_ids() to authenticated, service_role;
revoke all on function public.nlh_is_admin() from public, anon, authenticated, service_role;
grant execute on function public.nlh_is_admin() to authenticated, service_role;
revoke all on function public.nlh_is_manager_or_above() from public, anon, authenticated, service_role;
grant execute on function public.nlh_is_manager_or_above() to authenticated, service_role;
revoke all on function public.nlh_is_senior() from public, anon, authenticated, service_role;
grant execute on function public.nlh_is_senior() to public, anon, authenticated, service_role;
revoke all on function public.nlh_is_staff() from public, anon, authenticated, service_role;
grant execute on function public.nlh_is_staff() to public, anon, authenticated, service_role;
revoke all on function public.nlh_my_franchisee_id() from public, anon, authenticated, service_role;
grant execute on function public.nlh_my_franchisee_id() to authenticated, service_role;
revoke all on function public.nlh_staff_can(keys text[]) from public, anon, authenticated, service_role;
grant execute on function public.nlh_staff_can(keys text[]) to public, anon, authenticated, service_role;
revoke all on function public.prevent_franchisee_escalation() from public, anon, authenticated, service_role;
grant execute on function public.prevent_franchisee_escalation() to service_role;
revoke all on function public.prevent_role_escalation() from public, anon, authenticated, service_role;
grant execute on function public.prevent_role_escalation() to service_role;
revoke all on function public.recalc_order_totals() from public, anon, authenticated, service_role;
grant execute on function public.recalc_order_totals() to service_role;
revoke all on function public.recompute_order_payment_status(p_order_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.recompute_order_payment_status(p_order_id uuid) to public, anon, authenticated, service_role;
revoke all on function public.recompute_student_fee_paid() from public, anon, authenticated, service_role;
grant execute on function public.recompute_student_fee_paid() to service_role;
revoke all on function public.redeem_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_ref uuid) from public, anon, authenticated, service_role;
grant execute on function public.redeem_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_ref uuid) to authenticated, service_role;
revoke all on function public.sync_franchisee_fee_paid() from public, anon, authenticated, service_role;
grant execute on function public.sync_franchisee_fee_paid() to public, anon, authenticated, service_role;
revoke all on function public.sync_order_payment_total() from public, anon, authenticated, service_role;
grant execute on function public.sync_order_payment_total() to public, anon, authenticated, service_role;
revoke all on function public.sync_transaction_payment_total() from public, anon, authenticated, service_role;
grant execute on function public.sync_transaction_payment_total() to public, anon, authenticated, service_role;
revoke all on function public.transactions_set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.transactions_set_updated_at() to public, anon, authenticated, service_role;
revoke all on function public.user_last_signins() from public, anon, authenticated, service_role;
grant execute on function public.user_last_signins() to authenticated, service_role;
revoke all on function public.users_guard_privileged_cols() from public, anon, authenticated, service_role;
grant execute on function public.users_guard_privileged_cols() to public, anon, authenticated, service_role;
revoke all on function public.users_id_mismatches() from public, anon, authenticated, service_role;
grant execute on function public.users_id_mismatches() to authenticated, service_role;
revoke all on function public.validate_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_exclude_ref uuid) from public, anon, authenticated, service_role;
grant execute on function public.validate_coupon(p_code text, p_context text, p_amount numeric, p_franchisee uuid, p_exclude_ref uuid) to authenticated, service_role;
revoke all on function public.wa_log_outbound(p_to text, p_body text, p_type text, p_wa_message_id text) from public, anon, authenticated, service_role;
grant execute on function public.wa_log_outbound(p_to text, p_body text, p_type text, p_wa_message_id text) to anon, authenticated, service_role;
revoke all on function public.wa_should_autoreply(p_number text, p_window interval) from public, anon, authenticated, service_role;
grant execute on function public.wa_should_autoreply(p_number text, p_window interval) to anon, authenticated, service_role;
revoke all on function public.wa_update_status(p_wa_message_id text, p_status text) from public, anon, authenticated, service_role;
grant execute on function public.wa_update_status(p_wa_message_id text, p_status text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: one public bucket and three object policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', true, null, null)
on conflict (id) do nothing;

create policy chat_attach_select on storage.objects as permissive for select to authenticated using (((bucket_id = 'chat-attachments'::text) AND nlh_is_admin()));
create policy chat_attach_update on storage.objects as permissive for update to authenticated using ((bucket_id = 'chat-attachments'::text)) with check ((bucket_id = 'chat-attachments'::text));
create policy chat_attach_upload on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'chat-attachments'::text));
