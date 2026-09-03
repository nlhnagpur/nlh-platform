-- stock_ledger had SELECT/INSERT/DELETE policies but no UPDATE policy at
-- all — editing the Opening Stock figure on an item (InventoryPage's
-- ItemModal, which UPDATEs the existing "Opening stock" ledger row rather
-- than inserting a new one) silently did nothing: RLS blocked the update,
-- the app code didn't check for an error, and the UI showed "Item
-- updated" regardless. Matches stock_ins's admin-only bar.
create policy stock_upd on stock_ledger for update
  using (nlh_is_admin())
  with check (nlh_is_admin());
