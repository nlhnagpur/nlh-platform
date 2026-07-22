-- Short, stable code per centre, used in receipt numbers: ST-NAG01-2026-0001.
alter table franchisees add column if not exists centre_code text unique;

-- HO is just 'HO'; everyone else is 3 letters of city + a serial within that
-- city, oldest first, so codes stay stable as new centres are added.
with coded as (
  select id, 'HO' as code from franchisees where tier = 'NLH'
  union all
  select id,
         upper(regexp_replace(left(coalesce(nullif(trim(city),''),'XXX'), 3), '[^A-Za-z]', 'X', 'g'))
         || lpad((row_number() over (partition by upper(left(coalesce(nullif(trim(city),''),'XXX'),3))
                                     order by created_at, id))::text, 2, '0')
  from franchisees where tier <> 'NLH'
)
update franchisees f set centre_code = c.code from coded c
where f.id = c.id and f.centre_code is null;

-- Every centre must have one from here on.
create or replace function assign_centre_code() returns trigger
language plpgsql as $$
declare v_stem text; v_n int;
begin
  if NEW.centre_code is null then
    if NEW.tier = 'NLH' then NEW.centre_code := 'HO'; return NEW; end if;
    v_stem := upper(regexp_replace(left(coalesce(nullif(trim(NEW.city),''),'XXX'),3),'[^A-Za-z]','X','g'));
    select coalesce(max(substring(centre_code from '[0-9]+$')::int),0) + 1 into v_n
    from franchisees where centre_code like v_stem || '%';
    NEW.centre_code := v_stem || lpad(v_n::text, 2, '0');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_centre_code on franchisees;
create trigger trg_centre_code before insert on franchisees
  for each row execute function assign_centre_code();
