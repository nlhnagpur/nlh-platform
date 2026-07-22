
CREATE TABLE payroll_overrides (
  id             uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  instructor_id  uuid        NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  month          text        NOT NULL,  -- YYYY-MM
  final_amount   integer     NOT NULL,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (instructor_id, month)
);

-- RLS
ALTER TABLE payroll_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_overrides_select ON payroll_overrides
  FOR SELECT USING (nlh_is_admin());

CREATE POLICY payroll_overrides_insert ON payroll_overrides
  FOR INSERT WITH CHECK (nlh_is_admin());

CREATE POLICY payroll_overrides_update ON payroll_overrides
  FOR UPDATE USING (nlh_is_admin());

CREATE POLICY payroll_overrides_delete ON payroll_overrides
  FOR DELETE USING (nlh_is_admin());
