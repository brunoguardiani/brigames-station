package messages

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound   = errors.New("channel not found")
	ErrValidation = errors.New("invalid message")
)

type Message struct {
	ID             int64     `json:"id"`
	ChannelID      int64     `json:"channel_id"`
	AuthorID       int64     `json:"author_id"`
	AuthorUsername string    `json:"author_username"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"created_at"`
}
type Page struct {
	Messages   []Message `json:"messages"`
	NextBefore *int64    `json:"next_before"`
}
type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Create(ctx context.Context, userID, channelID int64, content string) (Message, error) {
	content = strings.TrimSpace(content)
	if len(content) == 0 || len(content) > 4000 {
		return Message{}, fmt.Errorf("%w: content must contain 1 to 4000 characters", ErrValidation)
	}
	var item Message
	err := s.pool.QueryRow(ctx, "WITH created AS (INSERT INTO messages (channel_id, author_id, content) SELECT channels.id, $2, $3 FROM channels JOIN server_memberships ON server_memberships.server_id = channels.server_id WHERE channels.id = $1 AND server_memberships.user_id = $2 RETURNING id, channel_id, author_id, content, created_at) SELECT created.id, created.channel_id, created.author_id, users.username, created.content, created.created_at FROM created JOIN users ON users.id = created.author_id", channelID, userID, content).Scan(&item.ID, &item.ChannelID, &item.AuthorID, &item.AuthorUsername, &item.Content, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, fmt.Errorf("create message: %w", err)
	}
	return item, nil
}

// MemberIDs returns the users currently authorized to receive events from a channel.
func (s *Service) MemberIDs(ctx context.Context, channelID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx, "SELECT server_memberships.user_id FROM channels JOIN server_memberships ON server_memberships.server_id = channels.server_id WHERE channels.id = $1", channelID)
	if err != nil {
		return nil, fmt.Errorf("list channel members: %w", err)
	}
	defer rows.Close()

	userIDs := make([]int64, 0)
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			return nil, fmt.Errorf("scan channel member: %w", err)
		}
		userIDs = append(userIDs, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate channel members: %w", err)
	}
	return userIDs, nil
}

func (s *Service) List(ctx context.Context, userID, channelID, before int64, limit int) (Page, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		return Page{}, fmt.Errorf("%w: limit must be between 1 and 100", ErrValidation)
	}
	var allowed bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM channels JOIN server_memberships ON server_memberships.server_id = channels.server_id WHERE channels.id = $1 AND server_memberships.user_id = $2)", channelID, userID).Scan(&allowed)
	if err != nil {
		return Page{}, fmt.Errorf("check channel access: %w", err)
	}
	if !allowed {
		return Page{}, ErrNotFound
	}
	rows, err := s.pool.Query(ctx, "SELECT messages.id, messages.channel_id, messages.author_id, users.username, messages.content, messages.created_at FROM messages JOIN users ON users.id = messages.author_id WHERE messages.channel_id = $1 AND ($2 = 0 OR messages.id < $2) ORDER BY messages.id DESC LIMIT $3", channelID, before, limit)
	if err != nil {
		return Page{}, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()
	page := Page{Messages: make([]Message, 0)}
	for rows.Next() {
		var item Message
		if err := rows.Scan(&item.ID, &item.ChannelID, &item.AuthorID, &item.AuthorUsername, &item.Content, &item.CreatedAt); err != nil {
			return Page{}, fmt.Errorf("scan message: %w", err)
		}
		page.Messages = append(page.Messages, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate messages: %w", err)
	}
	if len(page.Messages) == limit {
		next := page.Messages[len(page.Messages)-1].ID
		page.NextBefore = &next
	}
	return page, nil
}
