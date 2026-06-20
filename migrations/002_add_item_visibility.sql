ALTER TABLE app_wishlist__wish_items ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'everyone';
