package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTokenManagerIssuesAndValidatesAccessToken(t *testing.T) {
	manager, err := NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	token, issued, err := manager.Issue(42, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(strings.Split(token, ".")) != 3 {
		t.Fatal("access token is not a JWT")
	}

	claims, err := manager.Validate(token, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != 42 || claims.TokenID != issued.TokenID || !claims.ExpiresAt.Equal(issued.ExpiresAt) {
		t.Fatalf("claims = %+v, want subject 42 and issued metadata", claims)
	}
}

func TestTokenManagerRejectsInvalidAndExpiredTokens(t *testing.T) {
	manager, err := NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	token, _, err := manager.Issue(1, now)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := manager.Validate(token+"x", now); !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("tampered token error = %v, want ErrInvalidAccessToken", err)
	}
	if _, err := manager.Validate(token, now.Add(2*time.Minute)); !errors.Is(err, ErrInvalidAccessToken) {
		t.Fatalf("expired token error = %v, want ErrInvalidAccessToken", err)
	}
}
