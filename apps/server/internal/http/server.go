package httpserver

import (
	"net/http"

	"brigames-station/internal/auth"
	"brigames-station/internal/health"
	"brigames-station/internal/identity"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewHandler(pool *pgxpool.Pool, identityService *identity.Service, tokenManager *auth.TokenManager) http.Handler {
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", gin.WrapF(health.Liveness))
	router.GET("/ready", gin.WrapF(health.Readiness(pool)))
	registerIdentityRoutes(router, identityService, tokenManager)

	return router
}
