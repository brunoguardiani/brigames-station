package servers

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (service *Service) Create(ctx context.Context, userID int64, name, description string) (Server, error) {
	name, description, err := validateServerInput(name, description)
	if err != nil {
		return Server{}, err
	}
	tx, err := service.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Server{}, fmt.Errorf("start create server transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	var server Server
	err = tx.QueryRow(ctx, "INSERT INTO servers (name, description, created_by) VALUES ($1, $2, $3) RETURNING id, name, description, created_by, created_at", name, description, userID).Scan(&server.ID, &server.Name, &server.Description, &server.CreatedBy, &server.CreatedAt)
	if err != nil {
		return Server{}, fmt.Errorf("create server: %w", err)
	}
	server.MembershipRole = "owner"
	if _, err := tx.Exec(ctx, "INSERT INTO server_memberships (server_id, user_id, role) VALUES ($1, $2, 'owner')", server.ID, userID); err != nil {
		return Server{}, fmt.Errorf("create owner membership: %w", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO channels (server_id, name, type, position, created_by) VALUES ($1, 'general', 'text', 0, $2)", server.ID, userID); err != nil {
		return Server{}, fmt.Errorf("create default channel: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Server{}, fmt.Errorf("commit create server: %w", err)
	}
	return server, nil
}

func (service *Service) List(ctx context.Context, userID int64) ([]Server, error) {
	rows, err := service.pool.Query(ctx, "SELECT servers.id, servers.name, servers.description, servers.created_by, server_memberships.role, servers.created_at FROM servers JOIN server_memberships ON server_memberships.server_id = servers.id WHERE server_memberships.user_id = $1 ORDER BY servers.created_at, servers.id", userID)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}
	defer rows.Close()
	items := make([]Server, 0)
	for rows.Next() {
		var item Server
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.CreatedBy, &item.MembershipRole, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan server: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate servers: %w", err)
	}
	return items, nil
}

func (service *Service) Get(ctx context.Context, userID, serverID int64) (Server, error) {
	var item Server
	err := service.pool.QueryRow(ctx, "SELECT servers.id, servers.name, servers.description, servers.created_by, server_memberships.role, servers.created_at FROM servers JOIN server_memberships ON server_memberships.server_id = servers.id WHERE servers.id = $1 AND server_memberships.user_id = $2", serverID, userID).Scan(&item.ID, &item.Name, &item.Description, &item.CreatedBy, &item.MembershipRole, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Server{}, ErrNotFound
	}
	if err != nil {
		return Server{}, fmt.Errorf("get server: %w", err)
	}
	return item, nil
}

func (service *Service) ListChannels(ctx context.Context, userID, serverID int64) ([]Channel, error) {
	if _, err := service.Get(ctx, userID, serverID); err != nil {
		return nil, err
	}
	rows, err := service.pool.Query(ctx, "SELECT id, server_id, name, type, position, created_by, created_at FROM channels WHERE server_id = $1 ORDER BY position, id", serverID)
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}
	defer rows.Close()
	items := make([]Channel, 0)
	for rows.Next() {
		var item Channel
		if err := rows.Scan(&item.ID, &item.ServerID, &item.Name, &item.Type, &item.Position, &item.CreatedBy, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate channels: %w", err)
	}
	return items, nil
}

func (service *Service) ListMembers(ctx context.Context, userID, serverID int64) ([]Member, error) {
	if _, err := service.Get(ctx, userID, serverID); err != nil {
		return nil, err
	}
	rows, err := service.pool.Query(ctx, "SELECT users.id, users.username, server_memberships.role, users.avatar_id FROM server_memberships JOIN users ON users.id = server_memberships.user_id WHERE server_memberships.server_id = $1 ORDER BY users.username, users.id", serverID)
	if err != nil {
		return nil, fmt.Errorf("list server members: %w", err)
	}
	defer rows.Close()
	items := make([]Member, 0)
	for rows.Next() {
		var item Member
		if err := rows.Scan(&item.ID, &item.Username, &item.Role, &item.AvatarID); err != nil {
			return nil, fmt.Errorf("scan server member: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate server members: %w", err)
	}
	return items, nil
}

func (service *Service) SharedMemberIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := service.pool.Query(ctx, "SELECT DISTINCT peer.user_id FROM server_memberships own JOIN server_memberships peer ON peer.server_id = own.server_id WHERE own.user_id = $1", userID)
	if err != nil {
		return nil, fmt.Errorf("list shared members: %w", err)
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan shared member: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (service *Service) MemberIDs(ctx context.Context, serverID int64) ([]int64, error) {
	rows, err := service.pool.Query(ctx, "SELECT user_id FROM server_memberships WHERE server_id = $1 ORDER BY user_id", serverID)
	if err != nil {
		return nil, fmt.Errorf("list server member IDs: %w", err)
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan server member ID: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate server member IDs: %w", err)
	}
	return ids, nil
}

func (service *Service) CreateChannel(ctx context.Context, userID, serverID int64, name, channelType string) (Channel, error) {
	name, err := validateChannelName(name)
	if err != nil {
		return Channel{}, err
	}
	channelType, err = validateChannelType(channelType)
	if err != nil {
		return Channel{}, err
	}
	tx, err := service.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Channel{}, fmt.Errorf("start create channel transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", serverID); err != nil {
		return Channel{}, fmt.Errorf("lock server: %w", err)
	}
	var role string
	err = tx.QueryRow(ctx, "SELECT role FROM server_memberships WHERE server_id = $1 AND user_id = $2", serverID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, ErrNotFound
	}
	if err != nil {
		return Channel{}, fmt.Errorf("find server membership: %w", err)
	}
	if role != "owner" {
		return Channel{}, ErrForbidden
	}
	var position int
	if err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE server_id = $1", serverID).Scan(&position); err != nil {
		return Channel{}, fmt.Errorf("find next channel position: %w", err)
	}
	var channel Channel
	err = tx.QueryRow(ctx, "INSERT INTO channels (server_id, name, type, position, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, server_id, name, type, position, created_by, created_at", serverID, name, channelType, position, userID).Scan(&channel.ID, &channel.ServerID, &channel.Name, &channel.Type, &channel.Position, &channel.CreatedBy, &channel.CreatedAt)
	if isUniqueViolation(err) {
		return Channel{}, fmt.Errorf("%w: channel name already exists in this server", ErrConflict)
	}
	if err != nil {
		return Channel{}, fmt.Errorf("create channel: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Channel{}, fmt.Errorf("commit create channel: %w", err)
	}
	return channel, nil
}

func isUniqueViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505"
}

func (service *Service) Leave(ctx context.Context, userID, serverID int64) error {
	tx, err := service.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("start leave server transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", serverID); err != nil {
		return fmt.Errorf("lock server: %w", err)
	}
	var role string
	err = tx.QueryRow(ctx, "SELECT role FROM server_memberships WHERE server_id = $1 AND user_id = $2", serverID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("find server membership: %w", err)
	}
	if role == "owner" {
		var owners int
		if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM server_memberships WHERE server_id = $1 AND role = 'owner'", serverID).Scan(&owners); err != nil {
			return fmt.Errorf("count server owners: %w", err)
		}
		if owners <= 1 {
			return ErrLastOwner
		}
	}
	if _, err := tx.Exec(ctx, "DELETE FROM server_memberships WHERE server_id = $1 AND user_id = $2", serverID, userID); err != nil {
		return fmt.Errorf("leave server: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit leave server: %w", err)
	}
	return nil
}

func validateServerInput(name, description string) (string, string, error) {
	name, description = strings.TrimSpace(name), strings.TrimSpace(description)
	if len(name) == 0 || len(name) > 100 {
		return "", "", fmt.Errorf("%w: server name must contain 1 to 100 characters", ErrValidation)
	}
	if len(description) > 1000 {
		return "", "", fmt.Errorf("%w: server description must contain at most 1000 characters", ErrValidation)
	}
	return name, description, nil
}

func validateChannelName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if len(name) == 0 || len(name) > 100 {
		return "", fmt.Errorf("%w: channel name must contain 1 to 100 characters", ErrValidation)
	}
	return name, nil
}

func validateChannelType(channelType string) (string, error) {
	if channelType == "" {
		return "text", nil
	}
	if channelType != "text" && channelType != "voice" {
		return "", fmt.Errorf("%w: channel type must be text or voice", ErrValidation)
	}
	return channelType, nil
}
