-- Course fees are now the catalogue price, plain and round (₹3,500, ₹2,500),
-- instead of the agreed total carved up proportionally, which produced figures
-- like ₹2,853 that correspond to nothing anyone agreed or would quote.
--
-- Where the agreed total is lower than the courses add up to, the difference is
-- simply a discount on the student's account; it is shown as a credit rather
-- than smeared across the individual course prices.
update enrollments e
set fee_amount = k.student_fee
from skus k
where k.id = e.sku_id and coalesce(k.student_fee, 0) > 0;
