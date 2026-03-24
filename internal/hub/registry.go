package hub

import (
	"sync"
	"time"

	"github.com/mlund01/squadron-wire/protocol"
)

// InstanceState represents the current state of a squadron instance.
type InstanceState struct {
	ID           string                  `json:"id"`
	Name         string                  `json:"name"`
	Version      string                  `json:"version"`
	ConfigDigest string                  `json:"configDigest"`
	Config       protocol.InstanceConfig `json:"config"`
	Connected    bool                    `json:"connected"`
	ConnectedAt  *time.Time              `json:"connectedAt,omitempty"`
	DisconnectedAt *time.Time            `json:"disconnectedAt,omitempty"`
}

// Registry tracks all known instances (connected and recently disconnected).
type Registry struct {
	mu        sync.RWMutex
	instances map[string]*InstanceState // instanceID → state
	byName    map[string]string         // instanceName → instanceID (for reconnect matching)
	nextID    int
}

// NewRegistry creates a new Registry.
func NewRegistry() *Registry {
	return &Registry{
		instances: make(map[string]*InstanceState),
		byName:    make(map[string]string),
	}
}

// Register adds or reconnects an instance. Returns the assigned instance ID.
func (r *Registry) Register(payload protocol.RegisterPayload) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check for reconnection by name
	if existingID, ok := r.byName[payload.InstanceName]; ok {
		if state, ok := r.instances[existingID]; ok {
			now := time.Now()
			state.Connected = true
			state.ConnectedAt = &now
			state.DisconnectedAt = nil
			state.Version = payload.Version
			state.ConfigDigest = payload.ConfigDigest
			state.Config = payload.Config
			return existingID
		}
	}

	// New instance
	r.nextID++
	id := generateInstanceID(r.nextID)
	now := time.Now()

	r.instances[id] = &InstanceState{
		ID:           id,
		Name:         payload.InstanceName,
		Version:      payload.Version,
		ConfigDigest: payload.ConfigDigest,
		Config:       payload.Config,
		Connected:    true,
		ConnectedAt:  &now,
	}
	r.byName[payload.InstanceName] = id

	return id
}

// MarkDisconnected marks an instance as disconnected.
func (r *Registry) MarkDisconnected(instanceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if state, ok := r.instances[instanceID]; ok {
		now := time.Now()
		state.Connected = false
		state.DisconnectedAt = &now
	}
}

// GetInstance returns an instance's state.
func (r *Registry) GetInstance(instanceID string) *InstanceState {
	r.mu.RLock()
	defer r.mu.RUnlock()

	state, ok := r.instances[instanceID]
	if !ok {
		return nil
	}
	cp := *state
	return &cp
}

// UpdateConfig updates the cached config for an instance.
func (r *Registry) UpdateConfig(instanceID string, config protocol.InstanceConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if state, ok := r.instances[instanceID]; ok {
		state.Config = config
	}
}

// ListInstances returns all known instances.
func (r *Registry) ListInstances() []InstanceState {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]InstanceState, 0, len(r.instances))
	for _, state := range r.instances {
		result = append(result, *state)
	}
	return result
}

func generateInstanceID(n int) string {
	return "inst-" + itoa(n)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append(buf, byte('0'+n%10))
		n /= 10
	}
	// reverse
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}
