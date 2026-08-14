package invites

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

var (
	ErrNotFound  = errors.New("invite not found")
	ErrForbidden = errors.New("invite action forbidden")
)

type Invite struct {
	ID        int64     `json:"id"`
	ServerID  int64     `json:"server_id"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}
type Service struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Service { return &Service{pool} }
func (s *Service) Create(ctx context.Context, userID, serverID int64) (Invite, error) {
	var role string
	if e := s.pool.QueryRow(ctx, "SELECT role FROM server_memberships WHERE server_id=$1 AND user_id=$2", serverID, userID).Scan(&role); errors.Is(e, pgx.ErrNoRows) {
		return Invite{}, ErrNotFound
	} else if e != nil {
		return Invite{}, e
	}
	if role != "owner" {
		return Invite{}, ErrForbidden
	}
	b := make([]byte, 24)
	if _, e := rand.Read(b); e != nil {
		return Invite{}, e
	}
	code := base64.RawURLEncoding.EncodeToString(b)
	hash := sha256.Sum256([]byte(code))
	var i Invite
	i.Code = code
	i.ServerID = serverID
	i.ExpiresAt = time.Now().UTC().Add(24 * time.Hour)
	e := s.pool.QueryRow(ctx, "INSERT INTO server_invites(server_id,code_hash,created_by,expires_at) VALUES($1,$2,$3,$4) RETURNING id", serverID, hash[:], userID, i.ExpiresAt).Scan(&i.ID)
	if e != nil {
		return Invite{}, fmt.Errorf("create invite: %w", e)
	}
	return i, nil
}
func (s *Service) Join(ctx context.Context, userID int64, code string) (int64, error) {
	hash := sha256.Sum256([]byte(code))
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	var serverID int64
	e = tx.QueryRow(ctx, "SELECT server_id FROM server_invites WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE", hash[:]).Scan(&serverID)
	if errors.Is(e, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if e != nil {
		return 0, e
	}
	_, e = tx.Exec(ctx, "INSERT INTO server_memberships(server_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT (server_id,user_id) DO NOTHING", serverID, userID)
	if e != nil {
		return 0, e
	}
	if e = tx.Commit(ctx); e != nil {
		return 0, e
	}
	return serverID, nil
}
func (s *Service) Revoke(ctx context.Context, userID, serverID, inviteID int64) error {
	c, e := s.pool.Exec(ctx, "UPDATE server_invites SET revoked_at=NOW() WHERE id=$1 AND server_id=$2 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM server_memberships WHERE server_id=$2 AND user_id=$3 AND role='owner')", inviteID, serverID, userID)
	if e != nil {
		return e
	}
	if c.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}
