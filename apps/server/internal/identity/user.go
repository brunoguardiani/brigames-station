package identity

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"

	"brigames-station/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var avatarIDPattern = regexp.MustCompile(`^icon_(0[1-9]|[1-9][0-9]{1,2})$`)

var validStatuses = map[string]bool{"online": true, "idle": true, "invisible": true}

func (service *Service) CurrentUser(ctx context.Context, userID int64) (User, error) {
	var user User
	err := service.pool.QueryRow(ctx, "SELECT users.id, users.username, users.email, roles.key, users.avatar_id, users.status FROM users JOIN roles ON roles.id = users.role_id WHERE users.id = $1", userID).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("find current user: %w", err)
	}
	return user, nil
}

func (service *Service) UpdateAvatar(ctx context.Context, userID int64, avatarID *string) (User, error) {
	if avatarID != nil && !avatarIDPattern.MatchString(*avatarID) {
		return User{}, ErrInvalidAvatar
	}
	var user User
	err := service.pool.QueryRow(ctx, "UPDATE users SET avatar_id = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username, email, (SELECT key FROM roles WHERE roles.id = users.role_id), avatar_id, status", userID, avatarID).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("update avatar: %w", err)
	}
	return user, nil
}

func (service *Service) UpdateProfile(ctx context.Context, userID int64, username, email *string) (User, error) {	if username != nil {
		trimmed := strings.TrimSpace(*username)
		username = &trimmed
		if len(trimmed) < 3 || len(trimmed) > 32 {
			return User{}, fmt.Errorf("username must contain between 3 and 32 characters")
		}
	}
	if email != nil {
		trimmed := strings.TrimSpace(*email)
		email = &trimmed
		address, err := mail.ParseAddress(trimmed)
		if err != nil || address.Address != trimmed {
			return User{}, fmt.Errorf("email must be valid")
		}
	}
	var user User
	err := service.pool.QueryRow(ctx, "UPDATE users SET username = COALESCE($2, username), email = COALESCE($3, email), updated_at = NOW() WHERE id = $1 RETURNING id, username, email, (SELECT key FROM roles WHERE roles.id = users.role_id), avatar_id, status", userID, username, email).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return User{}, ErrConflict
	}
	if err != nil {
		return User{}, fmt.Errorf("update profile: %w", err)
	}
	return user, nil
}

func (service *Service) UpdateStatus(ctx context.Context, userID int64, status string) (User, error) {
	if !validStatuses[status] {
		return User{}, ErrInvalidStatus
	}
	var user User
	err := service.pool.QueryRow(ctx, "UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username, email, (SELECT key FROM roles WHERE roles.id = users.role_id), avatar_id, status", userID, status).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("update status: %w", err)
	}
	return user, nil
}

func (service *Service) UpdatePassword(ctx context.Context, userID int64, currentPassword, newPassword string) error {
	if len(newPassword) < 12 {
		return fmt.Errorf("password must contain at least 12 characters")
	}
	var passwordHash string
	err := service.pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE id = $1", userID).Scan(&passwordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCredentials
	}
	if err != nil {
		return fmt.Errorf("find password: %w", err)
	}
	valid, err := auth.VerifyPassword(passwordHash, currentPassword)
	if err != nil || !valid {
		return ErrInvalidCredentials
	}
	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	_, err = service.pool.Exec(ctx, "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1", userID, hash)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	return nil
}
