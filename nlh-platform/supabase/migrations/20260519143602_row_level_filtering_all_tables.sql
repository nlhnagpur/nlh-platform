
-- ══════════════════════════════════════════════════════════════
-- Drop all previous broad "authenticated = true" policies
-- ══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS auth_all_enrollments          ON enrollments;
DROP POLICY IF EXISTS auth_all_fee_transactions     ON fee_transactions;
DROP POLICY IF EXISTS auth_all_franchisees          ON franchisees;
DROP POLICY IF EXISTS auth_all_kit_price_history    ON kit_price_history;
DROP POLICY IF EXISTS auth_all_notifications        ON notifications;
DROP POLICY IF EXISTS auth_all_order_items          ON order_items;
DROP POLICY IF EXISTS auth_all_orders               ON orders;
DROP POLICY IF EXISTS auth_write_skus               ON skus;
DROP POLICY IF EXISTS auth_all_stock_movements      ON stock_movements;
DROP POLICY IF EXISTS auth_all_students             ON students;
DROP POLICY IF EXISTS auth_all_users                ON users;
DROP POLICY IF EXISTS auth_all_batches              ON batches;
DROP POLICY IF EXISTS auth_all_batch_students       ON batch_students;
DROP POLICY IF EXISTS auth_all_batch_sessions       ON batch_sessions;
DROP POLICY IF EXISTS auth_all_instructor_courses   ON instructor_courses;
DROP POLICY IF EXISTS auth_all_instructors          ON instructors;
DROP POLICY IF EXISTS auth_all_instructor_payments  ON instructor_payments;
DROP POLICY IF EXISTS auth_all_instructor_payment_items ON instructor_payment_items;
DROP POLICY IF EXISTS auth_all_session_attendance   ON session_attendance;
DROP POLICY IF EXISTS auth_all_sessions             ON sessions;
DROP POLICY IF EXISTS auth_update_requests          ON access_requests;
DROP POLICY IF EXISTS auth_read_requests            ON access_requests;

-- ══════════════════════════════════════════════════════════════
-- USERS — own row only; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY users_select ON users FOR SELECT TO authenticated
  USING (nlh_is_admin() OR id = auth.uid());

CREATE POLICY users_insert ON users FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin());

CREATE POLICY users_update ON users FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR id = auth.uid())
  WITH CHECK (nlh_is_admin() OR id = auth.uid());

