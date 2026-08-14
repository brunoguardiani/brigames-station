package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakePinger struct {
	err error
}

func (p fakePinger) Ping(context.Context) error {
	return p.err
}

func TestLiveness(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	Liveness(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	if got := response.Body.String(); got != "{\"status\":\"alive\"}\n" {
		t.Fatalf("body = %q", got)
	}
}

func TestReadiness(t *testing.T) {
	tests := []struct {
		name       string
		pingError  error
		statusCode int
		body       string
	}{
		{
			name:       "database available",
			statusCode: http.StatusOK,
			body:       "{\"status\":\"ready\"}\n",
		},
		{
			name:       "database unavailable",
			pingError:  errors.New("database unavailable"),
			statusCode: http.StatusServiceUnavailable,
			body:       "{\"status\":\"not_ready\"}\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/ready", nil)
			response := httptest.NewRecorder()

			Readiness(fakePinger{err: test.pingError})(response, request)

			if response.Code != test.statusCode {
				t.Fatalf("status code = %d, want %d", response.Code, test.statusCode)
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", got)
			}
			if got := response.Body.String(); got != test.body {
				t.Fatalf("body = %q, want %q", got, test.body)
			}
		})
	}
}
