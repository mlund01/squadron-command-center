package hub

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-sdk/protocol"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Hub manages all WebSocket connections from squadron instances.
type Hub struct {
	mu              sync.RWMutex
	connections     map[string]*Connection // instanceID → connection
	registry        *Registry
	AllowConfigEdit bool
}

// New creates a new Hub.
func New(allowConfigEdit bool) *Hub {
	return &Hub{
		connections:     make(map[string]*Connection),
		registry:        NewRegistry(),
		AllowConfigEdit: allowConfigEdit,
	}
}

// Start initializes background tasks (heartbeat, cleanup, etc.).
func (h *Hub) Start() {
	// TODO: Start heartbeat ticker
}

// Stop shuts down all connections.
func (h *Hub) Stop() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, conn := range h.connections {
		conn.Close()
	}
}

// ServeWS upgrades an HTTP request to a WebSocket connection.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	conn := NewConnection(h, ws)
	go conn.ReadPump()
	go conn.WritePump()
}

// Register adds a connection to the hub after successful registration.
func (h *Hub) Register(instanceID string, conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connections[instanceID] = conn
}

// Unregister removes a connection from the hub.
func (h *Hub) Unregister(instanceID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.connections, instanceID)
	h.registry.MarkDisconnected(instanceID)
}

// GetConnection returns a connection by instance ID.
func (h *Hub) GetConnection(instanceID string) *Connection {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.connections[instanceID]
}

// SendRequest sends a request to an instance and waits for the response.
func (h *Hub) SendRequest(instanceID string, env *protocol.Envelope, timeout time.Duration) (*protocol.Envelope, error) {
	conn := h.GetConnection(instanceID)
	if conn == nil {
		return nil, ErrInstanceDisconnected
	}
	return conn.SendRequest(env, timeout)
}

// GetRegistry returns the instance registry.
func (h *Hub) GetRegistry() *Registry {
	return h.registry
}
