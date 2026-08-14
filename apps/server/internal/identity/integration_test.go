package identity_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"brigames-station/internal/auth"
	"brigames-station/internal/database"
	httpserver "brigames-station/internal/http"
	"brigames-station/internal/identity"
)

func TestIdentityLifecycle(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for identity integration test")
	}

	ctx := context.Background()
	pool, err := database.NewPool(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	suffix := time.Now().UTC().Format("20060102150405.000000000")
	username := "itest_" + suffix
	email := username + "@example.test"
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, "DELETE FROM users WHERE username = $1", username); err != nil {
			t.Errorf("delete test user: %v", err)
		}
	})

	tokenManager, err := auth.NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	service := identity.New(pool, tokenManager, true, 30*24*time.Hour)
	password := "integration-test-password"

	user, err := service.Register(ctx, username, email, password)
	if err != nil {
		t.Fatal(err)
	}
	if user.Role != "member" {
		t.Fatalf("role = %q, want member", user.Role)
	}
	if _, err := service.Register(ctx, username, email, password); !errors.Is(err, identity.ErrConflict) {
		t.Fatalf("duplicate registration error = %v, want ErrConflict", err)
	}

	login, err := service.Login(ctx, username, password)
	if err != nil {
		t.Fatal(err)
	}
	if login.AccessToken == "" || login.RefreshToken == "" || login.ExpiresIn <= 0 {
		t.Fatal("login did not issue a complete token pair")
	}
	if _, err := service.Login(ctx, email, password); err != nil {
		t.Fatalf("email login: %v", err)
	}
	if _, err := service.Login(ctx, username, "wrong password"); !errors.Is(err, identity.ErrInvalidCredentials) {
		t.Fatalf("invalid password error = %v, want ErrInvalidCredentials", err)
	}

	rotated, err := service.Refresh(ctx, login.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.RefreshToken == login.RefreshToken {
		t.Fatal("refresh token was not rotated")
	}
	if _, err := service.Refresh(ctx, login.RefreshToken); !errors.Is(err, identity.ErrInvalidRefreshToken) {
		t.Fatalf("reused refresh token error = %v, want ErrInvalidRefreshToken", err)
	}
	if err := service.Logout(ctx, rotated.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Refresh(ctx, rotated.RefreshToken); !errors.Is(err, identity.ErrInvalidRefreshToken) {
		t.Fatalf("revoked refresh token error = %v, want ErrInvalidRefreshToken", err)
	}

	router := httpserver.NewHandler(pool, service, tokenManager)
	request := httptest.NewRequest(http.MethodGet, "/me", nil)
	request.Header.Set("Authorization", "Bearer "+login.AccessToken)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("/me status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	missingToken := httptest.NewRequest(http.MethodGet, "/me", nil)
	missingRecorder := httptest.NewRecorder()
	router.ServeHTTP(missingRecorder, missingToken)
	if missingRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("/me without token status = %d, want %d", missingRecorder.Code, http.StatusUnauthorized)
	}

	if _, err := service.CurrentUser(ctx, user.ID); err != nil {
		t.Fatal(fmt.Errorf("current user: %w", err))
	}
}

func TestRegistrationDisabled(t *testing.T) {
	service := identity.New(nil, nil, false, time.Hour)
	if _, err := service.Register(context.Background(), "member", "member@example.test", "a valid password"); !errors.Is(err, identity.ErrRegistrationDisabled) {
		t.Fatalf("registration disabled error = %v, want ErrRegistrationDisabled", err)
	}
}
