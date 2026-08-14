package httpserver

import (
	"net/http"

	"brigames-station/internal/health"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewHandler(pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Liveness)
	mux.HandleFunc("GET /ready", health.Readiness(pool))

	return mux
}
