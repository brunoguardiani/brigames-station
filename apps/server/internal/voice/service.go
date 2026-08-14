package voice

import (
	"brigames-station/internal/config"
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/auth"
	"strconv"
)

var ErrNotFound = errors.New("voice channel not found")

type Join struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	Room  string `json:"room"`
}
type Service struct {
	pool   *pgxpool.Pool
	config config.LiveKitConfig
}

func New(pool *pgxpool.Pool, cfg config.LiveKitConfig) *Service { return &Service{pool, cfg} }
func (s *Service) Join(ctx context.Context, userID, channelID int64) (Join, error) {
	var room, username string
	err := s.pool.QueryRow(ctx, "SELECT 'server-' || channels.server_id || '-channel-' || channels.id, users.username FROM channels JOIN server_memberships ON server_memberships.server_id=channels.server_id JOIN users ON users.id=server_memberships.user_id WHERE channels.id=$1 AND channels.type='voice' AND server_memberships.user_id=$2", channelID, userID).Scan(&room, &username)
	if errors.Is(err, pgx.ErrNoRows) {
		return Join{}, ErrNotFound
	}
	if err != nil {
		return Join{}, fmt.Errorf("authorize voice channel: %w", err)
	}
	allow := true
	deny := false
	token, err := auth.NewAccessToken(s.config.APIKey, s.config.APISecret).SetIdentity(strconv.FormatInt(userID, 10)).SetName(username).SetVideoGrant(&auth.VideoGrant{RoomJoin: true, Room: room, CanPublish: &allow, CanSubscribe: &allow, CanPublishData: &deny}).SetValidFor(s.config.TokenTTL).ToJWT()
	if err != nil {
		return Join{}, fmt.Errorf("create voice token: %w", err)
	}
	return Join{URL: s.config.URL, Token: token, Room: room}, nil
}
