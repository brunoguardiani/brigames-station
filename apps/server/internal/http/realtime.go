package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http"
	"time"
)

func realtimeHandler(hub *realtime.Hub, tokens *auth.TokenManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, e := websocket.Accept(w, r, nil)
		if e != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(4 << 10)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, data, e := conn.Read(ctx)
		if e != nil {
			return
		}
		var hello struct {
			Type        string `json:"type"`
			AccessToken string `json:"access_token"`
		}
		if json.Unmarshal(data, &hello) != nil || hello.Type != "authenticate" {
			return
		}
		claims, e := tokens.Validate(hello.AccessToken, time.Now().UTC())
		if e != nil {
			return
		}
		unregister := hub.Register(claims.Subject, conn)
		defer unregister()
		_ = conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"authenticated"}`))
		for {
			if _, _, e = conn.Read(context.Background()); e != nil {
				return
			}
		}
	}
}
