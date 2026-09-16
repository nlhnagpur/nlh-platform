-- School-only marks-submit → HO-certify gate. Only tier='SCHOOL'
-- franchisees go through this: when a school marks a course complete it
-- must submit marks first, which puts the enrollment in cert_status
-- 'pending_review' — the certificate (StudentCertModal) is unavailable
-- until an admin reviews the marks and either certifies it or rejects it
-- back to the school with a note to fix and resubmit. Regular franchisee
-- tiers (UF/CF/SMF) never touch these columns — completing a course there
-- keeps making the certificate available immediately, same as before.
alter table enrollments add column marks_obtained numeric;
alter table enrollments add column marks_total numeric;
alter table enrollments add column marks_remarks text;
alter table enrollments add column marks_submitted_at timestamptz;
alter table enrollments add column marks_submitted_by text;
alter table enrollments add column cert_status text; -- null | 'pending_review' | 'certified' | 'rejected'
alter table enrollments add column cert_reviewed_at timestamptz;
alter table enrollments add column cert_reviewed_by text;
alter table enrollments add column cert_reject_note text;
