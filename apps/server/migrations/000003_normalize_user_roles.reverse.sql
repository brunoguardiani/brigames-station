ALTER TABLE users ADD COLUMN role TEXT;

UPDATE users
SET role = roles.key
FROM roles
WHERE users.role_id = roles.id;

ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'member'));

DROP INDEX users_role_id_idx;
ALTER TABLE users DROP CONSTRAINT users_role_id_fkey;
ALTER TABLE users DROP COLUMN role_id;

DROP TABLE roles;
