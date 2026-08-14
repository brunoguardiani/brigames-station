package identity

import "errors"

var (
	ErrRegistrationDisabled = errors.New("registration is disabled")
	ErrConflict             = errors.New("username or email already exists")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrInvalidRefreshToken  = errors.New("invalid refresh token")
)

type User struct {
	ID       int64
	Username string
	Email    string
	Role     string
}

type Tokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
}
