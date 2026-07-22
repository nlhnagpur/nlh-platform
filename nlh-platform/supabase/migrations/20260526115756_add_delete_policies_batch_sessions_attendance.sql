
-- DELETE policy for batch_sessions: admins or users with access to the batch's franchisee
CREATE POLICY batch_sessions_delete ON public.batch_sessions
  FOR DELETE
  USING (
    nlh_is_admin() OR (
      EXISTS (
        SELECT 1 FROM batches b
        WHERE b.id = batch_sessions.batch_id
          AND b.franchisee_id = ANY (nlh_accessible_franchisee_ids())
      )
    )
  );

-- DELETE policy for session_attendance: admins or users with access to the enrollment's franchisee
CREATE POLICY session_attendance_delete ON public.session_attendance
  FOR DELETE
  USING (
    nlh_is_admin() OR (
      EXISTS (
        SELECT 1 FROM enrollments e
        WHERE e.id = session_attendance.enrollment_id
          AND e.franchisee_id = ANY (nlh_accessible_franchisee_ids())
      )
    )
  );
