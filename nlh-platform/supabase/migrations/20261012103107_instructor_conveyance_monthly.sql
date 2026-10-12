-- Fixed monthly conveyance paid to a CI on top of their course remuneration.
alter table instructors add column if not exists conveyance_monthly integer not null default 0;
