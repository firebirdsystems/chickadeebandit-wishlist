-- One row per member whose wish list can be shared outside the household.
--
-- Why a table at all: a share link points at one ROW, identified by the item
-- type's `id_column`. A member's wish list is not a row — it is every
-- `wish_items` row carrying their `member_id` — so before this there was
-- nothing for a link to name. This table is that anchor and nothing more; the
-- items themselves are untouched and reach the public page through the
-- shareable `feed`, which joins on the same `member_id`.
--
-- `member_id` is the primary key AND the shareable `id_column`: one list per
-- member, and the share link's item id is just the member id. It is plaintext
-- (the `_id` suffix), which it must be — the mint and the public page both
-- match it with `WHERE member_id = ?`, and ciphertext never compares equal.
--
-- `title` is encrypted like any other prose. It is written NOT NULL with no
-- default on purpose: the app always supplies "<Name>'s Wish List", and an
-- empty string is not a value the codec can encrypt.
CREATE TABLE IF NOT EXISTS app_wishlist__lists (
  member_id  TEXT NOT NULL,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id)
);
