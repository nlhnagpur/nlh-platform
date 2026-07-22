alter table student_invoices add column if not exists enrollment_id uuid references enrollments(id) on delete set null;
create index if not exists idx_student_invoices_enrollment on student_invoices(enrollment_id);
