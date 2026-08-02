-- Automation support for the `add_wish` action.
--
-- `source_event_id` records which app event produced the row. The dispatcher's
-- dedupe guard matches on it (SELECT 1 FROM ... WHERE source_event_id = ?
-- LIMIT 1), so a retried or replayed delivery finds the existing row and skips
-- instead of adding the same wish twice.
--
-- Nullable on purpose: wishes added by a person have no source event, and the
-- guard only ever looks for a specific non-null id.
ALTER TABLE app_wishlist__wish_items ADD COLUMN source_event_id TEXT;

CREATE INDEX IF NOT EXISTS app_wishlist__idx_wish_items_source_event_id
  ON app_wishlist__wish_items(source_event_id);
