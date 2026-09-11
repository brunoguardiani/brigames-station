package identity

import (
	"strings"
	"testing"
)

func TestAvatarIDPattern(t *testing.T) {
	for _, avatarID := range []string{"icon_01", "icon_09", "icon_10", "icon_17", "icon_99", "icon_100", "icon_999"} {
		if !avatarIDPattern.MatchString(avatarID) {
			t.Errorf("avatarIDPattern.MatchString(%q) = false, want true", avatarID)
		}
	}
	for _, avatarID := range []string{"", "icon_00", "icon_1", "icon_000", "icon_1000", "../icon_01", "icon_01.png"} {
		if avatarIDPattern.MatchString(avatarID) {
			t.Errorf("avatarIDPattern.MatchString(%q) = true, want false", avatarID)
		}
	}
}

func TestUpdatePasswordValidation(t *testing.T) {
	service := &Service{}
	err := service.UpdatePassword(t.Context(), 1, "current-secret", "short")
	if err == nil || err.Error() != "password must contain at least 12 characters" {
		t.Fatalf("UpdatePassword() error = %v, want password length message", err)
	}
}

func TestUpdateProfileValidation(t *testing.T) {
	service := &Service{}
	for _, testCase := range []struct {
		name     string
		username *string
		email    *string
		wantMsg  string
	}{
		{name: "short username", username: &[]string{"ab"}[0], email: nil, wantMsg: "username must contain between 3 and 32 characters"},
		{name: "long username", username: &[]string{strings.Repeat("a", 33)}[0], email: nil, wantMsg: "username must contain between 3 and 32 characters"},
		{name: "invalid email", username: nil, email: &[]string{"not-an-email"}[0], wantMsg: "email must be valid"},
		{name: "email with display name", username: nil, email: &[]string{"Shadys <shadys@example.com>"}[0], wantMsg: "email must be valid"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.UpdateProfile(t.Context(), 1, testCase.username, testCase.email)
			if err == nil || err.Error() != testCase.wantMsg {
				t.Fatalf("UpdateProfile() error = %v, want %q", err, testCase.wantMsg)
			}
		})
	}
}
