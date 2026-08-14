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
	mu      sync.RWMutex
	clients map[int64]map[*client]struct{}
}
type client struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func NewHub() *Hub { return &Hub{clients: make(map[int64]map[*client]struct{})} }
func (h *Hub) Register(userID int64, conn *websocket.Conn) func() {
	c := &client{conn: conn}
	h.mu.Lock()
	if h.clients[userID] == nil {
		h.clients[userID] = map[*client]struct{}{}
	}
	h.clients[userID][c] = struct{}{}
	h.mu.Unlock()
	return func() {
		h.mu.Lock()
		delete(h.clients[userID], c)
		if len(h.clients[userID]) == 0 {
			delete(h.clients, userID)
		}
		h.mu.Unlock()
	}
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
