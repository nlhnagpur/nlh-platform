-- One row per instalment received against an order. orders.amount_paid becomes
-- a derived total kept in sync by trigger, so it can no longer drift or be
-- double-counted, and a wrong entry can be deleted instead of needing SQL.
create table if not exists order_payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  amount       integer not null check (amount > 0),
  paid_on      date not null default current_date,
  mode         text not null default 'upi'
                 check (mode = any (array['upi','neft','cash','cheque','razorpay','other'])),
  reference    text,
  note         text,
  recorded_by  text,
  created_at   timestamptz not null default now()
);

create index if not exists order_payments_order_idx on order_payments(order_id, paid_on desc);

-- ── keep orders.amount_paid / paid_at / status in step ───────────────────────
create or replace function sync_order_payment_total() returns trigger
language plpgsql security definer set search_path = public as $$
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

  -- Let the update through guard_order_update: this is a derived write, not a
  -- user editing amounts by hand.
  perform set_config('nlh.syncing', 'on', true);

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
end $$;

drop trigger if exists trg_sync_order_payment on order_payments;
create trigger trg_sync_order_payment
  after insert or update or delete on order_payments
  for each row execute function sync_order_payment_total();

-- ── never let instalments exceed the invoice ─────────────────────────────────
create or replace function check_order_payment_total() returns trigger
language plpgsql security definer set search_path = public as $$
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
end $$;

drop trigger if exists trg_check_order_payment on order_payments;
create trigger trg_check_order_payment
  before insert or update on order_payments
  for each row execute function check_order_payment_total();
