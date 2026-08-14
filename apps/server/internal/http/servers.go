package httpserver

import (
	"errors"
	"net/http"
	"strconv"

	"brigames-station/internal/auth"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"github.com/gin-gonic/gin"
)

func registerServerRoutes(router *gin.Engine, service *servers.Service, tokens *auth.TokenManager, hub *realtime.Hub) {
	protected := router.Group("/servers")
	protected.Use(requireJWT(tokens))
	protected.GET("", func(context *gin.Context) {
		items, err := service.List(context.Request.Context(), requiredUserID(context))
		if err != nil {
			errorResponse(context, http.StatusInternalServerError, "server_list_failed", "Unable to list servers.")
			return
		}
		context.JSON(http.StatusOK, items)
	})
	protected.POST("", func(context *gin.Context) {
		var request struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		item, err := service.Create(context.Request.Context(), requiredUserID(context), request.Name, request.Description)
		if err != nil {
			serverError(context, err)
			return
		}
		context.JSON(http.StatusCreated, item)
	})
	protected.GET("/:serverId", func(context *gin.Context) {
		serverID, ok := serverIDFromPath(context)
		if !ok {
			return
		}
		item, err := service.Get(context.Request.Context(), requiredUserID(context), serverID)
		if err != nil {
			serverError(context, err)
			return
		}
		context.JSON(http.StatusOK, item)
	})
	protected.GET("/:serverId/channels", func(context *gin.Context) {
		serverID, ok := serverIDFromPath(context)
		if !ok {
			return
		}
		items, err := service.ListChannels(context.Request.Context(), requiredUserID(context), serverID)
		if err != nil {
			serverError(context, err)
			return
		}
		context.JSON(http.StatusOK, items)
	})
	protected.GET("/:serverId/members", func(context *gin.Context) {
		serverID, ok := serverIDFromPath(context)
		if !ok {
			return
		}
		items, err := service.ListMembers(context.Request.Context(), requiredUserID(context), serverID)
		if err != nil {
			serverError(context, err)
			return
		}
		response := make([]map[string]any, 0, len(items))
		for _, item := range items {
			response = append(response, map[string]any{"id": item.ID, "username": item.Username, "role": item.Role, "online": hub.IsOnline(item.ID)})
		}
		context.JSON(http.StatusOK, response)
	})
	protected.POST("/:serverId/channels", func(context *gin.Context) {
		serverID, ok := serverIDFromPath(context)
		if !ok {
			return
		}
		var request struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}
		if context.ShouldBindJSON(&request) != nil {
			errorResponse(context, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		item, err := service.CreateChannel(context.Request.Context(), requiredUserID(context), serverID, request.Name, request.Type)
		if err != nil {
			serverError(context, err)
			return
		}
		context.JSON(http.StatusCreated, item)
	})
	protected.POST("/:serverId/leave", func(context *gin.Context) {
		serverID, ok := serverIDFromPath(context)
		if !ok {
			return
		}
		if err := service.Leave(context.Request.Context(), requiredUserID(context), serverID); err != nil {
			serverError(context, err)
			return
		}
		context.Status(http.StatusNoContent)
	})
}

func serverIDFromPath(context *gin.Context) (int64, bool) {
	serverID, err := strconv.ParseInt(context.Param("serverId"), 10, 64)
	if err != nil || serverID <= 0 {
		errorResponse(context, http.StatusBadRequest, "validation_error", "serverId must be a positive integer.")
		return 0, false
	}
	return serverID, true
}

func requiredUserID(context *gin.Context) int64 {
	userID, _ := authenticatedUserID(context)
	return userID
}

func serverError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, servers.ErrNotFound):
		errorResponse(context, http.StatusNotFound, "server_not_found", "Server was not found.")
	case errors.Is(err, servers.ErrForbidden):
		errorResponse(context, http.StatusForbidden, "server_forbidden", "You do not have permission to perform this server action.")
	case errors.Is(err, servers.ErrLastOwner):
		errorResponse(context, http.StatusConflict, "last_server_owner", "The last server owner cannot leave the server.")
	case errors.Is(err, servers.ErrValidation):
		errorResponse(context, http.StatusBadRequest, "validation_error", err.Error())
	case errors.Is(err, servers.ErrConflict):
		errorResponse(context, http.StatusConflict, "channel_conflict", err.Error())
	default:
		errorResponse(context, http.StatusInternalServerError, "server_operation_failed", "Unable to complete the server operation.")
	}
}
