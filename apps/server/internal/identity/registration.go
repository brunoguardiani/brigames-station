package identity

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"brigames-station/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (service *Service) Register(ctx context.Context, username, email, password string) (User, error) {
	if !service.registrationEnabled {
		return User{}, ErrRegistrationDisabled
	}
	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)
	if len(username) < 3 || len(username) > 32 {
		return User{}, fmt.Errorf("username must contain between 3 and 32 characters")
	}
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return User{}, fmt.Errorf("email must be valid")
	}
	if len(password) < 12 {
		return User{}, fmt.Errorf("password must contain at least 12 characters")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return User{}, fmt.Errorf("hash password: %w", err)
	}

	var user User
	err = service.pool.QueryRow(ctx, "INSERT INTO users (username, email, password_hash, role_id) SELECT $1, $2, $3, id FROM roles WHERE key = 'member' RETURNING id, username, email, (SELECT key FROM roles WHERE roles.id = users.role_id)", username, email, hash).Scan(&user.ID, &user.Username, &user.Email, &user.Role)
	if err == nil {
		return user, nil
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return User{}, ErrConflict
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, fmt.Errorf("member role is missing")
	}
	return User{}, fmt.Errorf("create member: %w", err)
}
