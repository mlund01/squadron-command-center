package hub

import (
	"sync"
	"time"
)

// Notification is a generic per-instance event pushed to any open browser
// tab subscribed to that instance. Initially used to confirm OAuth-proxy
// MCP logins; designed to accept future types without schema churn.
type Notification struct {
	Type      string                 `json:"type"`             // e.g. "oauth_completed"
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// Notifications fans out per-instance notifications to SSE subscribers.
// Unlike the mission-event fan-out on Connection, notifications are keyed
// by instanceID (not missionID) and have no buffer — they are ephemeral
// hints, not reliable history. Subscribers that aren't listening when an
// event fires will miss it.
type Notifications struct {
	mu   sync.Mutex
	subs map[string][]chan Notification // instanceID → subscribers
}

// NewNotifications creates an empty fan-out.
func NewNotifications() *Notifications {
	return &Notifications{subs: make(map[string][]chan Notification)}
}

// Subscribe returns a channel for the given instance's notifications and a
// cleanup function to remove the subscription.
func (n *Notifications) Subscribe(instanceID string) (chan Notification, func()) {
	ch := make(chan Notification, 16)
	n.mu.Lock()
	n.subs[instanceID] = append(n.subs[instanceID], ch)
	n.mu.Unlock()
	return ch, func() {
		n.mu.Lock()
		defer n.mu.Unlock()
		subs := n.subs[instanceID]
		for i, s := range subs {
			if s == ch {
				n.subs[instanceID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		close(ch)
	}
}

// Publish delivers a notification to all subscribers for the instance.
// Slow subscribers are skipped (no blocking).
func (n *Notifications) Publish(instanceID string, note Notification) {
	if note.Timestamp.IsZero() {
		note.Timestamp = time.Now()
	}
	n.mu.Lock()
	subs := append([]chan Notification(nil), n.subs[instanceID]...)
	n.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- note:
		default:
		}
	}
}
