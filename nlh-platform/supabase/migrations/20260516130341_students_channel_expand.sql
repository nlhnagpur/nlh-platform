
ALTER TABLE students DROP CONSTRAINT students_channel_check;
ALTER TABLE students ADD CONSTRAINT students_channel_check
  CHECK (channel = ANY (ARRAY[
    'franchise','own_centre','international',
    'walk-in','referral','online','camp','school','other'
  ]));
ALTER TABLE students ALTER COLUMN channel SET DEFAULT 'franchise';
