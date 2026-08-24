package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"log/slog"
	"net/http"
	"time"
)

type webRTCSignal struct {
	ChannelID int64           `json:"channel_id"`
	ToUserID  int64           `json:"to_user_id"`
	Kind      string          `json:"kind"`
	SessionID string          `json:"session_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

func (s webRTCSignal) valid() bool {
	if s.ChannelID <= 0 || s.ToUserID <= 0 || len(s.Payload) == 0 || !json.Valid(s.Payload) {
		return false
	}
	switch s.Kind {
	case "offer", "answer", "ice":
		return validWebRTCSessionID(s.SessionID)
	case "media.available", "media.unavailable", "media.query", "media.watch", "media.unwatch":
		return s.SessionID == ""
	default:
		return false
	}
}

func validWebRTCSessionID(sessionID string) bool {
	if len(sessionID) == 0 || len(sessionID) > 64 {
		return false
	}
	for _, character := range []byte(sessionID) {
		if (character < 'a' || character > 'z') &&
			(character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') &&
			character != '-' && character != '_' {
			return false
		}
	}
	return true
}

func webRTCSignalAllowed(hub *realtime.Hub, fromUserID int64, signal webRTCSignal) bool {
	if !signal.valid() || signal.ToUserID == fromUserID {
		return false
	}
	fromPresence, connected := hub.GetVoicePresence(fromUserID)
	if !connected || fromPresence.ChannelID != signal.ChannelID {
		return false
	}
	toPresence, connected := hub.GetVoicePresence(signal.ToUserID)
	return connected && toPresence.ServerID == fromPresence.ServerID && toPresence.ChannelID == fromPresence.ChannelID
}

func realtimeHandler(hub *realtime.Hub, tokens *auth.TokenManager, serverService *servers.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, e := websocket.Accept(w, r, nil)
		if e != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(64 << 10)
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
			_, data, e := conn.Read(context.Background())
			if e != nil {
				return
			}
			var message struct {
				Type string          `json:"type"`
				Data json.RawMessage `json:"data"`
			}
			if json.Unmarshal(data, &message) != nil || message.Type != "webrtc.signal" {
				continue
			}
			var signal webRTCSignal
			if json.Unmarshal(message.Data, &signal) != nil || !webRTCSignalAllowed(hub, claims.Subject, signal) {
				slog.Warn("reject WebRTC signal", "from_user_id", claims.Subject)
				continue
			}
			slog.Debug("relay WebRTC signal", "from_user_id", claims.Subject, "to_user_id", signal.ToUserID, "channel_id", signal.ChannelID, "kind", signal.Kind)
			hub.Publish([]int64{signal.ToUserID}, realtime.Event{Type: "webrtc.signal", Data: map[string]any{
				"channel_id":   signal.ChannelID,
				"from_user_id": claims.Subject,
				"kind":         signal.Kind,
				"session_id":   signal.SessionID,
				"payload":      signal.Payload,
			}})
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
