
-- Advance invoice_seq past the 3 invoices already created manually by the frontend
-- Next call to nextval('invoice_seq') will return 4
SELECT setval('invoice_seq', 3, true);
