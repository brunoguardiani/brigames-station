package realtime

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"sync"
	"time"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}
type Hub struct {
	mu            sync.RWMutex
	clients       map[int64]map[*client]struct{}
	voicePresence map[int64]VoicePresence
}
type client struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

type VoicePresence struct {
	ServerID  int64 `json:"server_id"`
	ChannelID int64 `json:"channel_id"`
}

type UnregisterResult struct {
	WentOffline   bool
	VoicePresence *VoicePresence
}

func NewHub() *Hub {
	return &Hub{
		clients:       make(map[int64]map[*client]struct{}),
		voicePresence: make(map[int64]VoicePresence),
	}
}
func (h *Hub) Register(userID int64, conn *websocket.Conn) (bool, func() UnregisterResult) {
	c := &client{conn: conn}
	h.mu.Lock()
	wasOffline := len(h.clients[userID]) == 0
	if h.clients[userID] == nil {
		h.clients[userID] = map[*client]struct{}{}
	}
	h.clients[userID][c] = struct{}{}
	h.mu.Unlock()
	return wasOffline, func() UnregisterResult {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.clients[userID], c)
		wentOffline := len(h.clients[userID]) == 0
		if !wentOffline {
			return UnregisterResult{}
		}
		delete(h.clients, userID)
		result := UnregisterResult{WentOffline: true}
		if presence, ok := h.voicePresence[userID]; ok {
			delete(h.voicePresence, userID)
			result.VoicePresence = &presence
		}
		return result
	}
}
func (h *Hub) SetVoicePresence(userID int64, presence VoicePresence) (*VoicePresence, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	previous, exists := h.voicePresence[userID]
	if exists && previous == presence {
		return &previous, false
	}
	h.voicePresence[userID] = presence
	if exists {
		return &previous, true
	}
	return nil, true
}
func (h *Hub) ClearVoicePresence(userID int64) (VoicePresence, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	presence, exists := h.voicePresence[userID]
	if exists {
		delete(h.voicePresence, userID)
	}
	return presence, exists
}
func (h *Hub) GetVoicePresence(userID int64) (VoicePresence, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	presence, exists := h.voicePresence[userID]
	return presence, exists
}
func (h *Hub) IsOnline(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}
func (h *Hub) Publish(userIDs []int64, event Event) {
	body, e := json.Marshal(event)
	if e != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, id := range userIDs {
		for c := range h.clients[id] {
			go c.write(body)
		}
	}
}
func (c *client) write(body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.conn.Write(ctx, websocket.MessageText, body)
}
