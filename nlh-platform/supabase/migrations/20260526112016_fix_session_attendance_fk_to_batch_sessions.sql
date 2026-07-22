-- Drop the wrong FK (pointed to old `sessions` table)
ALTER TABLE session_attendance DROP CONSTRAINT session_attendance_session_id_fkey;

-- Add correct FK pointing to batch_sessions
ALTER TABLE session_attendance
  ADD CONSTRAINT session_attendance_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES batch_sessions(id) ON DELETE CASCADE;
