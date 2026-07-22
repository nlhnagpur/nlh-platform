
DROP INDEX IF EXISTS public.batch_students_enrollment_id_idx;
DROP INDEX IF EXISTS public.idx_franchisees_parent;
DROP INDEX IF EXISTS public.instructor_payment_items_payment_id_idx;
DROP INDEX IF EXISTS public.idx_order_items_order;
DROP INDEX IF EXISTS public.idx_orders_placer;
DROP INDEX IF EXISTS public.idx_session_attendance_enr_id;
DROP INDEX IF EXISTS public.session_attendance_enrollment_id_idx;
DROP INDEX IF EXISTS public.session_attendance_session_id_idx;
ALTER TABLE public.session_attendance DROP CONSTRAINT IF EXISTS session_attendance_session_id_enrollment_id_key;
