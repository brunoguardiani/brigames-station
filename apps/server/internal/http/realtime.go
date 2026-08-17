package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http"
	"time"
)

func realtimeHandler(hub *realtime.Hub, tokens *auth.TokenManager, serverService *servers.Service) http.HandlerFunc {
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
		wasOffline, unregister := hub.Register(claims.Subject, conn)
		if wasOffline && serverService != nil {
			publishPresence(r.Context(), hub, serverService, claims.Subject, true)
		}
		defer func() {
			result := unregister()
			if serverService == nil {
				return
			}
			if result.VoicePresence != nil {
				memberIDs, err := serverService.MemberIDs(context.Background(), result.VoicePresence.ServerID)
				if err == nil {
					publishVoicePresenceChange(hub, memberIDs, result.VoicePresence.ServerID, claims.Subject, nil)
				}
			}
			if result.WentOffline {
				publishPresence(context.Background(), hub, serverService, claims.Subject, false)
			}
		}()
		_ = conn.Write(context.Background(), websocket.MessageText, []byte(`{"type":"authenticated"}`))
		for {
			if _, _, e = conn.Read(context.Background()); e != nil {
				return
			}
		}
	}
}

func publishPresence(ctx context.Context, hub *realtime.Hub, service *servers.Service, userID int64, online bool) {
	memberIDs, err := service.SharedMemberIDs(ctx, userID)
	if err != nil {
		return
	}
	hub.Publish(memberIDs, realtime.Event{Type: "presence.changed", Data: map[string]any{"user_id": userID, "online": online}})
}
