package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/voice"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
)

func registerVoiceRoutes(r *gin.Engine, s *voice.Service, t *auth.TokenManager) {
	g := r.Group("/voice/channels")
	g.Use(requireJWT(t))
	g.POST("/:channelId/token", func(c *gin.Context) {
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
}
