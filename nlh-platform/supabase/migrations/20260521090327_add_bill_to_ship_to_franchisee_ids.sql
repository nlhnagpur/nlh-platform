
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bill_to_franchisee_id UUID REFERENCES franchisees(id),
  ADD COLUMN IF NOT EXISTS ship_to_franchisee_id UUID REFERENCES franchisees(id);
