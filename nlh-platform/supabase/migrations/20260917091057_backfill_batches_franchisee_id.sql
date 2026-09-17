-- A handful of batches predate the franchisee_id column and were left
-- null. Every student currently assigned to one of them belongs to NLH
-- Head Office itself, confirmed by joining batch_students -> enrollments
-- -> students -> franchisees before running this — so backfilling to
-- HO's own franchisee_id is a correction, not a guess.
update batches set franchisee_id = '64d74a38-452d-43c0-8455-897a317e68c4'
where franchisee_id is null;
