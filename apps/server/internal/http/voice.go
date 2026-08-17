package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"brigames-station/internal/voice"
	"bytes"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
)

func registerVoiceRoutes(r *gin.Engine, s *voice.Service, t *auth.TokenManager, serverService *servers.Service, hub *realtime.Hub) {
	g := r.Group("/voice")
	g.Use(requireJWT(t))
	g.POST("/channels/:channelId/token", func(c *gin.Context) {
		id, e := strconv.ParseInt(c.Param("channelId"), 10, 64)
		if e != nil || id <= 0 {
			errorResponse(c, http.StatusBadRequest, "validation_error", "channelId must be a positive integer.")
			return
		}
		join, e := s.Join(c.Request.Context(), requiredUserID(c), id)
		if errors.Is(e, voice.ErrNotFound) {
			errorResponse(c, http.StatusNotFound, "voice_channel_not_found", "Voice channel was not found.")
			return
		}
		if e != nil {
			errorResponse(c, http.StatusInternalServerError, "voice_token_failed", "Unable to create voice token.")
			return
		}
		c.JSON(http.StatusOK, join)
	})
	g.PUT("/presence", func(c *gin.Context) {
		var request map[string]json.RawMessage
		if c.ShouldBindJSON(&request) != nil {
			errorResponse(c, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		rawChannelID, exists := request["channel_id"]
		if !exists {
			errorResponse(c, http.StatusBadRequest, "validation_error", "channel_id is required.")
			return
		}

		userID := requiredUserID(c)
		if bytes.Equal(bytes.TrimSpace(rawChannelID), []byte("null")) {
			presence, exists := hub.GetVoicePresence(userID)
			if !exists {
				c.Status(http.StatusNoContent)
				return
			}
			memberIDs, err := serverService.MemberIDs(c.Request.Context(), presence.ServerID)
			if err != nil {
				errorResponse(c, http.StatusInternalServerError, "voice_presence_failed", "Unable to update voice presence.")
				return
			}
			if cleared, clearedPresence := hub.ClearVoicePresence(userID); clearedPresence {
				publishVoicePresenceChange(hub, memberIDs, cleared.ServerID, userID, nil)
			}
			c.Status(http.StatusNoContent)
			return
		}

		var channelID int64
		if json.Unmarshal(rawChannelID, &channelID) != nil || channelID <= 0 {
			errorResponse(c, http.StatusBadRequest, "validation_error", "channel_id must be a positive integer or null.")
			return
		}
		serverID, err := s.AuthorizeChannel(c.Request.Context(), userID, channelID)
		if errors.Is(err, voice.ErrNotFound) {
			errorResponse(c, http.StatusNotFound, "voice_channel_not_found", "Voice channel was not found.")
			return
		}
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, "voice_presence_failed", "Unable to update voice presence.")
			return
		}
		memberIDs, err := serverService.MemberIDs(c.Request.Context(), serverID)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, "voice_presence_failed", "Unable to update voice presence.")
			return
		}
		previous, changed := hub.SetVoicePresence(userID, realtime.VoicePresence{ServerID: serverID, ChannelID: channelID})
		if changed {
			if previous != nil && previous.ServerID != serverID {
				if previousMemberIDs, listErr := serverService.MemberIDs(c.Request.Context(), previous.ServerID); listErr == nil {
					publishVoicePresenceChange(hub, previousMemberIDs, previous.ServerID, userID, nil)
				}
			}
			publishVoicePresenceChange(hub, memberIDs, serverID, userID, &channelID)
		}
		c.Status(http.StatusNoContent)
	})
}

func publishVoicePresenceChange(hub *realtime.Hub, memberIDs []int64, serverID, userID int64, channelID *int64) {
	hub.Publish(memberIDs, realtime.Event{Type: "voice.presence.changed", Data: map[string]any{
		"server_id":  serverID,
		"user_id":    userID,
		"channel_id": channelID,
	}})
}
