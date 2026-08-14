package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"brigames-station/internal/config"
	"brigames-station/internal/database"
	"brigames-station/internal/migrations"
)

func main() {
	migrationsDir := flag.String("dir", "migrations", "directory containing versioned .up.sql migrations")
	flag.Parse()

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

	applied, err := migrations.Apply(context.Background(), pool, *migrationsDir)
	if err != nil {
		logger.Error("apply migrations", "error", err)
		os.Exit(1)
	}

	logger.Info("migrations complete", "applied", len(applied))
}
