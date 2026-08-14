package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type Status struct {
	Status string `json:"status"`
}

type Pinger interface {
	Ping(context.Context) error
}

func Liveness(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "alive"})
}

func Readiness(pool Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, Status{Status: "not_ready"})
			return
		}

		writeJSON(w, http.StatusOK, Status{Status: "ready"})
	}
}

func writeJSON(w http.ResponseWriter, statusCode int, value Status) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(value)
}
