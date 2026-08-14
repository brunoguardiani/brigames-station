package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	Auth        AuthConfig
}

type AuthConfig struct {
	RegistrationEnabled bool
	JWTSecret           string
	JWTIssuer           string
	JWTAudience         string
	AccessTokenTTL      time.Duration
	RefreshTokenTTL     time.Duration
}

func Load() (Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}

	httpAddr := os.Getenv("HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8080"
	}

	auth, err := loadAuthConfig()
	if err != nil {
		return Config{}, err
	}

	return Config{
		HTTPAddr:    httpAddr,
		DatabaseURL: databaseURL,
		Auth:        auth,
	}, nil
}

func loadAuthConfig() (AuthConfig, error) {
	registrationEnabled, err := boolEnv("AUTH_REGISTRATION_ENABLED", false)
	if err != nil {
		return AuthConfig{}, err
	}

	secret := os.Getenv("AUTH_JWT_SECRET")
	if len(secret) < 32 {
		return AuthConfig{}, fmt.Errorf("AUTH_JWT_SECRET must contain at least 32 bytes")
	}

	issuer := os.Getenv("AUTH_JWT_ISSUER")
	if issuer == "" {
		return AuthConfig{}, fmt.Errorf("AUTH_JWT_ISSUER is required")
	}
	audience := os.Getenv("AUTH_JWT_AUDIENCE")
	if audience == "" {
		return AuthConfig{}, fmt.Errorf("AUTH_JWT_AUDIENCE is required")
	}

	accessTokenTTL, err := durationEnv("AUTH_ACCESS_TOKEN_TTL", 15*time.Minute)
	if err != nil {
		return AuthConfig{}, err
	}
	refreshTokenTTL, err := durationEnv("AUTH_REFRESH_TOKEN_TTL", 30*24*time.Hour)
	if err != nil {
		return AuthConfig{}, err
	}

	return AuthConfig{
		RegistrationEnabled: registrationEnabled,
		JWTSecret:           secret,
		JWTIssuer:           issuer,
		JWTAudience:         audience,
		AccessTokenTTL:      accessTokenTTL,
		RefreshTokenTTL:     refreshTokenTTL,
	}, nil
}

func boolEnv(name string, defaultValue bool) (bool, error) {
	value := os.Getenv(name)
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %w", name, err)
	}
	return parsed, nil
}

func durationEnv(name string, defaultValue time.Duration) (time.Duration, error) {
	value := os.Getenv(name)
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		if err == nil {
			err = fmt.Errorf("must be greater than zero")
		}
		return 0, fmt.Errorf("%s must be a positive duration: %w", name, err)
	}
	return parsed, nil
}
