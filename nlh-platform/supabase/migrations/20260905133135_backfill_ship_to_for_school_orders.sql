-- School orders bill the school but the CF who placed the order is who
-- actually delivers and follows up on the ground. New orders now default
-- Ship To to the placer automatically (see NewOrderModal in OrdersPage.jsx)
-- when bill_to is a school. Backfill the one existing school order that
-- predates this default (ORD-2026-0018 / INV-2026-0024, Angels' Park
-- School, placed by their CF Pampi Roy) so its invoice prints all three
-- columns (From / Bill To / Ship To) instead of just two.

update orders o
set ship_to_franchisee_id = o.placer_id
from franchisees bf
where bf.id = o.bill_to_franchisee_id
  and bf.tier = 'SCHOOL'
  and o.ship_to_franchisee_id is null;
