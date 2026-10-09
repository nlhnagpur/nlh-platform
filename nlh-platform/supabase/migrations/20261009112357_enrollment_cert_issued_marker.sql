-- A completed course's certificate can be handed over outside the system
-- (printed and given at the centre, or issued before certificate sending
-- existed). cert_emailed_at / cert_wa_sent_at only record sends made through
-- the app, so those enrolments sat in "Needs attention" forever. This marker
-- records "certificate issued" without pretending it was emailed/WhatsApped.

alter table enrollments
  add column cert_issued_at timestamptz,
  add column cert_issued_by text,
  add column cert_issued_note text;
