
-- ══════════════════════════════════════════════════════════════
-- 1. TABLES ALREADY HAVING RLS — fix policies from public → authenticated
-- ══════════════════════════════════════════════════════════════

-- access_requests
DROP POLICY IF EXISTS admin_update_requests ON access_requests;
DROP POLICY IF EXISTS read_own_request      ON access_requests;
-- keep: anyone_can_request (INSERT) stays public so the landing-page form works
CREATE POLICY auth_update_requests ON access_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_read_requests ON access_requests
  FOR SELECT TO authenticated USING (true);

-- enrollments
DROP POLICY IF EXISTS read_write_enrollments ON enrollments;
CREATE POLICY auth_all_enrollments ON enrollments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- fee_transactions
DROP POLICY IF EXISTS read_write_fee_tx ON fee_transactions;
CREATE POLICY auth_all_fee_transactions ON fee_transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- franchisees
DROP POLICY IF EXISTS read_write_franchisees ON franchisees;
CREATE POLICY auth_all_franchisees ON franchisees
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- kit_price_history
DROP POLICY IF EXISTS read_write_kit_history ON kit_price_history;
CREATE POLICY auth_all_kit_price_history ON kit_price_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- notifications
DROP POLICY IF EXISTS read_write_notifications ON notifications;
CREATE POLICY auth_all_notifications ON notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- order_items
DROP POLICY IF EXISTS read_write_order_items ON order_items;
CREATE POLICY auth_all_order_items ON order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- orders
DROP POLICY IF EXISTS read_write_orders ON orders;
CREATE POLICY auth_all_orders ON orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- skus (keep SELECT public for catalog lookups; lock writes to authenticated)
DROP POLICY IF EXISTS admin_all_skus ON skus;
DROP POLICY IF EXISTS update_skus     ON skus;
CREATE POLICY auth_write_skus ON skus
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- stock_movements
DROP POLICY IF EXISTS read_write_stock ON stock_movements;
CREATE POLICY auth_all_stock_movements ON stock_movements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- students
DROP POLICY IF EXISTS read_write_students ON students;
CREATE POLICY auth_all_students ON students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- users
DROP POLICY IF EXISTS users_read_write ON users;
CREATE POLICY auth_all_users ON users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 2. TABLES WITH NO RLS — enable and lock to authenticated
-- ══════════════════════════════════════════════════════════════

ALTER TABLE batches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_courses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_attendance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                 ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_batches ON batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_batch_students ON batch_students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_instructor_courses ON instructor_courses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_instructor_payments ON instructor_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_instructor_payment_items ON instructor_payment_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_instructors ON instructors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_session_attendance ON session_attendance
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_sessions ON sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
