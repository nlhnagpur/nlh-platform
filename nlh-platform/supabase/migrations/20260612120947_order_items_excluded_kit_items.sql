alter table order_items add column if not exists excluded_kit_items uuid[] not null default '{}';
comment on column order_items.excluded_kit_items is 'item_ids of kit components NOT sent for this line; skipped during dispatch stock deduction';
