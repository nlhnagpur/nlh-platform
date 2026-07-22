
ALTER TABLE franchisees DISABLE TRIGGER trg_prevent_franchisee_escalation;

-- KID'S WORLD (Bharuch) → NEXA MINDS (Bharuch CF)
UPDATE franchisees
SET parent_id = '0157a3a6-abad-4325-9f2a-a4454f9a8616'
WHERE id = 'eaaa3a5c-e6fb-4a44-bf70-cc650030e32f';

-- Rushvi Patel (Ahmedabad UF) → Nitu Kothari (Ahmedabad CF)
UPDATE franchisees
SET parent_id = 'ec08f1ea-6868-464f-a506-ec95b46e0531'
WHERE id = 'fc4460f1-499e-4c47-895d-801c0bf5b6ae';

ALTER TABLE franchisees ENABLE TRIGGER trg_prevent_franchisee_escalation;
