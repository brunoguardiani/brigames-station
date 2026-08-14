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
	server := httptest.NewServer(realtimeHandler(hub, tokens))
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
