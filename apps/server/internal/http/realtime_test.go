package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestRealtimeHandlerAuthenticatesAndDeliversEvents(t *testing.T) {
	t.Parallel()

	tokens, err := auth.NewTokenManager("01234567890123456789012345678901", "brigames-station", "desktop", time.Hour)
	if err != nil {
		t.Fatalf("new token manager: %v", err)
	}
	accessToken, _, err := tokens.Issue(42, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}
	hub := realtime.NewHub()
	server := httptest.NewServer(realtimeHandler(hub, tokens, nil))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer connection.CloseNow()

	hello, err := json.Marshal(map[string]string{"type": "authenticate", "access_token": accessToken})
	if err != nil {
		t.Fatalf("marshal authentication: %v", err)
	}
	if err := connection.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatalf("write authentication: %v", err)
	}
	_, body, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("read authentication response: %v", err)
	}
	if string(body) != `{"type":"authenticated"}` {
		t.Fatalf("authentication response = %s", body)
	}

	hub.Publish([]int64{42}, realtime.Event{Type: "message.created", Data: map[string]any{"id": 99}})
	_, body, err = connection.Read(ctx)
	if err != nil {
		t.Fatalf("read realtime event: %v", err)
	}
	var event struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		t.Fatalf("decode realtime event: %v", err)
	}
	if event.Type != "message.created" || event.Data["id"] != float64(99) {
		t.Fatalf("unexpected realtime event: %s", body)
	}

	receiverToken, _, err := tokens.Issue(43, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue receiver access token: %v", err)
	}
	receiver, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial receiver websocket: %v", err)
	}
	defer receiver.CloseNow()
	receiverHello, err := json.Marshal(map[string]string{"type": "authenticate", "access_token": receiverToken})
	if err != nil {
		t.Fatalf("marshal receiver authentication: %v", err)
	}
	if err := receiver.Write(ctx, websocket.MessageText, receiverHello); err != nil {
		t.Fatalf("write receiver authentication: %v", err)
	}
	if _, body, err = receiver.Read(ctx); err != nil || string(body) != `{"type":"authenticated"}` {
		t.Fatalf("receiver authentication response = %s, error = %v", body, err)
	}

	hub.Publish([]int64{42, 43}, realtime.Event{Type: "message.created", Data: map[string]any{"id": 100}})
	for _, client := range []*websocket.Conn{connection, receiver} {
		_, body, err = client.Read(ctx)
		if err != nil {
			t.Fatalf("read delivery for connected client: %v", err)
		}
		if err := json.Unmarshal(body, &event); err != nil || event.Type != "message.created" || event.Data["id"] != float64(100) {
			t.Fatalf("unexpected delivery: %s, error = %v", body, err)
		}
	}
}

func TestWebRTCSignalValidation(t *testing.T) {
	t.Parallel()

	for _, kind := range []string{"offer", "answer", "ice", "media.available", "media.unavailable", "media.query", "media.watch", "media.unwatch"} {
		t.Run(kind, func(t *testing.T) {
			t.Parallel()
			sessionID := ""
			if kind == "offer" || kind == "answer" || kind == "ice" {
				sessionID = "session-1234_abcd"
			}
			signal := webRTCSignal{
				ChannelID: 7,
				ToUserID:  43,
				Kind:      kind,
				SessionID: sessionID,
				Payload:   json.RawMessage(`{"kind":"screen"}`),
			}
			if !signal.valid() {
				t.Fatalf("valid signal kind %q was rejected", kind)
			}
		})
	}

	tests := []struct {
		name   string
		signal webRTCSignal
	}{
		{
			name:   "unknown kind",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "media.unsupported", Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "missing payload",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "media.watch"},
		},
		{
			name:   "malformed payload",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "media.watch", Payload: json.RawMessage(`{"kind":`)},
		},
		{
			name:   "invalid channel",
			signal: webRTCSignal{ToUserID: 43, Kind: "media.watch", Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "invalid recipient",
			signal: webRTCSignal{ChannelID: 7, Kind: "media.watch", Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "missing negotiation session",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "offer", Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "unsafe negotiation session",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "ice", SessionID: "session with spaces", Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "oversized negotiation session",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "answer", SessionID: strings.Repeat("a", 65), Payload: json.RawMessage(`{}`)},
		},
		{
			name:   "unexpected media session",
			signal: webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "media.watch", SessionID: "session-1234", Payload: json.RawMessage(`{}`)},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if test.signal.valid() {
				t.Fatalf("invalid signal was accepted: %#v", test.signal)
			}
		})
	}
}

