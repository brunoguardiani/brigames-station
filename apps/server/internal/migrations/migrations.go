package migrations

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var filenamePattern = regexp.MustCompile(`^(\d+)_(.+)\.up\.sql$`)

type Migration struct {
	Version int64
	Name    string
	SQL     string
}

func Load(dir string) ([]Migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations directory: %w", err)
	}

	migrations := make([]Migration, 0)
	versions := make(map[int64]struct{})
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		matches := filenamePattern.FindStringSubmatch(entry.Name())
		if matches == nil {
			return nil, fmt.Errorf("invalid migration filename %q: expected NNNNNN_name.up.sql", entry.Name())
		}

		version, err := strconv.ParseInt(matches[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse migration version %q: %w", matches[1], err)
		}
		if _, exists := versions[version]; exists {
			return nil, fmt.Errorf("duplicate migration version %d", version)
		}

		sql, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read migration %q: %w", entry.Name(), err)
		}

		versions[version] = struct{}{}
		migrations = append(migrations, Migration{
			Version: version,
			Name:    matches[2],
			SQL:     string(sql),
		})
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	return migrations, nil
}

func Apply(ctx context.Context, pool *pgxpool.Pool, dir string) ([]Migration, error) {
	migrations, err := Load(dir)
	if err != nil {
		return nil, err
	}

	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return nil, fmt.Errorf("create migration tracking table: %w", err)
	}

	knownVersions := make(map[int64]struct{}, len(migrations))
	for _, migration := range migrations {
		knownVersions[migration.Version] = struct{}{}
	}

	rows, err := pool.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("list applied migrations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var version int64
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		if _, exists := knownVersions[version]; !exists {
			return nil, fmt.Errorf("applied migration %d is missing from %s", version, dir)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations: %w", err)
	}

	applied := make([]Migration, 0)
	for _, migration := range migrations {
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return nil, fmt.Errorf("start migration %d: %w", migration.Version, err)
		}

		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(863411)"); err != nil {
			tx.Rollback(ctx)
			return nil, fmt.Errorf("lock migration %d: %w", migration.Version, err)
		}

		var alreadyApplied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", migration.Version).Scan(&alreadyApplied); err != nil {
			tx.Rollback(ctx)
			return nil, fmt.Errorf("check migration %d: %w", migration.Version, err)
		}
		if alreadyApplied {
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("commit migration check %d: %w", migration.Version, err)
			}
			continue
		}

		if _, err := tx.Exec(ctx, migration.SQL); err != nil {
			tx.Rollback(ctx)
			return nil, fmt.Errorf("apply migration %d: %w", migration.Version, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", migration.Version, migration.Name); err != nil {
			tx.Rollback(ctx)
			return nil, fmt.Errorf("record migration %d: %w", migration.Version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit migration %d: %w", migration.Version, err)
		}

		applied = append(applied, migration)
	}

	return applied, nil
}
