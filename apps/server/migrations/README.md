# SQL Migrations

Each migration has a unique numeric version and two SQL files:

```text
NNNNNN_description.sql
NNNNNN_description.reverse.sql
```

For example: `000001_create_users.sql` and
`000001_create_users.reverse.sql`. The reverse SQL must undo the schema change
made by its corresponding migration.

Run migrations explicitly from `apps/server`:

```powershell
go run ./cmd/migrate
```

The command applies pending migrations up to the latest known version. To make
the database match a specific migration, pass its identifier without a file
extension:

```powershell
go run ./cmd/migrate 000001_create_users
```

If later migrations are applied, they are reversed in descending order until
the requested target is reached. To remove every applied migration from a local
database, use target `0`:

```powershell
go run ./cmd/migrate 0
```

To inspect migration state:

```powershell
go run ./cmd/migrate status
```

The API process never runs migrations automatically. The migration command
records the successfully applied versions in PostgreSQL's `schema_migrations`
table. The table always represents the exact schema version currently applied.
