package httpserver

import (
	"net/http"

	"brigames-station/internal/auth"
	"brigames-station/internal/identity"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"github.com/gin-gonic/gin"
)

func registerIdentityRoutes(router *gin.Engine, service *identity.Service, tokens *auth.TokenManager, serverService *servers.Service, hub *realtime.Hub) {
	router.POST("/auth/register", func(context *gin.Context) {
		var request map[string]string
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		user, err := service.Register(context.Request.Context(), request["username"], request["email"], request["password"])
		if err == identity.ErrRegistrationDisabled {
			errorResponse(context, http.StatusForbidden, "registration_disabled", "Registration is currently disabled.")
			return
		}
		if err == identity.ErrConflict {
			errorResponse(context, http.StatusConflict, "identity_conflict", "Username or email is already in use.")
			return
		}
		if err != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", err.Error())
			return
		}
		context.JSON(http.StatusCreated, user)
	})
	router.POST("/auth/login", func(context *gin.Context) {
		var request map[string]string
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		result, err := service.Login(context.Request.Context(), request["identity"], request["password"])
		if err != nil {
			errorResponse(context, http.StatusUnauthorized, "invalid_credentials", "Username/email or password is incorrect.")
			return
		}
		context.JSON(http.StatusOK, result)
	})
	router.POST("/auth/refresh", func(context *gin.Context) {
		var request map[string]string
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		result, err := service.Refresh(context.Request.Context(), request["refresh_token"])
		if err != nil {
			errorResponse(context, http.StatusUnauthorized, "invalid_refresh_token", "Refresh token is invalid, expired, or revoked.")
			return
		}
		context.JSON(http.StatusOK, result)
	})
	router.POST("/auth/logout", func(context *gin.Context) {
		var request map[string]string
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		if err := service.Logout(context.Request.Context(), request["refresh_token"]); err != nil {
			errorResponse(context, http.StatusUnauthorized, "invalid_refresh_token", "Refresh token is invalid, expired, or revoked.")
			return
		}
		context.Status(http.StatusNoContent)
	})
	router.GET("/me", requireJWT(tokens), func(context *gin.Context) {
		userID, ok := authenticatedUserID(context)
		if !ok {
			errorResponse(context, http.StatusUnauthorized, "invalid_access_token", "Access token is missing, invalid, or expired.")
			return
		}
		user, err := service.CurrentUser(context.Request.Context(), userID)
		if err != nil {
			errorResponse(context, http.StatusUnauthorized, "invalid_access_token", "Access token is missing, invalid, or expired.")
			return
		}
		context.JSON(http.StatusOK, user)
	})
	router.PATCH("/me/avatar", requireJWT(tokens), func(context *gin.Context) {
		userID, ok := authenticatedUserID(context)
		if !ok {
			errorResponse(context, http.StatusUnauthorized, "invalid_access_token", "Access token is missing, invalid, or expired.")
			return
		}
		var request struct {
			AvatarID *string `json:"avatar_id"`
		}
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		user, err := service.UpdateAvatar(context.Request.Context(), userID, request.AvatarID)
		if err == identity.ErrInvalidAvatar {
			errorResponse(context, http.StatusBadRequest, "invalid_avatar", "Avatar is not available.")
			return
		}
		if err != nil {
			errorResponse(context, http.StatusInternalServerError, "avatar_update_failed", "Unable to update avatar.")
			return
		}
		if serverService != nil && hub != nil {
			memberIDs, err := serverService.SharedMemberIDs(context.Request.Context(), userID)
			if err == nil {
				hub.Publish(memberIDs, realtime.Event{Type: "profile.updated", Data: map[string]any{"user_id": userID, "avatar_id": user.AvatarID}})
			}
		}
		context.JSON(http.StatusOK, user)
	})
}

func errorResponse(context *gin.Context, status int, code, message string) {
	context.JSON(status, gin.H{"status": "error", "code": code, "message": message})
}
