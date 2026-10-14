-- ============================================================================
-- Branch-only scenario tests — Phase 2, Stage 0 (NOT EXECUTED; prepared).
--
-- !! ISOLATED DATABASE ONLY. These statements WRITE (insert payments). !!
-- Run only after synthetic_seed.sql has loaded into a Supabase branch / local
-- Postgres. The guard below refuses to run if non-synthetic students exist.
--
-- They document CURRENT behaviour; Stage 4 changes the expected outcomes
-- (marked "TODAY" vs "AFTER STAGE 4").
-- ============================================================================
do $guard$
begin
  if exists (select 1 from public.students where coalesce(notes, '') not like 'SYNTHETIC%') then
    raise exception 'Refusing to run: non-synthetic students exist - this looks like a real database.';
  end if;
end $guard$;

-- ----------------------------------------------------------------------------
-- T1  Duplicate payment (S11: fee 4000, already paid 4000)
-- TODAY: rejected by trg_check_student_payment (cap) -> exception, row not stored
-- ----------------------------------------------------------------------------
do $t$
declare sid uuid; cid uuid; ok boolean := false;
begin
  select id, franchisee_id into sid, cid from public.students where notes like 'SYNTHETIC S11%';
  begin
    insert into public.student_payments (student_id, franchisee_id, amount, mode, paid_at, note)
    values (sid, cid, 4000, 'upi', date '2026-09-01', 'SYNTHETIC duplicate attempt');
    ok := true;
  exception when others then
    raise notice 'T1 duplicate rejected as expected: %', sqlerrm;
  end;
  if ok then raise exception 'T1 FAILED: duplicate payment was accepted'; end if;
end $t$;

-- ----------------------------------------------------------------------------
-- T2  Payment on a zero-fee account (S13)  — finding F5
-- TODAY: ACCEPTED (cap is skipped when fee_total = 0)
-- AFTER STAGE 4: must be rejected (or require an explicit advance/credit type)
-- ----------------------------------------------------------------------------
do $t$
declare sid uuid; cid uuid; n int;
begin
  select id, franchisee_id into sid, cid from public.students where notes like 'SYNTHETIC S13%';
  insert into public.student_payments (student_id, franchisee_id, amount, mode, paid_at, note)
  values (sid, cid, 100, 'cash', date '2026-09-05', 'SYNTHETIC zero-fee payment');
  select count(*) into n from public.student_payments where student_id = sid;
  raise notice 'T2 (TODAY expected: accepted). payments on zero-fee student = %', n;
end $t$;

-- ----------------------------------------------------------------------------
-- T3  Fee reduced below paid (S16) — finding F4
-- The seed already did this (fee 6000 -> 3000 after 4000 paid). Observe:
-- ----------------------------------------------------------------------------
select s.notes, s.fee_total, s.fee_paid, s.payment_status,
       s.fee_paid - s.fee_total as overpaid_by
from public.students s
where s.notes like 'SYNTHETIC S16%';
-- TODAY: accepted silently (overpaid_by = 1000).
-- AFTER STAGE 4: the UPDATE of fee_total below fee_paid must be rejected unless
--   an explicit adjustment/refund row is created (needs business answer Q6).

-- ----------------------------------------------------------------------------
-- T4  Two CONCURRENT payments at the cap (S12: fee 6000, paid 3000) — finding F5
-- Cannot be done in one session. Use two sessions, A and B:
--
--   A: begin;
--      insert into public.student_payments (student_id, franchisee_id, amount, mode, paid_at)
--      select id, franchisee_id, 3000, 'cash', date '2026-09-06'
--      from public.students where notes like 'SYNTHETIC S12%';
--   B: begin;
--      insert into public.student_payments (student_id, franchisee_id, amount, mode, paid_at)
--      select id, franchisee_id, 3000, 'upi',  date '2026-09-06'
--      from public.students where notes like 'SYNTHETIC S12%';
--   A: commit;
--   B: commit;
--
-- TODAY (expected): BOTH commit. The cap trigger reads only COMMITTED rows
--   and takes no lock, so each sees 3000 already paid and passes.
--   Result: fee_paid = 9000 against fee_total = 6000.
-- AFTER STAGE 4 (expected): B blocks on the row lock and then fails; exactly
--   one of the two payments is stored.
--
-- Verify afterwards:
select s.fee_total, s.fee_paid,
       (select count(*) from public.student_payments p where p.student_id = s.id) as payments
from public.students s where s.notes like 'SYNTHETIC S12%';

-- ----------------------------------------------------------------------------
-- T5  Receipt numbering under concurrency
-- next_receipt_no uses INSERT ... ON CONFLICT DO UPDATE on receipt_counters,
-- which takes a row lock, so concurrent receipts for one centre/year must
-- receive distinct, gap-free numbers. Run T4 and confirm:
-- ----------------------------------------------------------------------------
select receipt_no, count(*) from public.student_payments
group by receipt_no having count(*) > 1;   -- expected: no rows
