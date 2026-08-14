package migrations

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSortsMigrationsByVersion(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFiles(t, dir, "000002_second", "SELECT 2;", "SELECT 2;")
	writeMigrationFiles(t, dir, "000001_first", "SELECT 1;", "SELECT 1;")

	migrations, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrations) != 2 {
		t.Fatalf("migration count = %d, want 2", len(migrations))
	}
	if migrations[0].ID() != "000001_first" || migrations[1].ID() != "000002_second" {
		t.Fatalf("migration IDs = [%s, %s], want [000001_first, 000002_second]", migrations[0].ID(), migrations[1].ID())
	}
}

func TestLoadRejectsMissingReverseFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "000001_first.sql"), []byte("SELECT 1;"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := Load(dir); err == nil {
		t.Fatal("Load() error = nil, want missing reverse file error")
	}
}

func TestResolveTarget(t *testing.T) {
	migrations := []Migration{{Version: 1, Name: "first"}, {Version: 2, Name: "second"}}

	for _, test := range []struct {
		target string
		want   int64
	}{
		{target: "", want: 2},
		{target: "0", want: 0},
		{target: "000001_first", want: 1},
	} {
		got, err := resolveTarget(migrations, test.target)
		if err != nil {
			t.Fatalf("resolveTarget(%q) error = %v", test.target, err)
		}
		if got != test.want {
			t.Fatalf("resolveTarget(%q) = %d, want %d", test.target, got, test.want)
		}
	}
}

func writeMigrationFiles(t *testing.T, dir, id, sql, reverseSQL string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, id+".sql"), []byte(sql), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, id+".reverse.sql"), []byte(reverseSQL), 0o600); err != nil {
		t.Fatal(err)
	}
}
