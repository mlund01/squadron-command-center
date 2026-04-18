// Package oauth is the command center side of the OAuth proxy.
//
// When a squadron instance wants to authenticate against an MCP server's
// OAuth provider, it asks commander to reserve an entry in the flow store
// keyed by the cryptographic `state` value. When the IdP later redirects
// the user's browser to `<host>/oauth/callback`, commander looks up the
// state, finds the owning instance, and forwards the callback params back
// over the WS bridge.
//
// Flows expire after 10 minutes to keep the store bounded even when users
// abandon the IdP tab.
package oauth

import (
	"sync"
	"time"
)

// DefaultFlowTTL is how long a reserved flow remains claimable before it's
// evicted by the background sweeper.
const DefaultFlowTTL = 10 * time.Minute

// PendingFlow is the per-state record kept while a login is in progress.
type PendingFlow struct {
	InstanceID string
	McpName    string
	CreatedAt  time.Time
}

// PendingFlows is a thread-safe store of OAuth flows awaiting callback.
type PendingFlows struct {
	mu    sync.Mutex
	ttl   time.Duration
	now   func() time.Time
	flows map[string]PendingFlow
}

// New creates a new PendingFlows store with the default TTL.
func New() *PendingFlows {
	return NewWithTTL(DefaultFlowTTL)
}

// NewWithTTL creates a PendingFlows with a custom TTL (used in tests).
func NewWithTTL(ttl time.Duration) *PendingFlows {
	return &PendingFlows{
		ttl:   ttl,
		now:   time.Now,
		flows: make(map[string]PendingFlow),
	}
}

// Register stores a flow under the given state value. If a flow for the
// same state already exists it is overwritten (the new request wins — state
// collisions in practice are vanishingly unlikely and indicate a buggy
// client; the latest registrant is the best guess).
func (p *PendingFlows) Register(state, instanceID, mcpName string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.flows[state] = PendingFlow{
		InstanceID: instanceID,
		McpName:    mcpName,
		CreatedAt:  p.now(),
	}
}

// Claim removes and returns the flow for the given state. The second
// return value is false if no flow is registered or it has expired.
// Callback delivery is one-shot: the entry is removed on successful claim.
func (p *PendingFlows) Claim(state string) (PendingFlow, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	f, ok := p.flows[state]
	if !ok {
		return PendingFlow{}, false
	}
	delete(p.flows, state)
	if p.now().Sub(f.CreatedAt) > p.ttl {
		return PendingFlow{}, false
	}
	return f, true
}

// Sweep evicts expired flows. Safe to call periodically from a background
// goroutine; the store is also self-cleaning via Claim.
func (p *PendingFlows) Sweep() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	now := p.now()
	for state, f := range p.flows {
		if now.Sub(f.CreatedAt) > p.ttl {
			delete(p.flows, state)
			n++
		}
	}
	return n
}

// Len returns the current number of registered flows (for tests/metrics).
func (p *PendingFlows) Len() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.flows)
}
