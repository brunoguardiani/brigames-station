package identity

import "errors"

var (
	ErrRegistrationDisabled = errors.New("registration is disabled")
	ErrConflict             = errors.New("username or email already exists")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrInvalidRefreshToken  = errors.New("invalid refresh token")
	ErrInvalidAvatar        = errors.New("invalid avatar")
)

type User struct {
	ID       int64   `json:"id"`
	Username string  `json:"username"`
	Email    string  `json:"email"`
	Role     string  `json:"role"`
	AvatarID *string `json:"avatar_id"`
}

type Tokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}
