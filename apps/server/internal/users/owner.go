package users

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrOwnerAlreadyExists = errors.New("an owner account already exists")

type Owner struct {
	Username     string
	Email        string
	PasswordHash string
}

func CreateInitialOwner(ctx context.Context, pool *pgxpool.Pool, owner Owner) (int64, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("start owner seed transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(863412)"); err != nil {
		return 0, fmt.Errorf("lock owner seed: %w", err)
	}

	var ownerExists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM users JOIN roles ON roles.id = users.role_id WHERE roles.key = 'owner')").Scan(&ownerExists); err != nil {
		return 0, fmt.Errorf("check existing owner: %w", err)
	}
	if ownerExists {
		return 0, ErrOwnerAlreadyExists
	}

	var userID int64
	err = tx.QueryRow(ctx, "INSERT INTO users (username, email, password_hash, role_id) SELECT $1, $2, $3, roles.id FROM roles WHERE roles.key = 'owner' RETURNING id", owner.Username, owner.Email, owner.PasswordHash).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("create owner: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit owner seed: %w", err)
	}
	return userID, nil
}
