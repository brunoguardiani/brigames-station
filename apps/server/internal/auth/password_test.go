package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("a long local test password")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "a long local test password" {
		t.Fatal("password hash contains plaintext password")
	}

	valid, err := VerifyPassword(hash, "a long local test password")
	if err != nil {
		t.Fatal(err)
	}
	if !valid {
		t.Fatal("password verification = false, want true")
	}

	valid, err = VerifyPassword(hash, "incorrect password")
	if err != nil {
		t.Fatal(err)
	}
	if valid {
		t.Fatal("password verification = true, want false")
	}
}

func TestVerifyPasswordRejectsMalformedHash(t *testing.T) {
	if _, err := VerifyPassword("invalid", "password"); err == nil {
		t.Fatal("VerifyPassword() error = nil, want malformed-hash error")
	}
}
