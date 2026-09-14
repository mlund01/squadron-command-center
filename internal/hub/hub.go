package hub

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-wire/protocol"
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
	workerStore     WorkerStore
}

// WorkerStore verifies worker credentials and persists connection state for
// the single worker assigned to each workspace.
type WorkerStore interface {
	AuthenticateWorker(context.Context, string) (string, error)
	MarkWorkspaceWorkerDisconnected(context.Context, string) error
	TouchWorkspaceWorker(context.Context, string) error
}

type workspaceVariableStore interface {
	WorkspaceVariablesForRunner(context.Context, string) (map[string]string, error)
}

// New creates a new Hub.
func New(allowConfigEdit bool, workerStore ...WorkerStore) *Hub {
	hub := &Hub{
		connections:     make(map[string]*Connection),
		registry:        NewRegistry(),
		AllowConfigEdit: allowConfigEdit,
	}
	if len(workerStore) > 0 {
		hub.workerStore = workerStore[0]
	}
	return hub
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
	workspaceID := ""
	if h.workerStore != nil {
		credential, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || credential == "" {
			http.Error(w, "worker credential required", http.StatusUnauthorized)
			return
		}
		var err error
		workspaceID, err = h.workerStore.AuthenticateWorker(r.Context(), credential)
		if err != nil {
			http.Error(w, "invalid worker credential", http.StatusUnauthorized)
			return
		}
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	conn := NewConnection(h, ws, workspaceID)
	go conn.ReadPump()
	go conn.WritePump()
}

// Register adds a connection to the hub after successful registration.
func (h *Hub) Register(instanceID string, conn *Connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.connections[instanceID] = conn
}

// Unregister removes a connection from the hub. Checking the connection
// identity prevents an older socket from racing a newer reconnect.
func (h *Hub) Unregister(instanceID string, connection *Connection) {
	h.mu.Lock()
	if h.connections[instanceID] != connection {
		h.mu.Unlock()
		return
	}
	delete(h.connections, instanceID)
	h.mu.Unlock()

	h.registry.MarkDisconnected(instanceID)
	if h.workerStore != nil && connection.workspaceID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.workerStore.MarkWorkspaceWorkerDisconnected(ctx, connection.workspaceID); err != nil {
			log.Printf("mark workspace worker disconnected: %v", err)
		}
	}
}

func (h *Hub) touchWorker(workspaceID string) {
	if h.workerStore == nil || workspaceID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.workerStore.TouchWorkspaceWorker(ctx, workspaceID); err != nil {
		log.Printf("touch workspace worker: %v", err)
	}
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

// SendMessage sends a fire-and-forget message to an instance (no response expected).
func (h *Hub) SendMessage(instanceID string, env *protocol.Envelope) error {
	conn := h.GetConnection(instanceID)
	if conn == nil {
		return ErrInstanceDisconnected
	}
	return conn.Send(env)
}

// GetRegistry returns the instance registry.
func (h *Hub) GetRegistry() *Registry {
	return h.registry
}
