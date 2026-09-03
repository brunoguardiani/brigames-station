ALTER TABLE users DROP CONSTRAINT users_avatar_id_check;

ALTER TABLE users
ADD CONSTRAINT users_avatar_id_check
CHECK (avatar_id IS NULL OR avatar_id ~ '^icon_(0[1-9]|[1-9][0-9]{1,2})$');
