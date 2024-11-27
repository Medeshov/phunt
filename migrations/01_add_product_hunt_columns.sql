-- Добавляем колонки для Product Hunt токенов
ALTER TABLE users
ADD COLUMN IF NOT EXISTS ph_access_token TEXT,
ADD COLUMN IF NOT EXISTS ph_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS ph_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS image TEXT,
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS username TEXT;
