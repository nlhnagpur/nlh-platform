
-- fee_transactions (0 rows) — superseded by student_payments
DROP TABLE IF EXISTS public.fee_transactions;
-- notifications (0 rows) — unused
DROP TABLE IF EXISTS public.notifications;
-- sessions (0 rows) — superseded by batch_sessions; only the empty instructor_payment_items references it
DROP TABLE IF EXISTS public.sessions CASCADE;
