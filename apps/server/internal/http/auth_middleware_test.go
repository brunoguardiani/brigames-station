package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"brigames-station/internal/auth"
	"github.com/gin-gonic/gin"
)

func TestRequireJWTRejectsMissingAndInvalidTokens(t *testing.T) {
	manager, err := auth.NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/protected", requireJWT(manager), func(context *gin.Context) {
		context.Status(http.StatusNoContent)
	})

	for _, authorization := range []string{"", "Bearer invalid"} {
		request := httptest.NewRequest(http.MethodGet, "/protected", nil)
		if authorization != "" {
			request.Header.Set("Authorization", authorization)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	}
}

func TestRequireJWTMakesUserIDAvailable(t *testing.T) {
	manager, err := auth.NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := manager.Issue(42, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/protected", requireJWT(manager), func(context *gin.Context) {
		userID, ok := authenticatedUserID(context)
		if !ok || userID != 42 {
			context.Status(http.StatusInternalServerError)
			return
		}
		context.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/protected", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}
