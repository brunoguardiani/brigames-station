package migrations

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSortsMigrationsByVersion(t *testing.T) {
	dir := t.TempDir()
	for name, sql := range map[string]string{
		"000002_second.up.sql": "SELECT 2;",
		"000001_first.up.sql":  "SELECT 1;",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(sql), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	migrations, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(migrations) != 2 {
		t.Fatalf("migration count = %d, want 2", len(migrations))
	}
	if migrations[0].Version != 1 || migrations[1].Version != 2 {
		t.Fatalf("versions = [%d, %d], want [1, 2]", migrations[0].Version, migrations[1].Version)
	}
}

func TestLoadRejectsInvalidFilename(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "initial.sql"), []byte("SELECT 1;"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := Load(dir); err == nil {
		t.Fatal("Load() error = nil, want invalid filename error")
	}
}
