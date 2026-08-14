package httpserver

import (
	"net/http"
	"strings"
	"time"

	"brigames-station/internal/auth"
	"github.com/gin-gonic/gin"
)

const authenticatedUserIDKey = "authenticated_user_id"

func requireJWT(tokens *auth.TokenManager) gin.HandlerFunc {
	return func(context *gin.Context) {
		header := context.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			errorResponse(context, http.StatusUnauthorized, "invalid_access_token", "Access token is missing, invalid, or expired.")
			context.Abort()
			return
		}

		claims, err := tokens.Validate(strings.TrimPrefix(header, "Bearer "), time.Now().UTC())
		if err != nil {
			errorResponse(context, http.StatusUnauthorized, "invalid_access_token", "Access token is missing, invalid, or expired.")
			context.Abort()
			return
		}

		context.Set(authenticatedUserIDKey, claims.Subject)
		context.Next()
	}
}

func authenticatedUserID(context *gin.Context) (int64, bool) {
	value, exists := context.Get(authenticatedUserIDKey)
	if !exists {
		return 0, false
	}
	userID, ok := value.(int64)
	return userID, ok
}
