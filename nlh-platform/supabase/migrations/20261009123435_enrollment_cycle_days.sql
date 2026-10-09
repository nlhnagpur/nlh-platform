-- The weekdays a monthly student attends in their current cycle (e.g.
-- 'Mon, Wed, Fri'), chosen when the cycle is renewed. The cycle's class
-- target is the count of these days (Mon-Fri only; Saturday is free revision)
-- inside the cycle window, less declared holidays. Null = fall back to the
-- batch's own schedule_days, then to every Mon-Fri.
alter table enrollments add column cycle_days text;
