package identity

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

var avatarIDPattern = regexp.MustCompile(`^icon_(0[1-9]|[1-9][0-9]{1,2})$`)

func (service *Service) CurrentUser(ctx context.Context, userID int64) (User, error) {
	var user User
	err := service.pool.QueryRow(ctx, "SELECT users.id, users.username, users.email, roles.key, users.avatar_id FROM users JOIN roles ON roles.id = users.role_id WHERE users.id = $1", userID).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID)
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
	err := service.pool.QueryRow(ctx, "UPDATE users SET avatar_id = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username, email, (SELECT key FROM roles WHERE roles.id = users.role_id), avatar_id", userID, avatarID).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.AvatarID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("update avatar: %w", err)
	}
	return user, nil
}
