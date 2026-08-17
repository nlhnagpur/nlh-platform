-- Unit Franchise Agreement — a signable legal document per franchisee,
-- generated from the same live data as the enrollment invoice/certificate
-- (registered_courses + skus.uf_rate), so nothing is hand-typed twice.
-- Snapshotted at generation time (fee/courses/kit) so a later fee change
-- or re-registration never silently rewrites an already-signed contract.

create sequence if not exists franchisee_agreement_seq start 1;

create table franchisee_agreements (
  id              uuid        primary key default gen_random_uuid(),
  franchisee_id   uuid        not null references franchisees(id) on delete cascade,
  agreement_no    text        unique,
  fee             integer     not null,
  term_years      integer     not null default 3,
  term_start      date        not null,
  term_end        date        not null,
  courses         jsonb       not null default '[]'::jsonb,   -- snapshot: ["Art and Craft", …]
  kit             jsonb       not null default '[]'::jsonb,   -- snapshot: [{course, level, rate}]
  status          text        not null default 'draft' check (status in ('draft','sent','signed')),
  generated_at    timestamptz not null default now(),
  generated_by    text,       -- email of admin who generated it
  verification_code text      not null,
  -- clickwrap e-signature: typed legal name + explicit consent, tied to the
  -- authenticated franchisee login, IP and a hash of the terms they agreed
  -- to — the combination that makes this enforceable without needing
  -- DocuSign-grade PKI for an internal franchise contract.
  signed_at       timestamptz,
  signed_name     text,
  signed_ip       text,
  doc_hash        text
);

create index franchisee_agreements_franchisee_idx on franchisee_agreements(franchisee_id);

create or replace function assign_franchisee_agreement_no()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create trigger trg_franchisee_agreement_no
  before insert on franchisee_agreements
  for each row execute function assign_franchisee_agreement_no();

-- Once signed, only NLH staff (not the trigger's own security-definer
-- privilege, and not the franchisee) can touch the row again — protects
-- the executed record the same way order status='closed' is protected.
create or replace function guard_franchisee_agreement_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

create trigger trg_guard_franchisee_agreement_update
  before update on franchisee_agreements
  for each row execute function guard_franchisee_agreement_update();

alter table franchisee_agreements enable row level security;

create policy fa_select ON franchisee_agreements for select
  using ((select public.nlh_is_admin()) or franchisee_id = (select public.my_franchisee_id()));

create policy fa_insert ON franchisee_agreements for insert
  with check ((select public.nlh_is_admin()));

-- Franchisees may update their own row (to sign it) — the trigger above
-- is what actually stops them changing anything but the signature fields.
create policy fa_update ON franchisee_agreements for update
  using ((select public.nlh_is_admin()) or franchisee_id = (select public.my_franchisee_id()));

create policy fa_delete ON franchisee_agreements for delete
  using ((select public.nlh_is_admin()));
