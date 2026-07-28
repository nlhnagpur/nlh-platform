-- Every change to a student's fee — the agreed total, a per-course fee, a
-- discount, a waiver, other charges, a status flip — recorded with who and
-- when. Payments already have their own ledger; this covers the CHANGES that
-- previously left no trail, so "why is this ₹X" is a query, not SQL archaeology.
create table if not exists student_fee_events (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  enrollment_id uuid references enrollments(id) on delete set null,
  field         text not null,          -- fee_total | other_charges | waived_amount | fee_amount | waived | status
  old_value     text,
  new_value     text,
  delta         integer,                -- signed change for numeric fields
  actor         text,                   -- signed-in user's email, or 'system'
  at            timestamptz not null default now()
);
create index if not exists student_fee_events_student_idx on student_fee_events(student_id, at desc);

-- Who is making the change, from the request JWT; 'system' for backend/trigger.
create or replace function fee_event_actor() returns text
language sql stable as $$ select coalesce(auth.jwt() ->> 'email', 'system') $$;

-- ── students: log agreed-fee, other-charges and waiver-record changes ────────
create or replace function log_student_fee_change() returns trigger
language plpgsql security definer set search_path = public as $$
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
end $$;

drop trigger if exists trg_log_student_fee on students;
create trigger trg_log_student_fee after update on students
  for each row execute function log_student_fee_change();

-- ── enrollments: log per-course fee, waiver and status changes + new courses ─
create or replace function log_enrollment_fee_change() returns trigger
language plpgsql security definer set search_path = public as $$
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
end $$;

drop trigger if exists trg_log_enrollment_fee on enrollments;
create trigger trg_log_enrollment_fee after insert or update on enrollments
  for each row execute function log_enrollment_fee_change();

-- ── RLS: same visibility as the student; audit rows are read-only to clients ──
alter table student_fee_events enable row level security;
create policy student_fee_events_select on student_fee_events for select using (
  nlh_is_admin() or exists (
    select 1 from students s where s.id = student_fee_events.student_id
      and s.franchisee_id = any (nlh_accessible_franchisee_ids())
  )
);
