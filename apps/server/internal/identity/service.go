package identity

import (
	"time"

	"brigames-station/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool                *pgxpool.Pool
	tokens              *auth.TokenManager
	registrationEnabled bool
	refreshTTL          time.Duration
}

func New(pool *pgxpool.Pool, tokens *auth.TokenManager, registrationEnabled bool, refreshTTL time.Duration) *Service {
	return &Service{
		pool: pool,
		tokens: tokens,
		registrationEnabled: registrationEnabled,
		refreshTTL: refreshTTL,
	}
}

func (service *Service) RegistrationEnabled() bool {
	return service.registrationEnabled
}

func (service *Service) Pool() *pgxpool.Pool {
	return service.pool
}
