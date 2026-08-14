package httpserver

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/messages"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
)

func registerMessageRoutes(router *gin.Engine, service *messages.Service, tokens *auth.TokenManager) {
	r := router.Group("/channels")
	r.Use(requireJWT(tokens))
	r.GET("/:channelId/messages", func(c *gin.Context) {
		id, ok := channelID(c)
		if !ok {
			return
		}
		before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
		limit := 50
		if c.Query("limit") != "" {
			var e error
			limit, e = strconv.Atoi(c.Query("limit"))
			if e != nil {
				messageError(c, messages.ErrValidation)
				return
			}
		}
		page, e := service.List(c.Request.Context(), requiredUserID(c), id, before, limit)
		if e != nil {
			messageError(c, e)
			return
		}
		c.JSON(http.StatusOK, page)
	})
	r.POST("/:channelId/messages", func(c *gin.Context) {
		id, ok := channelID(c)
		if !ok {
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if c.ShouldBindJSON(&req) != nil {
			errorResponse(c, http.StatusBadRequest, "validation_error", "Request body must be valid JSON.")
			return
		}
		item, e := service.Create(c.Request.Context(), requiredUserID(c), id, req.Content)
		if e != nil {
			messageError(c, e)
			return
		}
		c.JSON(http.StatusCreated, item)
	})
}
func channelID(c *gin.Context) (int64, bool) {
	id, e := strconv.ParseInt(c.Param("channelId"), 10, 64)
	if e != nil || id <= 0 {
		errorResponse(c, http.StatusBadRequest, "validation_error", "channelId must be a positive integer.")
		return 0, false
	}
	return id, true
}
func messageError(c *gin.Context, e error) {
	switch {
	case errors.Is(e, messages.ErrNotFound):
		errorResponse(c, http.StatusNotFound, "channel_not_found", "Channel was not found.")
	case errors.Is(e, messages.ErrValidation):
		errorResponse(c, http.StatusBadRequest, "validation_error", e.Error())
	default:
		errorResponse(c, http.StatusInternalServerError, "message_operation_failed", "Unable to complete the message operation.")
	}
}
