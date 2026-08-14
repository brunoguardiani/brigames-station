package servers

import (
	"errors"
	"time"
)

var (
	ErrValidation = errors.New("invalid server input")
	ErrNotFound   = errors.New("server not found")
	ErrForbidden  = errors.New("server action is forbidden")
	ErrLastOwner  = errors.New("the last server owner cannot leave")
)

type Server struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	CreatedBy      int64     `json:"created_by"`
	MembershipRole string    `json:"membership_role"`
	CreatedAt      time.Time `json:"created_at"`
}

type Channel struct {
	ID        int64     `json:"id"`
	ServerID  int64     `json:"server_id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Position  int       `json:"position"`
	CreatedBy int64     `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}
