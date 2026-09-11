ALTER TABLE users
ADD COLUMN status TEXT NOT NULL DEFAULT 'online'
CHECK (status IN ('online', 'idle', 'invisible'));
