CREATE TABLE IF NOT EXISTS wishlists (
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  member_id    TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'everyone',
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (household_id, member_id)
);

CREATE TABLE IF NOT EXISTS wish_items (
  household_id UUID NOT NULL DEFAULT current_setting('app.household_id', true)::uuid,
  id           TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'medium',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (household_id, id)
);

CREATE INDEX IF NOT EXISTS wish_items_member_idx ON wish_items (household_id, member_id);
