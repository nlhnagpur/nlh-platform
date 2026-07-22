-- Recode every centre onto the station-code scheme. HO stays HO.
update franchisees set centre_code = null;

with coded as (
  select id, 'HO' as code from franchisees where tier = 'NLH'
  union all
  select id, city_code(city) ||
         lpad((row_number() over (partition by city_code(city) order by created_at, id))::text, 2, '0')
  from franchisees where tier <> 'NLH'
)
update franchisees f set centre_code = c.code from coded c where f.id = c.id;

-- New centres pick up their code automatically from the same lookup.
create or replace function assign_centre_code() returns trigger
language plpgsql security definer set search_path = public as $$
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
end $$;
