package messages

import "testing"

func TestMessageValidation(t *testing.T) {
	if _, err := New(nil).Create(t.Context(), 1, 1, "   "); err == nil {
		t.Fatal("empty message must be rejected before database access")
	}
	if _, err := New(nil).Create(t.Context(), 1, 1, string(make([]byte, 4001))); err == nil {
		t.Fatal("oversized message must be rejected before database access")
	}
}
