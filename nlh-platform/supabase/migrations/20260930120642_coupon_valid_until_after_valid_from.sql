-- The coupon edit form had no check that "valid until" fell after "valid
-- from" — DIWALI15 got saved with valid_from 2026-10-01 and valid_until
-- 2026-09-20 (before it even starts). Client-side validation now blocks
-- this; this check constraint is the DB-level backstop so it can't be
-- re-introduced by another path. Added NOT VALID since the existing
-- DIWALI15 row already violates it — enforced for every new write, but
-- doesn't require fixing that row first. Rasesh should correct DIWALI15's
-- dates via the Coupons UI (now validated) whenever convenient.

alter table coupons add constraint coupons_valid_until_after_from
  check (valid_from is null or valid_until is null or valid_until >= valid_from) not valid;
