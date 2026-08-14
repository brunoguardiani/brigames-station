# SQL Migrations

Migration files use the format `NNNNNN_description.up.sql`, with a unique
numeric version. For example: `000001_create_users.up.sql`.

Run migrations explicitly from `apps/server`:

```powershell
go run ./cmd/migrate
```

The API process never runs migrations automatically. The migration command
records successfully applied versions in PostgreSQL's `schema_migrations` table
and skips them on later runs.

No domain migration exists yet. The first migration must be added only when a
future approved phase introduces a database-owned feature.
