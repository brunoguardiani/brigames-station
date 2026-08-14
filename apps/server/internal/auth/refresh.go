package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

const refreshTokenBytes = 32

func NewRefreshToken() (string, []byte, error) {
	bytes := make([]byte, refreshTokenBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, fmt.Errorf("generate refresh token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	return token, HashRefreshToken(token), nil
}

func HashRefreshToken(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}
