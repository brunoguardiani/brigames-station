ALTER TABLE users
ADD COLUMN avatar_id TEXT
CHECK (avatar_id IS NULL OR avatar_id ~ '^icon_(0[1-9]|1[0-5])$');
