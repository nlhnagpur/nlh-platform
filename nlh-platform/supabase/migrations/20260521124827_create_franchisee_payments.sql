
CREATE TABLE franchisee_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id   UUID        NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  payment_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  payment_mode    TEXT,       -- UPI, NEFT, RTGS, Cash, Cheque, DD
  reference_no    TEXT,
  notes           TEXT,
  recorded_by     TEXT,       -- email of admin who recorded it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX franchisee_payments_franchisee_idx ON franchisee_payments(franchisee_id);

-- RLS: admins can do everything; franchisees can only read their own
ALTER TABLE franchisee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_all" ON franchisee_payments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE email ILIKE (auth.jwt() ->> 'email')
        AND role IN ('owner','super_admin','admin','manager','staff')
    )
  );

CREATE POLICY "franchisee_read_own" ON franchisee_payments
  FOR SELECT
  USING (
    franchisee_id = (
      SELECT id FROM franchisees
      WHERE id = (
        SELECT franchisee_id FROM users
        WHERE email ILIKE (auth.jwt() ->> 'email')
      )
    )
  );
