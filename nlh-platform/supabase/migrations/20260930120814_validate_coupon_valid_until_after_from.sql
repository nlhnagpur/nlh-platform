-- DIWALI15's dates are now fixed (01-10-2026 to 20-10-2026), so the
-- coupons_valid_until_after_from constraint (added NOT VALID) no longer has
-- any violating rows — validate it now so it's fully enforced, not just for
-- new writes.
alter table coupons validate constraint coupons_valid_until_after_from;
