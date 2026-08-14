package identity

import (
	"encoding/json"
	"testing"
)

func TestTokensJSONMatchesHTTPContract(t *testing.T) {
	tokens := Tokens{AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 900}

	body, err := json.Marshal(tokens)
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"access_token", "refresh_token", "expires_in"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing JSON key %q in %s", key, body)
		}
	}
}

func TestUserJSONMatchesHTTPContract(t *testing.T) {
	user := User{ID: 1, Username: "owner", Email: "owner@example.test", Role: "owner"}

	body, err := json.Marshal(user)
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "username", "email", "role"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("missing JSON key %q in %s", key, body)
		}
	}
}
