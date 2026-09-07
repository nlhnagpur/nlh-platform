-- Layout request: franchisee detail form's contact row becomes
-- Email / Phone 1 / Phone 2 — a genuine second contact number, not
-- just relabeling the existing `phone` column.
alter table franchisees add column phone2 text;
