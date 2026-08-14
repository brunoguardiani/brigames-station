package servers_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"brigames-station/internal/auth"
	"brigames-station/internal/database"
	httpserver "brigames-station/internal/http"
	"brigames-station/internal/identity"
	"brigames-station/internal/servers"
)

func TestServerAndChannelLifecycle(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for server integration test")
	}
	ctx := context.Background()
	pool, err := database.NewPool(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	suffix := time.Now().UTC().Format("20060102150405.000000000")
	ownerUsername, memberUsername := "srv"+suffix, "mem"+suffix
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, "DELETE FROM servers WHERE created_by IN (SELECT id FROM users WHERE username = $1 OR username = $2)", ownerUsername, memberUsername); err != nil {
			t.Errorf("delete test servers: %v", err)
		}
		if _, err := pool.Exec(ctx, "DELETE FROM users WHERE username = $1 OR username = $2", ownerUsername, memberUsername); err != nil {
			t.Errorf("delete test users: %v", err)
		}
	})
	tokens, err := auth.NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	identities := identity.New(pool, tokens, true, 30*24*time.Hour)
	password := "integration-test-password"
	owner, err := identities.Register(ctx, ownerUsername, ownerUsername+"@example.test", password)
	if err != nil {
		t.Fatal(err)
	}
	member, err := identities.Register(ctx, memberUsername, memberUsername+"@example.test", password)
	if err != nil {
		t.Fatal(err)
	}
	service := servers.New(pool)

	server, err := service.Create(ctx, owner.ID, "Integration server", "A test server")
	if err != nil {
		t.Fatal(err)
	}
	if server.MembershipRole != "owner" {
		t.Fatalf("creator role = %q, want owner", server.MembershipRole)
	}
	channels, err := service.ListChannels(ctx, owner.ID, server.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(channels) != 1 || channels[0].Name != "general" || channels[0].Position != 0 {
		t.Fatalf("default channels = %#v, want only general at position 0", channels)
	}
	if _, err := service.ListChannels(ctx, member.ID, server.ID); !errors.Is(err, servers.ErrNotFound) {
		t.Fatalf("non-member list error = %v, want ErrNotFound", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO server_memberships (server_id, user_id, role) VALUES ($1, $2, 'member')", server.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateChannel(ctx, member.ID, server.ID, "forbidden", "text"); !errors.Is(err, servers.ErrForbidden) {
		t.Fatalf("member create channel error = %v, want ErrForbidden", err)
	}
	channel, err := service.CreateChannel(ctx, owner.ID, server.ID, "planning", "text")
	if err != nil {
		t.Fatal(err)
	}
	if channel.Position != 1 || channel.Type != "text" {
		t.Fatalf("channel = %#v, want text channel at position 1", channel)
	}
	if _, err := service.CreateChannel(ctx, owner.ID, server.ID, "planning", "text"); !errors.Is(err, servers.ErrConflict) {
		t.Fatalf("duplicate channel error = %v, want ErrConflict", err)
	}
	if err := service.Leave(ctx, member.ID, server.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Leave(ctx, owner.ID, server.ID); !errors.Is(err, servers.ErrLastOwner) {
		t.Fatalf("last owner leave error = %v, want ErrLastOwner", err)
	}

	accessToken, _, err := tokens.Issue(owner.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	router := httpserver.NewHandler(pool, identities, tokens, service, nil, nil, nil, nil)
	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/servers/%d/channels", server.ID), nil)
	request.Header.Set("Authorization", "Bearer "+accessToken)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list channels HTTP status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
}
