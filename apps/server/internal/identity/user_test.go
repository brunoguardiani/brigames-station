package identity

import "testing"

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
