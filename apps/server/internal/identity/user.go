package identity

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (service *Service) CurrentUser(ctx context.Context, userID int64) (User, error) {
	var user User
	err := service.pool.QueryRow(ctx, "SELECT users.id, users.username, users.email, roles.key FROM users JOIN roles ON roles.id = users.role_id WHERE users.id = $1", userID).Scan(&user.ID, &user.Username, &user.Email, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrInvalidCredentials
	}
	if err != nil {
		return User{}, fmt.Errorf("find current user: %w", err)
	}
	return user, nil
}
