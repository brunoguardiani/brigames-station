package main

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"brigames-station/internal/auth"
	"brigames-station/internal/config"
	"brigames-station/internal/database"
	"brigames-station/internal/users"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	ownerConfig, err := config.LoadOwnerSeedConfig()
	if err != nil {
		logger.Error("load owner seed configuration", "error", err)
		os.Exit(1)
	}
	passwordHash, err := auth.HashPassword(ownerConfig.Password)
	if err != nil {
		logger.Error("hash owner password", "error", err)
		os.Exit(1)
	}

	pool, err := database.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Error("create PostgreSQL pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	userID, err := users.CreateInitialOwner(context.Background(), pool, users.Owner{
		Username:     ownerConfig.Username,
		Email:        ownerConfig.Email,
		PasswordHash: passwordHash,
	})
	if err != nil {
		if errors.Is(err, users.ErrOwnerAlreadyExists) {
			logger.Error("seed owner", "error", "an owner account already exists")
		} else {
			logger.Error("seed owner", "error", err)
		}
		os.Exit(1)
	}

	logger.Info("owner account created", "user_id", userID)
}
