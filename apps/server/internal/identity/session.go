package identity

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"brigames-station/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (service *Service) Login(ctx context.Context, identity, password string) (Tokens, error) {
	identity = strings.TrimSpace(identity)
	if identity == "" || password == "" {
		return Tokens{}, ErrInvalidCredentials
	}
	var user User
	var passwordHash string
	err := service.pool.QueryRow(ctx, "SELECT users.id, users.username, users.email, roles.key, users.password_hash FROM users JOIN roles ON roles.id = users.role_id WHERE lower(users.username) = lower($1) OR lower(users.email) = lower($1) ORDER BY CASE WHEN lower(users.username) = lower($1) THEN 0 ELSE 1 END LIMIT 1", identity).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tokens{}, ErrInvalidCredentials
	}
	if err != nil {
		return Tokens{}, fmt.Errorf("find user: %w", err)
	}
	valid, err := auth.VerifyPassword(passwordHash, password)
	if err != nil || !valid {
		return Tokens{}, ErrInvalidCredentials
	}
	return service.createSession(ctx, service.pool, user.ID)
}

func (service *Service) Refresh(ctx context.Context, rawToken string) (Tokens, error) {
	if rawToken == "" {
		return Tokens{}, ErrInvalidRefreshToken
	}
	tx, err := service.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Tokens{}, fmt.Errorf("start refresh transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	var userID int64
	err = tx.QueryRow(ctx, "SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() FOR UPDATE", auth.HashRefreshToken(rawToken)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tokens{}, ErrInvalidRefreshToken
	}
	if err != nil {
		return Tokens{}, fmt.Errorf("find refresh token: %w", err)
	}
	if _, err := tx.Exec(ctx, "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", auth.HashRefreshToken(rawToken)); err != nil {
		return Tokens{}, fmt.Errorf("revoke refresh token: %w", err)
	}
	result, err := service.createSession(ctx, tx, userID)
	if err != nil {
		return Tokens{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Tokens{}, fmt.Errorf("commit refresh transaction: %w", err)
	}
	return result, nil
}

func (service *Service) Logout(ctx context.Context, rawToken string) error {
	if rawToken == "" {
		return ErrInvalidRefreshToken
	}
	command, err := service.pool.Exec(ctx, "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()", auth.HashRefreshToken(rawToken))
	if err != nil {
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	if command.RowsAffected() != 1 {
		return ErrInvalidRefreshToken
	}
	return nil
}

type tokenStore interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (service *Service) createSession(ctx context.Context, store tokenStore, userID int64) (Tokens, error) {
	now := time.Now().UTC()
	accessToken, claims, err := service.tokens.Issue(userID, now)
	if err != nil {
		return Tokens{}, fmt.Errorf("issue access token: %w", err)
	}
	refreshToken, refreshHash, err := auth.NewRefreshToken()
	if err != nil {
		return Tokens{}, err
	}
	if _, err := store.Exec(ctx, "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", userID, refreshHash, now.Add(service.refreshTTL)); err != nil {
		return Tokens{}, fmt.Errorf("store refresh token: %w", err)
	}
	return Tokens{AccessToken: accessToken, RefreshToken: refreshToken, ExpiresIn: int64(time.Until(claims.ExpiresAt).Seconds())}, nil
}
