-- "I'll get this": one claim per wish item, hidden from whoever wished for it.
--
-- The row policy is `inherit_visibility` under wish_items with
-- `hidden_from_parent_owner`: everyone who can see the item sees its claim,
-- except the item's owner, who can neither read nor write claims on their own
-- items. So the owner's list never says what is coming, while two relatives
-- shopping the same list can see it is taken.
--
-- `item_id` is plaintext (the `_id` suffix) so the unique index and the
-- policy's parent lookup compare real values; `status` is listed in
-- db_plaintext_columns for the same reason. One claim per item is the unique
-- index, so a second giver gets a refusal rather than a duplicate gift.
-- STRICT keeps every id text (the hub requires it for a hidden table: its
-- export pages the table by id).
CREATE TABLE IF NOT EXISTS app_wishlist__claims (
  id          TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'reserved',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS app_wishlist__claims_item_unique
  ON app_wishlist__claims (item_id);
