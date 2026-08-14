package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var ErrInvalidAccessToken = errors.New("invalid access token")

type Claims struct {
	Subject   int64
	TokenID   string
	IssuedAt  time.Time
	ExpiresAt time.Time
}

type TokenManager struct {
	secret   []byte
	issuer   string
	audience string
	ttl      time.Duration
}

func NewTokenManager(secret, issuer, audience string, ttl time.Duration) (*TokenManager, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT secret must contain at least 32 bytes")
	}
	if issuer == "" || audience == "" || ttl <= 0 {
		return nil, fmt.Errorf("JWT issuer, audience, and positive TTL are required")
	}
	return &TokenManager{secret: []byte(secret), issuer: issuer, audience: audience, ttl: ttl}, nil
}

func (manager *TokenManager) Issue(subject int64, now time.Time) (string, Claims, error) {
	if subject <= 0 {
		return "", Claims{}, fmt.Errorf("JWT subject must be positive")
	}
	tokenID, err := randomID()
	if err != nil {
		return "", Claims{}, err
	}
	claims := jwtClaims{
		Subject:   strconv.FormatInt(subject, 10),
		TokenID:   tokenID,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(manager.ttl).Unix(),
		Issuer:    manager.issuer,
		Audience:  manager.audience,
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", Claims{}, fmt.Errorf("encode JWT claims: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := header + "." + payload
	signature := manager.sign(signingInput)

	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), Claims{
		Subject: subject, TokenID: tokenID, IssuedAt: now, ExpiresAt: now.Add(manager.ttl),
	}, nil
}

func (manager *TokenManager) Validate(token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidAccessToken
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidAccessToken
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" || header.Type != "JWT" {
		return Claims{}, ErrInvalidAccessToken
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, manager.sign(parts[0]+"."+parts[1])) {
		return Claims{}, ErrInvalidAccessToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidAccessToken
	}
	var claims jwtClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidAccessToken
	}
	subject, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil || subject <= 0 || claims.TokenID == "" || claims.Issuer != manager.issuer || claims.Audience != manager.audience {
		return Claims{}, ErrInvalidAccessToken
	}
	issuedAt := time.Unix(claims.IssuedAt, 0)
	expiresAt := time.Unix(claims.ExpiresAt, 0)
	if !expiresAt.After(now) || issuedAt.After(now.Add(time.Minute)) || !expiresAt.After(issuedAt) {
		return Claims{}, ErrInvalidAccessToken
	}
	return Claims{Subject: subject, TokenID: claims.TokenID, IssuedAt: issuedAt, ExpiresAt: expiresAt}, nil
}

type jwtClaims struct {
	Subject   string `json:"sub"`
	TokenID   string `json:"jti"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	Issuer    string `json:"iss"`
	Audience  string `json:"aud"`
}

func (manager *TokenManager) sign(value string) []byte {
	signer := hmac.New(sha256.New, manager.secret)
	signer.Write([]byte(value))
	return signer.Sum(nil)
}

func randomID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate JWT ID: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
