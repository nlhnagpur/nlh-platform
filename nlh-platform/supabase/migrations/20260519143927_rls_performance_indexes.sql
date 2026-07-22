
-- These columns are hit on every RLS check — index them all
CREATE INDEX IF NOT EXISTS idx_students_franchisee_id        ON students(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_franchisee_id     ON enrollments(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_batches_franchisee_id         ON batches(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_instructors_franchisee_id     ON instructors(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payments_fr_id     ON instructor_payments(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_orders_placer_id              ON orders(placer_id);
CREATE INDEX IF NOT EXISTS idx_franchisees_parent_id         ON franchisees(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_franchisee_id           ON users(franchisee_id);
CREATE INDEX IF NOT EXISTS idx_batch_students_enrollment_id  ON batch_students(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_batch_sessions_batch_id       ON batch_sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_session_attendance_enr_id     ON session_attendance(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sessions_batch_id             ON sessions(batch_id);
CREATE INDEX IF NOT EXISTS idx_instructor_courses_instr_id   ON instructor_courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id          ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_instr_pay_items_payment_id    ON instructor_payment_items(payment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id    ON notifications(recipient_id);
