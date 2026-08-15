package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"brigames-station/internal/config"
	"brigames-station/internal/database"
	"brigames-station/internal/migrations"
)

func main() {
	migrationsDir := flag.String("dir", "migrations", "directory containing versioned SQL migrations")
	flag.Usage = func() {
		fmt.Fprintln(flag.CommandLine.Output(), "Usage: migrate [-dir migrations] [migration-target|status]")
		fmt.Fprintln(flag.CommandLine.Output(), "Examples: migrate; migrate 000001_create_users; migrate 0; migrate status")
	}
	flag.Parse()
	if flag.NArg() > 1 {
		flag.Usage()
		os.Exit(2)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}

	pool, err := database.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Error("create PostgreSQL pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	argument := ""
	if flag.NArg() == 1 {
		argument = flag.Arg(0)
	}
	if argument == "status" {
		status, err := migrations.List(context.Background(), pool, *migrationsDir)
		if err != nil {
			logger.Error("list migrations", "error", err)
			os.Exit(1)
		}
		for _, item := range status {
			logger.Info("migration status", "migration", item.Migration.ID(), "applied", item.Applied)
		}
		return
	}

	result, err := migrations.Migrate(context.Background(), pool, *migrationsDir, argument)
	if err != nil {
		logger.Error("migrate database", "error", err)
		os.Exit(1)
	}
	for _, migration := range result.Applied {
		logger.Info("migration applied", "migration", migration.ID())
	}
	for _, migration := range result.Reverted {
		logger.Info("migration reverted", "migration", migration.ID())
	}
	logger.Info("migrations complete", "target", result.Target, "applied", len(result.Applied), "reverted", len(result.Reverted))
}
