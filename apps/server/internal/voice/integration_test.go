package voice_test

import (
	"brigames-station/internal/auth"
	"brigames-station/internal/config"
	"brigames-station/internal/database"
	"brigames-station/internal/identity"
	"brigames-station/internal/servers"
	"brigames-station/internal/voice"
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestJoinAuthorizesOnlyServerMembers(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for voice integration test")
	}

	ctx := context.Background()
	pool, err := database.NewPool(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	suffix := time.Now().UTC().Format("20060102150405.000000000")
	ownerUsername, outsiderUsername := "voiceown"+suffix, "voiceout"+suffix
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, "DELETE FROM servers WHERE created_by IN (SELECT id FROM users WHERE username = $1 OR username = $2)", ownerUsername, outsiderUsername); err != nil {
			t.Errorf("delete test servers: %v", err)
		}
		if _, err := pool.Exec(ctx, "DELETE FROM users WHERE username = $1 OR username = $2", ownerUsername, outsiderUsername); err != nil {
			t.Errorf("delete test users: %v", err)
		}
	})

	tokens, err := auth.NewTokenManager("12345678901234567890123456789012", "brigames-station", "brigames-station-desktop", 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	identities := identity.New(pool, tokens, true, 30*24*time.Hour)
	owner, err := identities.Register(ctx, ownerUsername, ownerUsername+"@example.test", "integration-test-password")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := identities.Register(ctx, outsiderUsername, outsiderUsername+"@example.test", "integration-test-password")
	if err != nil {
		t.Fatal(err)
	}

	serverService := servers.New(pool)
	server, err := serverService.Create(ctx, owner.ID, "Voice integration server", "")
	if err != nil {
		t.Fatal(err)
	}
	channel, err := serverService.CreateChannel(ctx, owner.ID, server.ID, "Voice", "voice")
	if err != nil {
		t.Fatal(err)
	}
	service := voice.New(pool, config.LiveKitConfig{URL: "ws://127.0.0.1:7880", APIKey: "devkey", APISecret: "secret", TokenTTL: 15 * time.Minute})

	join, err := service.Join(ctx, owner.ID, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if join.URL != "ws://127.0.0.1:7880" || join.Token == "" || join.Room == "" {
		t.Fatalf("join = %#v, want URL, token, and room", join)
	}
	if _, err := service.Join(ctx, outsider.ID, channel.ID); !errors.Is(err, voice.ErrNotFound) {
		t.Fatalf("outsider Join error = %v, want ErrNotFound", err)
	}
}
