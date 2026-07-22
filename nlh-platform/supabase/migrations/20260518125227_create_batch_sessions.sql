
CREATE TABLE batch_sessions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id        UUID        REFERENCES batches(id) ON DELETE CASCADE NOT NULL,
  session_date    DATE        NOT NULL,
  session_number  INT         NOT NULL,
  instructor_id   UUID        REFERENCES instructors(id),
  is_substitute   BOOLEAN     DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  created_by      UUID
);

ALTER TABLE batch_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_batch_sessions" ON batch_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_batch_sessions_batch ON batch_sessions (batch_id, session_date DESC);
CREATE INDEX idx_session_att_session  ON session_attendance (session_id);
CREATE INDEX idx_session_att_enr      ON session_attendance (enrollment_id);

-- Add unique constraint on session_attendance if not already there
ALTER TABLE session_attendance ADD CONSTRAINT session_attendance_session_enrollment_key UNIQUE (session_id, enrollment_id);
