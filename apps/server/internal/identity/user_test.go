package identity

import "testing"

func TestAvatarIDPattern(t *testing.T) {
	for _, avatarID := range []string{"icon_01", "icon_09", "icon_10", "icon_15"} {
		if !avatarIDPattern.MatchString(avatarID) {
			t.Errorf("avatarIDPattern.MatchString(%q) = false, want true", avatarID)
		}
	}
	for _, avatarID := range []string{"", "icon_00", "icon_16", "icon_1", "../icon_01", "icon_01.png"} {
		if avatarIDPattern.MatchString(avatarID) {
			t.Errorf("avatarIDPattern.MatchString(%q) = true, want false", avatarID)
		}
	}
}
