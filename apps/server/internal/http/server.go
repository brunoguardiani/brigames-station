package httpserver

import (
	"net/http"

	"brigames-station/internal/health"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewHandler(pool *pgxpool.Pool) http.Handler {
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", gin.WrapF(health.Liveness))
	router.GET("/ready", gin.WrapF(health.Readiness(pool)))

	return router
}
