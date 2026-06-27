CREATE TABLE IF NOT EXISTS app_wishlist__wish_items (
  id           TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'medium',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS wish_items_member_idx ON app_wishlist__wish_items (member_id);
