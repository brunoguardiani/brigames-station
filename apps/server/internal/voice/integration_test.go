package voice_test

import (
	"bytes"
	"brigames-station/internal/auth"
	"brigames-station/internal/config"
	"brigames-station/internal/database"
	httpserver "brigames-station/internal/http"
	"brigames-station/internal/identity"
	"brigames-station/internal/realtime"
	"brigames-station/internal/servers"
	"brigames-station/internal/voice"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	authorizedServerID, err := service.AuthorizeChannel(ctx, owner.ID, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if authorizedServerID != server.ID {
		t.Fatalf("AuthorizeChannel server ID = %d, want %d", authorizedServerID, server.ID)
	}
	if _, err := service.AuthorizeChannel(ctx, outsider.ID, channel.ID); !errors.Is(err, voice.ErrNotFound) {
		t.Fatalf("outsider AuthorizeChannel error = %v, want ErrNotFound", err)
	}
	channels, err := serverService.ListChannels(ctx, owner.ID, server.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthorizeChannel(ctx, owner.ID, channels[0].ID); !errors.Is(err, voice.ErrNotFound) {
		t.Fatalf("text-channel AuthorizeChannel error = %v, want ErrNotFound", err)
	}

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

	hub := realtime.NewHub()
	router := httpserver.NewHandler(pool, identities, tokens, serverService, nil, nil, service, hub)
	ownerAccessToken, _, err := tokens.Issue(owner.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	setRequest := httptest.NewRequest(http.MethodPut, "/voice/presence", bytes.NewBufferString(fmt.Sprintf(`{"channel_id":%d}`, channel.ID)))
	setRequest.Header.Set("Authorization", "Bearer "+ownerAccessToken)
	setRequest.Header.Set("Content-Type", "application/json")
	setRecorder := httptest.NewRecorder()
	router.ServeHTTP(setRecorder, setRequest)
	if setRecorder.Code != http.StatusNoContent {
		t.Fatalf("set voice presence HTTP status = %d, want %d: %s", setRecorder.Code, http.StatusNoContent, setRecorder.Body.String())
	}
	presence, exists := hub.GetVoicePresence(owner.ID)
	if !exists || presence.ServerID != server.ID || presence.ChannelID != channel.ID {
		t.Fatalf("voice presence = (%#v, %t), want server %d channel %d", presence, exists, server.ID, channel.ID)
	}

	membersRequest := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/servers/%d/members", server.ID), nil)
	membersRequest.Header.Set("Authorization", "Bearer "+ownerAccessToken)
	membersRecorder := httptest.NewRecorder()
	router.ServeHTTP(membersRecorder, membersRequest)
	if membersRecorder.Code != http.StatusOK {
		t.Fatalf("list members HTTP status = %d, want %d: %s", membersRecorder.Code, http.StatusOK, membersRecorder.Body.String())
	}
	var members []struct {
		ID             int64  `json:"id"`
		VoiceChannelID *int64 `json:"voice_channel_id"`
	}
	if err := json.Unmarshal(membersRecorder.Body.Bytes(), &members); err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 || members[0].ID != owner.ID || members[0].VoiceChannelID == nil || *members[0].VoiceChannelID != channel.ID {
		t.Fatalf("members response = %#v, want owner in voice channel %d", members, channel.ID)
	}

	clearRequest := httptest.NewRequest(http.MethodPut, "/voice/presence", bytes.NewBufferString(`{"channel_id":null}`))
	clearRequest.Header.Set("Authorization", "Bearer "+ownerAccessToken)
	clearRequest.Header.Set("Content-Type", "application/json")
	clearRecorder := httptest.NewRecorder()
	router.ServeHTTP(clearRecorder, clearRequest)
	if clearRecorder.Code != http.StatusNoContent {
		t.Fatalf("clear voice presence HTTP status = %d, want %d: %s", clearRecorder.Code, http.StatusNoContent, clearRecorder.Body.String())
	}
	if _, exists := hub.GetVoicePresence(owner.ID); exists {
		t.Fatal("voice presence should be absent after HTTP clear")
	}
}
