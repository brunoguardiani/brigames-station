package httpserver

import (
	"net/http"

	"brigames-station/internal/auth"
	"brigames-station/internal/health"
	"brigames-station/internal/identity"
	"brigames-station/internal/invites"
	"brigames-station/internal/messages"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"brigames-station/internal/voice"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewHandler(pool *pgxpool.Pool, identityService *identity.Service, tokenManager *auth.TokenManager, serverService *servers.Service, messageService *messages.Service, inviteService *invites.Service, voiceService *voice.Service, hub *realtime.Hub) http.Handler {
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", gin.WrapF(health.Liveness))
	router.GET("/ready", gin.WrapF(health.Readiness(pool)))
	registerIdentityRoutes(router, identityService, tokenManager)
	registerServerRoutes(router, serverService, tokenManager, hub)
	registerMessageRoutes(router, messageService, tokenManager, hub)
	registerInviteRoutes(router, inviteService, tokenManager)
	if voiceService != nil {
		registerVoiceRoutes(router, voiceService, tokenManager)
	}
	router.GET("/ws", gin.WrapF(realtimeHandler(hub, tokenManager, serverService)))

	return router
}
