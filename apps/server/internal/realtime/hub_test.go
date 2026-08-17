package realtime

import (
	"testing"

	"github.com/coder/websocket"
)

func TestHubTracksOnlineStateAcrossMultipleConnections(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	firstOnline, unregisterFirst := hub.Register(42, &websocket.Conn{})
	if !firstOnline || !hub.IsOnline(42) {
		t.Fatal("first connection should mark the user online")
	}

	secondOnline, unregisterSecond := hub.Register(42, &websocket.Conn{})
	if secondOnline {
		t.Fatal("additional connection should not mark the user online again")
	}
	if result := unregisterFirst(); result.WentOffline || !hub.IsOnline(42) {
		t.Fatal("user should remain online while another connection exists")
	}
	if result := unregisterSecond(); !result.WentOffline || hub.IsOnline(42) {
		t.Fatal("last connection should mark the user offline")
	}
}

func TestHubTracksAndClearsVoicePresence(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	presence := VoicePresence{ServerID: 7, ChannelID: 11}
	previous, changed := hub.SetVoicePresence(42, presence)
	if previous != nil || !changed {
		t.Fatalf("first SetVoicePresence() = (%#v, %t), want (nil, true)", previous, changed)
	}
	got, exists := hub.GetVoicePresence(42)
	if !exists || got != presence {
		t.Fatalf("GetVoicePresence() = (%#v, %t), want (%#v, true)", got, exists, presence)
	}
	previous, changed = hub.SetVoicePresence(42, presence)
	if previous == nil || *previous != presence || changed {
		t.Fatalf("unchanged SetVoicePresence() = (%#v, %t), want (%#v, false)", previous, changed, presence)
	}
	cleared, exists := hub.ClearVoicePresence(42)
	if !exists || cleared != presence {
		t.Fatalf("ClearVoicePresence() = (%#v, %t), want (%#v, true)", cleared, exists, presence)
	}
	if _, exists := hub.GetVoicePresence(42); exists {
		t.Fatal("voice presence should be absent after clear")
	}
	if _, exists := hub.ClearVoicePresence(42); exists {
		t.Fatal("clearing absent voice presence should be idempotent")
	}
}

func TestLastConnectionClearsVoicePresence(t *testing.T) {
	t.Parallel()

	hub := NewHub()
	_, unregisterFirst := hub.Register(42, &websocket.Conn{})
	_, unregisterSecond := hub.Register(42, &websocket.Conn{})
	presence := VoicePresence{ServerID: 7, ChannelID: 11}
	hub.SetVoicePresence(42, presence)

	if result := unregisterFirst(); result.WentOffline || result.VoicePresence != nil {
		t.Fatalf("first unregister result = %#v, want user and voice presence retained", result)
	}
	if _, exists := hub.GetVoicePresence(42); !exists {
		t.Fatal("voice presence should remain while another connection is online")
	}
	result := unregisterSecond()
	if !result.WentOffline || result.VoicePresence == nil || *result.VoicePresence != presence {
		t.Fatalf("last unregister result = %#v, want offline with %#v", result, presence)
	}
	if _, exists := hub.GetVoicePresence(42); exists {
		t.Fatal("last connection should clear voice presence")
	}
}
