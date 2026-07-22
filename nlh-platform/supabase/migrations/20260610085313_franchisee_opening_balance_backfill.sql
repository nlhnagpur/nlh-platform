
INSERT INTO public.franchisee_payments (franchisee_id, amount, payment_date, payment_mode, notes)
SELECT f.id,
       (COALESCE(f.fee_paid,0) - COALESCE(p.s,0))::int,
       COALESCE(f.created_at::date, CURRENT_DATE),
       'Opening',
       'Opening balance (backfilled from existing fee record)'
FROM public.franchisees f
LEFT JOIN (SELECT franchisee_id, sum(amount) s FROM public.franchisee_payments GROUP BY franchisee_id) p
       ON p.franchisee_id = f.id
WHERE COALESCE(f.fee_paid,0) > COALESCE(p.s,0);
