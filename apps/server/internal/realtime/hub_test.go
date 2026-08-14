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
	if wentOffline := unregisterFirst(); wentOffline || !hub.IsOnline(42) {
		t.Fatal("user should remain online while another connection exists")
	}
	if wentOffline := unregisterSecond(); !wentOffline || hub.IsOnline(42) {
		t.Fatal("last connection should mark the user offline")
	}
}
