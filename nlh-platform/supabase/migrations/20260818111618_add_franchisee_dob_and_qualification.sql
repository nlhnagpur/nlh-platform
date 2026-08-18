-- DOB and qualification were being collected on the public Request Access
-- form but only ever folded into a free-text notes string on approval
-- ("DOB: 1990-10-05 · Qualification: BA BEd · ...") — never a real column,
-- so nowhere in the admin UI could actually show them again. Real columns
-- so they're queryable and editable like every other franchisee field.
alter table franchisees add column if not exists date_of_birth date;
alter table franchisees add column if not exists qualification text;

-- Backfill every existing franchisee whose notes carry these from an
-- approved access request.
update franchisees
set date_of_birth = to_date(substring(notes from 'DOB: ([0-9]{4}-[0-9]{2}-[0-9]{2})'), 'YYYY-MM-DD')
where date_of_birth is null
  and notes ~ 'DOB: [0-9]{4}-[0-9]{2}-[0-9]{2}';

update franchisees
set qualification = trim(substring(notes from 'Qualification: (.*?)( · |$)'))
where qualification is null
  and notes ~ 'Qualification: ';
