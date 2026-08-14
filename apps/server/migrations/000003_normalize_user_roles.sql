CREATE TABLE roles (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO roles (key) VALUES ('owner'), ('member');

ALTER TABLE users ADD COLUMN role_id BIGINT;

UPDATE users
SET role_id = roles.id
FROM roles
WHERE users.role = roles.key;

ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE users
  ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id);
CREATE INDEX users_role_id_idx ON users (role_id);

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users DROP COLUMN role;