func TestWebRTCSignalAllowedRequiresSharedVoiceChannel(t *testing.T) {
	t.Parallel()

	newHub := func(receiverPresence realtime.VoicePresence) *realtime.Hub {
		hub := realtime.NewHub()
		hub.SetVoicePresence(42, realtime.VoicePresence{ServerID: 5, ChannelID: 7})
		hub.SetVoicePresence(43, receiverPresence)
		return hub
	}
	validSignal := webRTCSignal{ChannelID: 7, ToUserID: 43, Kind: "media.watch", Payload: json.RawMessage(`{"kind":"screen"}`)}

	if !webRTCSignalAllowed(newHub(realtime.VoicePresence{ServerID: 5, ChannelID: 7}), 42, validSignal) {
		t.Fatal("signal between users in the same voice channel was rejected")
	}
	if webRTCSignalAllowed(newHub(realtime.VoicePresence{ServerID: 5, ChannelID: 7}), 42, webRTCSignal{
		ChannelID: 7,
		ToUserID:  42,
		Kind:      "media.watch",
		Payload:   json.RawMessage(`{"kind":"screen"}`),
	}) {
		t.Fatal("self-directed signal was accepted")
	}
	if webRTCSignalAllowed(newHub(realtime.VoicePresence{ServerID: 5, ChannelID: 8}), 42, validSignal) {
		t.Fatal("signal to a user in another voice channel was accepted")
	}
	if webRTCSignalAllowed(newHub(realtime.VoicePresence{ServerID: 6, ChannelID: 7}), 42, validSignal) {
		t.Fatal("signal to a user in another server was accepted")
	}
}

func TestRealtimeHandlerRelaysWebRTCSignalWithinVoiceChannel(t *testing.T) {
	t.Parallel()

	tokens, err := auth.NewTokenManager("01234567890123456789012345678901", "brigames-station", "desktop", time.Hour)
	if err != nil {
		t.Fatalf("new token manager: %v", err)
	}
	hub := realtime.NewHub()
	server := httptest.NewServer(realtimeHandler(hub, tokens, nil))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sender := authenticatedRealtimeClient(t, ctx, server.URL, tokens, 42)
	defer sender.CloseNow()
	receiver := authenticatedRealtimeClient(t, ctx, server.URL, tokens, 43)
	defer receiver.CloseNow()
	hub.SetVoicePresence(42, realtime.VoicePresence{ServerID: 5, ChannelID: 7})
	hub.SetVoicePresence(43, realtime.VoicePresence{ServerID: 5, ChannelID: 7})

	message := map[string]any{
		"type": "webrtc.signal",
		"data": map[string]any{
			"channel_id": 7,
			"to_user_id": 43,
			"kind":       "offer",
			"session_id": "session-1234_abcd",
			"payload": map[string]any{
				"kind":        "screen",
				"description": map[string]string{"type": "offer", "sdp": "test-sdp"},
			},
		},
	}
	body, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal WebRTC signal: %v", err)
	}
	if err := sender.Write(ctx, websocket.MessageText, body); err != nil {
		t.Fatalf("write WebRTC signal: %v", err)
	}
	_, body, err = receiver.Read(ctx)
	if err != nil {
		t.Fatalf("read relayed WebRTC signal: %v", err)
	}
	var event struct {
		Type string `json:"type"`
		Data struct {
			ChannelID  int64  `json:"channel_id"`
			FromUserID int64  `json:"from_user_id"`
			Kind       string `json:"kind"`
			SessionID  string `json:"session_id"`
			Payload    struct {
				Kind string `json:"kind"`
			} `json:"payload"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		t.Fatalf("decode relayed WebRTC signal: %v", err)
	}
	if event.Type != "webrtc.signal" || event.Data.ChannelID != 7 || event.Data.FromUserID != 42 || event.Data.Kind != "offer" || event.Data.SessionID != "session-1234_abcd" || event.Data.Payload.Kind != "screen" {
		t.Fatalf("unexpected relayed WebRTC signal: %s", body)
	}
}

func authenticatedRealtimeClient(t *testing.T, ctx context.Context, serverURL string, tokens *auth.TokenManager, userID int64) *websocket.Conn {
	t.Helper()
	accessToken, _, err := tokens.Issue(userID, time.Now().UTC())
	if err != nil {
		t.Fatalf("issue access token for user %d: %v", userID, err)
	}
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(serverURL, "http"), nil)
	if err != nil {
		t.Fatalf("dial websocket for user %d: %v", userID, err)
	}
	hello, err := json.Marshal(map[string]string{"type": "authenticate", "access_token": accessToken})
	if err != nil {
		connection.CloseNow()
		t.Fatalf("marshal authentication for user %d: %v", userID, err)
	}
	if err := connection.Write(ctx, websocket.MessageText, hello); err != nil {
		connection.CloseNow()
		t.Fatalf("write authentication for user %d: %v", userID, err)
	}
	_, body, err := connection.Read(ctx)
	if err != nil || string(body) != `{"type":"authenticated"}` {
		connection.CloseNow()
		t.Fatalf("authentication response for user %d = %s, error = %v", userID, body, err)
	}
	return connection
}
