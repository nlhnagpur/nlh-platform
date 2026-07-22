
-- Replace course_id with sku_id in instructor_courses
-- (table is empty — no data to migrate)
ALTER TABLE instructor_courses DROP CONSTRAINT IF EXISTS instructor_courses_instructor_id_course_id_appointed_at_key;
ALTER TABLE instructor_courses DROP COLUMN IF EXISTS course_id;
ALTER TABLE instructor_courses ADD COLUMN sku_id uuid REFERENCES skus(id) ON DELETE CASCADE;
ALTER TABLE instructor_courses ADD CONSTRAINT instructor_courses_instructor_id_sku_id_appointed_at_key
  UNIQUE (instructor_id, sku_id, appointed_at);
CREATE INDEX IF NOT EXISTS instructor_courses_sku_id_idx ON instructor_courses(sku_id);