CREATE POLICY users_delete ON users FOR DELETE TO authenticated
  USING (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- FRANCHISEES — own + descendants; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY franchisees_select ON franchisees FOR SELECT TO authenticated
  USING (nlh_is_admin() OR id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY franchisees_insert ON franchisees FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin());

CREATE POLICY franchisees_update ON franchisees FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY franchisees_delete ON franchisees FOR DELETE TO authenticated
  USING (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- STUDENTS — own franchisee tree; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY students_update ON students FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY students_delete ON students FOR DELETE TO authenticated
  USING (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- ENROLLMENTS — own franchisee tree; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY enrollments_select ON enrollments FOR SELECT TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY enrollments_insert ON enrollments FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY enrollments_update ON enrollments FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY enrollments_delete ON enrollments FOR DELETE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

-- ══════════════════════════════════════════════════════════════
-- BATCHES — own franchisee tree; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY batches_select ON batches FOR SELECT TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY batches_insert ON batches FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY batches_update ON batches FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY batches_delete ON batches FOR DELETE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

-- ══════════════════════════════════════════════════════════════
-- BATCH_STUDENTS — via enrollment → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY batch_students_select ON batch_students FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = batch_students.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY batch_students_insert ON batch_students FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = batch_students.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY batch_students_update ON batch_students FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = batch_students.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY batch_students_delete ON batch_students FOR DELETE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = batch_students.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- BATCH_SESSIONS — via batch → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY batch_sessions_select ON batch_sessions FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = batch_sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY batch_sessions_insert ON batch_sessions FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = batch_sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY batch_sessions_update ON batch_sessions FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = batch_sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- SESSION_ATTENDANCE — via enrollment → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY session_attendance_select ON session_attendance FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = session_attendance.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY session_attendance_insert ON session_attendance FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = session_attendance.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY session_attendance_update ON session_attendance FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id = session_attendance.enrollment_id
        AND e.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- SESSIONS — via batch → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY sessions_select ON sessions FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY sessions_insert ON sessions FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY sessions_update ON sessions FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM batches b
      WHERE b.id = sessions.batch_id
        AND b.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- INSTRUCTORS — own franchisee tree; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY instructors_select ON instructors FOR SELECT TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY instructors_insert ON instructors FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY instructors_update ON instructors FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY instructors_delete ON instructors FOR DELETE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

-- ══════════════════════════════════════════════════════════════
-- INSTRUCTOR_COURSES — via instructor → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY instructor_courses_select ON instructor_courses FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructors i
      WHERE i.id = instructor_courses.instructor_id
        AND i.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY instructor_courses_insert ON instructor_courses FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructors i
      WHERE i.id = instructor_courses.instructor_id
        AND i.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY instructor_courses_update ON instructor_courses FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructors i
      WHERE i.id = instructor_courses.instructor_id
        AND i.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY instructor_courses_delete ON instructor_courses FOR DELETE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructors i
      WHERE i.id = instructor_courses.instructor_id
        AND i.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- INSTRUCTOR_PAYMENTS — own franchisee tree; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY instructor_payments_select ON instructor_payments FOR SELECT TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY instructor_payments_insert ON instructor_payments FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY instructor_payments_update ON instructor_payments FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR franchisee_id = ANY(nlh_accessible_franchisee_ids()));

-- ══════════════════════════════════════════════════════════════
-- INSTRUCTOR_PAYMENT_ITEMS — via payment → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY instructor_payment_items_select ON instructor_payment_items FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructor_payments ip
      WHERE ip.id = instructor_payment_items.payment_id
        AND ip.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY instructor_payment_items_insert ON instructor_payment_items FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructor_payments ip
      WHERE ip.id = instructor_payment_items.payment_id
        AND ip.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY instructor_payment_items_update ON instructor_payment_items FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM instructor_payments ip
      WHERE ip.id = instructor_payment_items.payment_id
        AND ip.franchisee_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- ORDERS — placer_id is the franchisee; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY orders_select ON orders FOR SELECT TO authenticated
  USING (nlh_is_admin() OR placer_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY orders_insert ON orders FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR placer_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY orders_update ON orders FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR placer_id = ANY(nlh_accessible_franchisee_ids()))
  WITH CHECK (nlh_is_admin() OR placer_id = ANY(nlh_accessible_franchisee_ids()));

-- ══════════════════════════════════════════════════════════════
-- ORDER_ITEMS — via order → franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY order_items_select ON order_items FOR SELECT TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.placer_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY order_items_insert ON order_items FOR INSERT TO authenticated
  WITH CHECK (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.placer_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

CREATE POLICY order_items_update ON order_items FOR UPDATE TO authenticated
  USING (
    nlh_is_admin() OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.placer_id = ANY(nlh_accessible_franchisee_ids())
    )
  );

-- ══════════════════════════════════════════════════════════════
-- FEE_TRANSACTIONS — payer, smf, or cf in franchisee tree
-- ══════════════════════════════════════════════════════════════
CREATE POLICY fee_transactions_select ON fee_transactions FOR SELECT TO authenticated
  USING (
    nlh_is_admin()
    OR payer_id = ANY(nlh_accessible_franchisee_ids())
    OR smf_id   = ANY(nlh_accessible_franchisee_ids())
    OR cf_id    = ANY(nlh_accessible_franchisee_ids())
  );

CREATE POLICY fee_transactions_insert ON fee_transactions FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin() OR payer_id = ANY(nlh_accessible_franchisee_ids()));

CREATE POLICY fee_transactions_update ON fee_transactions FOR UPDATE TO authenticated
  USING (nlh_is_admin())
  WITH CHECK (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- NOTIFICATIONS — own user's notifications; admins see all
-- ══════════════════════════════════════════════════════════════
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (nlh_is_admin() OR recipient_id = auth.uid());

CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (nlh_is_admin());

CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated
  USING (nlh_is_admin() OR recipient_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- STOCK_MOVEMENTS — admin only (NLH internal stock)
-- ══════════════════════════════════════════════════════════════
CREATE POLICY stock_movements_all ON stock_movements FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- KIT_PRICE_HISTORY — admin only
-- ══════════════════════════════════════════════════════════════
CREATE POLICY kit_price_history_all ON kit_price_history FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- SKUS — read is public (catalog); writes admin only
-- ══════════════════════════════════════════════════════════════
CREATE POLICY skus_write ON skus FOR ALL TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());

-- ══════════════════════════════════════════════════════════════
-- ACCESS_REQUESTS — INSERT stays public; read/update admin only
-- ══════════════════════════════════════════════════════════════
CREATE POLICY access_requests_select ON access_requests FOR SELECT TO authenticated
  USING (nlh_is_admin());

CREATE POLICY access_requests_update ON access_requests FOR UPDATE TO authenticated
  USING (nlh_is_admin()) WITH CHECK (nlh_is_admin());
