alter table access_requests drop constraint access_requests_role_requested_check;
alter table access_requests add constraint access_requests_role_requested_check
  check (role_requested = any (array['smf','cf','uf','staff','student']));
