package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/invites"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
)

func registerInviteRoutes(r *gin.Engine, s *invites.Service, t *auth.TokenManager) {
	p := r.Group("/servers")
	p.Use(requireJWT(t))
	p.POST("/:serverId/invites", func(c *gin.Context) {
		id, ok := serverIDFromPath(c)
		if !ok {
			return
		}
		i, e := s.Create(c.Request.Context(), requiredUserID(c), id)
		if e != nil {
			inviteError(c, e)
			return
		}
		c.JSON(http.StatusCreated, i)
	})
	p.POST("/:serverId/invites/:inviteId/revoke", func(c *gin.Context) {
		sid, ok := serverIDFromPath(c)
		if !ok {
			return
		}
		iid, e := strconv.ParseInt(c.Param("inviteId"), 10, 64)
		if e != nil || iid <= 0 {
			errorResponse(c, 400, "validation_error", "inviteId must be a positive integer.")
			return
		}
		if e = s.Revoke(c.Request.Context(), requiredUserID(c), sid, iid); e != nil {
			inviteError(c, e)
			return
		}
		c.Status(http.StatusNoContent)
	})
	j := r.Group("/invites")
	j.Use(requireJWT(t))
	j.POST("/:code/join", func(c *gin.Context) {
		sid, e := s.Join(c.Request.Context(), requiredUserID(c), c.Param("code"))
		if e != nil {
			inviteError(c, e)
			return
		}
		c.JSON(http.StatusOK, gin.H{"server_id": sid})
	})
}
func inviteError(c *gin.Context, e error) {
	switch {
	case errors.Is(e, invites.ErrNotFound):
		errorResponse(c, 404, "invite_not_found", "Invite was not found or has expired.")
	case errors.Is(e, invites.ErrForbidden):
		errorResponse(c, 403, "invite_forbidden", "You do not have permission to manage invites.")
	default:
		errorResponse(c, 500, "invite_operation_failed", "Unable to complete the invite operation.")
	}
}
