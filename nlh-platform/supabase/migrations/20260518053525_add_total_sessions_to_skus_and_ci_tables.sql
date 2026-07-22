
-- ── 1. Add total_sessions to skus ─────────────────────────────────────────────
-- NULL = per-month subscription (no fixed session count)
-- integer = fixed programme length; editable by admin at any time
ALTER TABLE skus ADD COLUMN IF NOT EXISTS total_sessions integer;

COMMENT ON COLUMN skus.total_sessions IS
  'Number of sessions to complete this level. NULL = per-month subscription. Editable by admin.';

-- ── 2. Populate from PDF fee structure ────────────────────────────────────────

-- Write Well
UPDATE skus SET total_sessions = 10  WHERE level_name = 'Print HW'          AND sort_order = 101;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'English HW Junior'  AND sort_order = 102;
UPDATE skus SET total_sessions = 10  WHERE level_name = 'English HW Senior'  AND sort_order = 103;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Calligraphy'        AND sort_order = 104;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Hindi HW'           AND sort_order = 105;

-- ACEM Abacus
UPDATE skus SET total_sessions = 10  WHERE level_name = 'Sub Jr'      AND sort_order = 201;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Jr Level 1'  AND sort_order = 202;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Jr Level 2'  AND sort_order = 203;
UPDATE skus SET total_sessions = 16  WHERE level_name = 'Jr Level 3'  AND sort_order = 204;
UPDATE skus SET total_sessions = 17  WHERE level_name = 'Jr Level 4'  AND sort_order = 205;
UPDATE skus SET total_sessions = 18  WHERE level_name = 'Jr Level 5'  AND sort_order = 206;
UPDATE skus SET total_sessions = 19  WHERE level_name = 'Jr Level 6'  AND sort_order = 207;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Sr Level 1'  AND sort_order = 208;
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Sr Level 2'  AND sort_order = 209;
UPDATE skus SET total_sessions = 16  WHERE level_name = 'Sr Level 3'  AND sort_order = 210;
UPDATE skus SET total_sessions = 17  WHERE level_name = 'Sr Level 4'  AND sort_order = 211;
UPDATE skus SET total_sessions = 18  WHERE level_name = 'Sr Level 5'  AND sort_order = 212;
UPDATE skus SET total_sessions = 19  WHERE level_name = 'Sr Level 6'  AND sort_order = 213;

-- Easy Math
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Vedic Math'  AND sort_order = 301;

-- Rubik's Cube
UPDATE skus SET total_sessions = 8   WHERE level_name = '3x3'          AND sort_order = 401;
UPDATE skus SET total_sessions = 8   WHERE level_name = 'Advanced set' AND sort_order = 402;

-- Coding
UPDATE skus SET total_sessions = 15  WHERE level_name = 'Basic'    AND sort_order = 501;
UPDATE skus SET total_sessions = 16  WHERE level_name = 'Advanced' AND sort_order = 502;

-- Chess, Phonics, Montessori, Computer, Art & Craft,
-- Personality Dev, Creative Writing, English Grammar,
-- Storytelling, Reading, Public Speaking → NULL (per-month, already NULL by default)

-- ── 3. CI system tables ───────────────────────────────────────────────────────

CREATE TABLE instructors (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id             uuid REFERENCES franchisees(id) ON DELETE SET NULL,
  full_name                 text NOT NULL,
  phone                     text,
  email                     text,
  photo_url                 text,
  address                   text,
  area                      text,
  city                      text,
  state                     text,
  pincode                   text,
  joined_at                 date,
  left_at                   date,
  status                    text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','inactive','resigned','terminated')),
  -- Caution deposit
  caution_amount            integer NOT NULL DEFAULT 0,
  caution_paid_at           date,
  caution_mode              text CHECK (caution_mode IN ('upfront','deducted','waived')),
  caution_status            text NOT NULL DEFAULT 'held'
                              CHECK (caution_status IN ('held','refunded','forfeited','partial')),
  caution_settled_at        date,
  caution_settlement_amount integer,
  caution_notes             text,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instructor_courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id       uuid NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  course_id           uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  -- Training
  trained_by_nlh      boolean NOT NULL DEFAULT false,
  training_fee        integer,
  training_date       date,
  -- Remuneration
  remuneration_mode   text NOT NULL
                        CHECK (remuneration_mode IN ('per_student','per_session','monthly')),
  remuneration_rate   integer NOT NULL,
  -- Appointment
  appointed_at        date NOT NULL DEFAULT CURRENT_DATE,
  removed_at          date,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, course_id, appointed_at)
);

CREATE TABLE batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id   uuid REFERENCES franchisees(id) ON DELETE SET NULL,
  instructor_id   uuid NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  sku_id          uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_individual   boolean NOT NULL DEFAULT false,
  schedule_days   text,
  schedule_time   time,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_students (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  enrollment_id   uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  assigned_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  notes           text,
  UNIQUE (batch_id, enrollment_id, assigned_at)
);

CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  instructor_id     uuid NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  sku_id            uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  session_date      date NOT NULL,
  duration_minutes  integer NOT NULL DEFAULT 60,
  topic_notes       text,
  logged_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_attendance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  enrollment_id   uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attended        boolean NOT NULL DEFAULT true,
  notes           text,
  UNIQUE (session_id, enrollment_id)
);

CREATE TABLE instructor_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id       uuid NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  franchisee_id       uuid REFERENCES franchisees(id) ON DELETE SET NULL,
  period_month        integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year         integer NOT NULL,
  gross_amount        integer NOT NULL DEFAULT 0,
  caution_deduction   integer NOT NULL DEFAULT 0,
  other_deductions    integer NOT NULL DEFAULT 0,
  other_deductions_note text,
  net_amount          integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','paid')),
  paid_at             date,
  paid_mode           text,
  paid_ref            text,
  notes               text,
  generated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, period_month, period_year)
);

CREATE TABLE instructor_payment_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES instructor_payments(id) ON DELETE CASCADE,
  item_type       text NOT NULL
                    CHECK (item_type IN ('session_fee','enrollment_completion','monthly_base','bonus','deduction','other')),
  description     text NOT NULL,
  session_id      uuid REFERENCES sessions(id) ON DELETE SET NULL,
  enrollment_id   uuid REFERENCES enrollments(id) ON DELETE SET NULL,
  quantity        integer NOT NULL DEFAULT 1,
  rate            integer NOT NULL DEFAULT 0,
  amount          integer NOT NULL DEFAULT 0
);

-- ── 4. Indexes for common lookups ─────────────────────────────────────────────
CREATE INDEX ON instructors (franchisee_id, status);
CREATE INDEX ON instructor_courses (instructor_id, status);
CREATE INDEX ON batches (instructor_id, is_active);
CREATE INDEX ON batches (sku_id);
CREATE INDEX ON batch_students (batch_id) WHERE removed_at IS NULL;
CREATE INDEX ON batch_students (enrollment_id);
CREATE INDEX ON sessions (instructor_id, session_date);
CREATE INDEX ON sessions (batch_id, session_date);
CREATE INDEX ON session_attendance (enrollment_id);
CREATE INDEX ON session_attendance (session_id);
CREATE INDEX ON instructor_payments (instructor_id, period_year, period_month);
CREATE INDEX ON instructor_payment_items (payment_id);
