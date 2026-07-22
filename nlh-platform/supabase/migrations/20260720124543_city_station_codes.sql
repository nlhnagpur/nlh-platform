-- Indian Railways station codes as the city identifier in centre codes and
-- receipt numbers. Kept as a table, not hard-coded, so ops can add a city when
-- a centre opens somewhere new without a migration.
create table if not exists city_codes (
  city      text primary key,
  code      text not null,
  station   text,
  note      text
);

insert into city_codes (city, code, station, note) values
  ('Ahmedabad',  'ADI',  'Ahmedabad Junction',        null),
  ('Bengaluru',  'SBC',  'KSR Bengaluru City Jn',     null),
  ('Berhampur',  'BAM',  'Brahmapur',                 null),
  ('Chennai',    'MAS',  'Chennai Central',           null),
  ('Faridabad',  'FDB',  'Faridabad',                 null),
  ('Hinganghat', 'HGT',  'Hinganghat',                null),
  ('Hyderabad',  'HYB',  'Hyderabad Deccan',          null),
  ('Karimganj',  'KXJ',  'Karimganj Junction',        null),
  ('Lucknow',    'LKO',  'Lucknow Charbagh',          null),
  ('Mumbai',     'BCT',  'Mumbai Central',            null),
  ('Nagpur',     'NGP',  'Nagpur Junction',           null),
  ('Satara',     'STR',  'Satara',                    null),
  -- These three have no clean 3-letter station code; nearest sensible 3-char form.
  ('Bharuch',    'BRC',  'Bharuch Junction (BH)',     'Station code is 2 letters (BH); BRC used for a uniform 3-char width'),
  ('Cuddalore',  'CUD',  'Cuddalore Port Jn (CUPJ)',  'Station code is 4 letters (CUPJ); shortened to CUD'),
  ('Indore',     'IDR',  'Indore Junction (INDB)',    'Station code is 4 letters (INDB); IDR used for a uniform 3-char width')
on conflict (city) do update
  set code = excluded.code, station = excluded.station, note = excluded.note;

-- Resolve a city to its 3-char code, falling back to the first 3 letters so a
-- new centre never blocks on a missing lookup row.
create or replace function city_code(p_city text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select code from city_codes where lower(city) = lower(trim(p_city))),
    upper(regexp_replace(left(coalesce(nullif(trim(p_city),''),'XXX'), 3), '[^A-Za-z]', 'X', 'g'))
  )
$$;
