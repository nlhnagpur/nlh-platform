-- Three receipt series, each numbered per centre so a centre's own run is
-- gapless: ST-NAG01-2026-0001 (student fees), FR-HO-2026-0001 (franchisee
-- enrolment), OR-HO-2026-0001 (order / kit payments).
create table if not exists receipt_counters (
  series      text not null,
  centre_code text not null,
  year        int  not null,
  last_no     int  not null default 0,
  primary key (series, centre_code, year)
);

-- Atomic: the upsert takes a row lock, so concurrent receipts can't collide.
create or replace function next_receipt_no(p_series text, p_centre text, p_year int default null)
returns text language plpgsql security definer set search_path = public as $$
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
end $$;

-- ── which centre issues each kind of receipt ─────────────────────────────────
-- Student fees: the centre the student belongs to.
create or replace function centre_of_student(p_student uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(f.centre_code, 'HO') from students s
  left join franchisees f on f.id = s.franchisee_id where s.id = p_student
$$;

-- Franchise enrolment fees and kit/order payments are collected by HO today.
-- When a CF starts supplying its own UFs, point these at the supplying centre.
create or replace function assign_student_receipt_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('ST', centre_of_student(NEW.student_id),
                                      extract(year from coalesce(NEW.paid_at, current_date))::int);
  end if;
  return NEW;
end $$;

create or replace function assign_franchisee_receipt_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('FR', 'HO',
                                      extract(year from coalesce(NEW.payment_date, current_date))::int);
  end if;
  return NEW;
end $$;

create or replace function assign_order_receipt_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.receipt_no is null then
    NEW.receipt_no := next_receipt_no('OR', 'HO',
                                      extract(year from coalesce(NEW.paid_on, current_date))::int);
  end if;
  return NEW;
end $$;

alter table franchisee_payments add column if not exists receipt_no text unique;

drop trigger if exists trg_receipt_no on student_payments;
create trigger trg_receipt_no before insert on student_payments
  for each row execute function assign_student_receipt_no();

drop trigger if exists trg_fr_receipt_no on franchisee_payments;
create trigger trg_fr_receipt_no before insert on franchisee_payments
  for each row execute function assign_franchisee_receipt_no();

drop trigger if exists trg_order_receipt_no on order_payments;
create trigger trg_order_receipt_no before insert on order_payments
  for each row execute function assign_order_receipt_no();
