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

var (
	migrationFilenamePattern = regexp.MustCompile(`^(\d+)_(.+)\.sql$`)
	reverseFilenamePattern   = regexp.MustCompile(`^(\d+)_(.+)\.reverse\.sql$`)
)

type Migration struct {
	Version    int64
	Name       string
	SQL        string
	ReverseSQL string
}

func (m Migration) ID() string {
	return fmt.Sprintf("%06d_%s", m.Version, m.Name)
}

type Result struct {
	Target   string
	Applied  []Migration
	Reverted []Migration
}

type Status struct {
	Migration Migration
	Applied   bool
}

func Load(dir string) ([]Migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations directory: %w", err)
	}

	migrationsByVersion := make(map[int64]Migration)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		filename := entry.Name()
		matches := reverseFilenamePattern.FindStringSubmatch(filename)
		isReverse := matches != nil
		if !isReverse {
			matches = migrationFilenamePattern.FindStringSubmatch(filename)
		}
		if matches == nil {
			return nil, fmt.Errorf("invalid migration filename %q: expected NNNNNN_name.sql or NNNNNN_name.reverse.sql", filename)
		}

		version, err := strconv.ParseInt(matches[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse migration version %q: %w", matches[1], err)
		}
		name := matches[2]
		migration := migrationsByVersion[version]
		if migration.Version != 0 && migration.Name != name {
			return nil, fmt.Errorf("migration version %d has inconsistent names %q and %q", version, migration.Name, name)
		}
		migration.Version = version
		migration.Name = name

		sql, err := os.ReadFile(filepath.Join(dir, filename))
		if err != nil {
			return nil, fmt.Errorf("read migration %q: %w", filename, err)
		}
		if isReverse {
			if migration.ReverseSQL != "" {
				return nil, fmt.Errorf("duplicate reverse migration version %d", version)
			}
			migration.ReverseSQL = string(sql)
		} else {
			if migration.SQL != "" {
				return nil, fmt.Errorf("duplicate migration version %d", version)
			}
			migration.SQL = string(sql)
		}
		migrationsByVersion[version] = migration
	}

	migrations := make([]Migration, 0, len(migrationsByVersion))
	for _, migration := range migrationsByVersion {
		if migration.SQL == "" || migration.ReverseSQL == "" {
			return nil, fmt.Errorf("migration %s must have both .sql and .reverse.sql files", migration.ID())
		}
		migrations = append(migrations, migration)
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].Version < migrations[j].Version })

	for i, migration := range migrations {
		if migration.Version != int64(i+1) {
			return nil, fmt.Errorf("migration versions must be consecutive starting at 1: found %d at position %d", migration.Version, i+1)
		}
	}

	return migrations, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool, dir, targetID string) (Result, error) {
	migrations, err := Load(dir)
	if err != nil {
		return Result{}, err
	}

	targetVersion, err := resolveTarget(migrations, targetID)
	if err != nil {
		return Result{}, err
	}
	if err := ensureTrackingTable(ctx, pool); err != nil {
		return Result{}, err
	}

	connection, err := pool.Acquire(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("acquire migration connection: %w", err)
	}
	defer connection.Release()

	if _, err := connection.Exec(ctx, "SELECT pg_advisory_lock(863411)"); err != nil {
		return Result{}, fmt.Errorf("lock migrations: %w", err)
	}
	defer connection.Exec(context.Background(), "SELECT pg_advisory_unlock(863411)")

	applied, err := appliedVersions(ctx, connection, migrations)
	if err != nil {
		return Result{}, err
	}
	current, err := currentVersion(migrations, applied)
	if err != nil {
		return Result{}, err
	}

	result := Result{Target: targetLabel(migrations, targetVersion)}
	if targetVersion > current {
		for _, migration := range migrations {
			if migration.Version <= current || migration.Version > targetVersion {
				continue
			}
			if err := apply(ctx, connection, migration); err != nil {
				return Result{}, err
			}
			result.Applied = append(result.Applied, migration)
		}
	} else if targetVersion < current {
		for i := len(migrations) - 1; i >= 0; i-- {
			migration := migrations[i]
			if migration.Version <= targetVersion || migration.Version > current {
				continue
			}
			if err := reverse(ctx, connection, migration); err != nil {
				return Result{}, err
			}
			result.Reverted = append(result.Reverted, migration)
		}
	}

	return result, nil
}

func List(ctx context.Context, pool *pgxpool.Pool, dir string) ([]Status, error) {
	migrations, err := Load(dir)
	if err != nil {
		return nil, err
	}
	if err := ensureTrackingTable(ctx, pool); err != nil {
		return nil, err
	}
	applied, err := appliedVersions(ctx, pool, migrations)
	if err != nil {
		return nil, err
	}

	status := make([]Status, 0, len(migrations))
	for _, migration := range migrations {
		_, isApplied := applied[migration.Version]
		status = append(status, Status{Migration: migration, Applied: isApplied})
	}
	return status, nil
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func appliedVersions(ctx context.Context, database queryer, migrations []Migration) (map[int64]struct{}, error) {
	knownVersions := make(map[int64]struct{}, len(migrations))
	for _, migration := range migrations {
		knownVersions[migration.Version] = struct{}{}
	}

	rows, err := database.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("list applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int64]struct{})
	for rows.Next() {
		var version int64
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		if _, exists := knownVersions[version]; !exists {
			return nil, fmt.Errorf("applied migration %d is missing from the migration directory", version)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations: %w", err)
	}
	return applied, nil
}

func currentVersion(migrations []Migration, applied map[int64]struct{}) (int64, error) {
	var current int64
	for _, migration := range migrations {
		_, isApplied := applied[migration.Version]
		if !isApplied {
			continue
		}
		if migration.Version != current+1 {
			return 0, fmt.Errorf("applied migrations are not consecutive at version %d", migration.Version)
		}
		current = migration.Version
	}
	return current, nil
}

func resolveTarget(migrations []Migration, targetID string) (int64, error) {
	if targetID == "" {
		if len(migrations) == 0 {
			return 0, nil
		}
		return migrations[len(migrations)-1].Version, nil
	}
	if targetID == "0" {
		return 0, nil
	}
	for _, migration := range migrations {
		if migration.ID() == targetID {
			return migration.Version, nil
		}
	}
	return 0, fmt.Errorf("unknown migration target %q", targetID)
}

func targetLabel(migrations []Migration, version int64) string {
	if version == 0 {
		return "0"
	}
	return migrations[version-1].ID()
}

func ensureTrackingTable(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create migration tracking table: %w", err)
	}
	return nil
}

func apply(ctx context.Context, connection *pgxpool.Conn, migration Migration) error {
	tx, err := connection.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("start migration %s: %w", migration.ID(), err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, migration.SQL); err != nil {
		return fmt.Errorf("apply migration %s: %w", migration.ID(), err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", migration.Version, migration.Name); err != nil {
		return fmt.Errorf("record migration %s: %w", migration.ID(), err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %s: %w", migration.ID(), err)
	}
	return nil
}

func reverse(ctx context.Context, connection *pgxpool.Conn, migration Migration) error {
	tx, err := connection.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("start reversal of migration %s: %w", migration.ID(), err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, migration.ReverseSQL); err != nil {
		return fmt.Errorf("reverse migration %s: %w", migration.ID(), err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM schema_migrations WHERE version = $1", migration.Version); err != nil {
		return fmt.Errorf("remove migration record %s: %w", migration.ID(), err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit reversal of migration %s: %w", migration.ID(), err)
	}
	return nil
}
