package config

import "testing"

func TestLoadReadsAuthenticationConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("AUTH_REGISTRATION_ENABLED", "true")
	t.Setenv("AUTH_JWT_SECRET", "12345678901234567890123456789012")
	t.Setenv("AUTH_JWT_ISSUER", "brigames-station")
	t.Setenv("AUTH_JWT_AUDIENCE", "brigames-station-desktop")
	t.Setenv("AUTH_ACCESS_TOKEN_TTL", "15m")
	t.Setenv("AUTH_REFRESH_TOKEN_TTL", "720h")

	config, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !config.Auth.RegistrationEnabled {
		t.Fatal("RegistrationEnabled = false, want true")
	}
	if config.Auth.AccessTokenTTL.Minutes() != 15 {
		t.Fatalf("AccessTokenTTL = %s, want 15m", config.Auth.AccessTokenTTL)
	}
	if config.Auth.RefreshTokenTTL.Hours() != 720 {
		t.Fatalf("RefreshTokenTTL = %s, want 720h", config.Auth.RefreshTokenTTL)
	}
}

func TestLoadRejectsShortJWTSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("AUTH_JWT_SECRET", "too-short")
	t.Setenv("AUTH_JWT_ISSUER", "brigames-station")
	t.Setenv("AUTH_JWT_AUDIENCE", "brigames-station-desktop")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want short JWT secret error")
	}
}
