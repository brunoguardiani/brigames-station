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
	t.Setenv("LIVEKIT_URL", "ws://127.0.0.1:7880")
	t.Setenv("LIVEKIT_API_KEY", "devkey")
	t.Setenv("LIVEKIT_API_SECRET", "secret")

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

func TestLoadOwnerSeedConfig(t *testing.T) {
	t.Setenv("OWNER_USERNAME", "bruno_guardiani")
	t.Setenv("OWNER_EMAIL", "bruno@example.com")
	t.Setenv("OWNER_PASSWORD", "a secure test password")

	owner, err := LoadOwnerSeedConfig()
	if err != nil {
		t.Fatal(err)
	}
	if owner.Username != "bruno_guardiani" || owner.Email != "bruno@example.com" {
		t.Fatalf("owner = %+v, want configured username and email", owner)
	}
}

func TestLoadOwnerSeedConfigRejectsShortPassword(t *testing.T) {
	t.Setenv("OWNER_USERNAME", "bruno")
	t.Setenv("OWNER_EMAIL", "bruno@example.com")
	t.Setenv("OWNER_PASSWORD", "short")

	if _, err := LoadOwnerSeedConfig(); err == nil {
		t.Fatal("LoadOwnerSeedConfig() error = nil, want password validation error")
	}
}
