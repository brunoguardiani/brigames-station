package auth

import (
	"bytes"
	"testing"
)

func TestNewRefreshToken(t *testing.T) {
	token, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("refresh token is empty")
	}
	if !bytes.Equal(hash, HashRefreshToken(token)) {
		t.Fatal("refresh token hash does not match token")
	}
}
