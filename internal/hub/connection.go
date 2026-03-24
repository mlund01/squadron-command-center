package hub

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-wire/protocol"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

// Connection represents a single WebSocket connection from a squadron instance.
type Connection struct {
	hub        *Hub
	ws         *websocket.Conn
	send       chan []byte
	instanceID string

	// Request/response correlation
	mu      sync.Mutex
	pending map[string]chan *protocol.Envelope // requestID → response channel

	// Mission event fan-out for SSE subscribers
	eventMu     sync.Mutex
	eventSubs   map[string][]chan *protocol.MissionEventPayload // missionID → subscriber channels
	eventBuffer map[string][]*protocol.MissionEventPayload     // buffered events before first subscriber

	// Chat event fan-out for SSE subscribers
	chatMu     sync.Mutex
	chatSubs   map[string][]chan *protocol.ChatEventPayload // sessionID → subscriber channels
	chatBuffer map[string][]*protocol.ChatEventPayload      // buffered events before first subscriber
}

// NewConnection creates a new Connection wrapping a WebSocket.
func NewConnection(hub *Hub, ws *websocket.Conn) *Connection {
	return &Connection{
		hub:         hub,
		ws:          ws,
		send:        make(chan []byte, 256),
		pending:     make(map[string]chan *protocol.Envelope),
		eventSubs:   make(map[string][]chan *protocol.MissionEventPayload),
		eventBuffer: make(map[string][]*protocol.MissionEventPayload),
		chatSubs:    make(map[string][]chan *protocol.ChatEventPayload),
		chatBuffer:  make(map[string][]*protocol.ChatEventPayload),
	}
}

// ReadPump reads messages from the WebSocket and dispatches them.
func (c *Connection) ReadPump() {
	defer func() {
		if c.instanceID != "" {
			c.hub.Unregister(c.instanceID)
		}
		c.ws.Close()
	}()

	c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		c.ws.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			return
		}

		var env protocol.Envelope
		if err := json.Unmarshal(message, &env); err != nil {
			log.Printf("Invalid message: %v", err)
			continue
		}

		c.dispatch(&env)
	}
}

// WritePump writes messages from the send channel to the WebSocket.
func (c *Connection) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.ws.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Send marshals and queues an envelope for sending.
func (c *Connection) Send(env *protocol.Envelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	c.send <- data
	return nil
}

// SendRequest sends a request and waits for the correlated response.
func (c *Connection) SendRequest(env *protocol.Envelope, timeout time.Duration) (*protocol.Envelope, error) {
	ch := make(chan *protocol.Envelope, 1)

	c.mu.Lock()
	c.pending[env.RequestID] = ch
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		delete(c.pending, env.RequestID)
		c.mu.Unlock()
	}()

	if err := c.Send(env); err != nil {
		return nil, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-time.After(timeout):
		return nil, ErrRequestTimeout
	}
}

// SubscribeMissionEvents returns a channel that receives mission events for the given missionID.
// Any events that arrived before the first subscriber are replayed immediately.
// Call the returned cleanup function to unsubscribe.
func (c *Connection) SubscribeMissionEvents(missionID string) (chan *protocol.MissionEventPayload, func()) {
	ch := make(chan *protocol.MissionEventPayload, 64)
	c.eventMu.Lock()
	// Replay any buffered events
	if buffered, ok := c.eventBuffer[missionID]; ok {
		for _, ev := range buffered {
			ch <- ev
		}
		delete(c.eventBuffer, missionID)
	}
	c.eventSubs[missionID] = append(c.eventSubs[missionID], ch)
	c.eventMu.Unlock()

	cleanup := func() {
		c.eventMu.Lock()
		defer c.eventMu.Unlock()
		subs := c.eventSubs[missionID]
		for i, sub := range subs {
			if sub == ch {
				c.eventSubs[missionID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		close(ch)
	}
	return ch, cleanup
}

func (c *Connection) fanOutMissionEvent(env *protocol.Envelope) {
	var payload protocol.MissionEventPayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		log.Printf("Invalid mission event payload: %v", err)
		return
	}

	c.eventMu.Lock()
	subs := c.eventSubs[payload.MissionID]
	if len(subs) == 0 {
		// No subscribers yet — buffer the event for later replay
		c.eventBuffer[payload.MissionID] = append(c.eventBuffer[payload.MissionID], &payload)
		c.eventMu.Unlock()
		return
	}
	c.eventMu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- &payload:
		default:
			// Subscriber too slow, drop event
		}
	}
}

func (c *Connection) fanOutMissionComplete(env *protocol.Envelope) {
	var payload protocol.MissionCompletePayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		log.Printf("Invalid mission complete payload: %v", err)
		return
	}

	// Send a terminal event to subscribers, then remove them
	terminalEvent := &protocol.MissionEventPayload{
		MissionID: payload.MissionID,
		EventType: protocol.EventMissionCompleted,
		Data: protocol.MissionCompletedData{
			MissionName: payload.MissionID,
		},
	}
	if payload.Status == "failed" || payload.Status == "stopped" {
		terminalEvent.EventType = protocol.EventMissionFailed
		terminalEvent.Data = protocol.MissionFailedData{Error: payload.Error}
	}

	c.eventMu.Lock()
	subs := c.eventSubs[payload.MissionID]
	if len(subs) == 0 {
		// No subscribers — buffer the terminal event too
		c.eventBuffer[payload.MissionID] = append(c.eventBuffer[payload.MissionID], terminalEvent)
		c.eventMu.Unlock()
		return
	}
	delete(c.eventSubs, payload.MissionID)
	c.eventMu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- terminalEvent:
		default:
		}
	}
}

// SubscribeChatEvents returns a channel that receives chat events for the given sessionID.
// Any events that arrived before the first subscriber are replayed immediately.
func (c *Connection) SubscribeChatEvents(sessionID string) (chan *protocol.ChatEventPayload, func()) {
	ch := make(chan *protocol.ChatEventPayload, 128)
	c.chatMu.Lock()
	if buffered, ok := c.chatBuffer[sessionID]; ok {
		for _, ev := range buffered {
			ch <- ev
		}
		delete(c.chatBuffer, sessionID)
	}
	c.chatSubs[sessionID] = append(c.chatSubs[sessionID], ch)
	c.chatMu.Unlock()

	cleanup := func() {
		c.chatMu.Lock()
		defer c.chatMu.Unlock()
		subs := c.chatSubs[sessionID]
		for i, sub := range subs {
			if sub == ch {
				c.chatSubs[sessionID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		close(ch)
	}
	return ch, cleanup
}

func (c *Connection) fanOutChatEvent(env *protocol.Envelope) {
	var payload protocol.ChatEventPayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		log.Printf("Invalid chat event payload: %v", err)
		return
	}

	c.chatMu.Lock()
	subs := c.chatSubs[payload.SessionID]
	if len(subs) == 0 {
		c.chatBuffer[payload.SessionID] = append(c.chatBuffer[payload.SessionID], &payload)
		c.chatMu.Unlock()
		return
	}
	c.chatMu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- &payload:
		default:
		}
	}
}

func (c *Connection) fanOutChatComplete(env *protocol.Envelope) {
	var payload protocol.ChatCompletePayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		log.Printf("Invalid chat complete payload: %v", err)
		return
	}

	// Send a terminal event, then clean up subscribers
	terminalEvent := &protocol.ChatEventPayload{
		SessionID: payload.SessionID,
		EventType: protocol.ChatEventTurnComplete,
	}
	if payload.Status == "error" {
		terminalEvent.EventType = protocol.ChatEventError
		terminalEvent.Data = protocol.ChatErrorData{Message: payload.Error}
	}

	c.chatMu.Lock()
	subs := c.chatSubs[payload.SessionID]
	if len(subs) == 0 {
		c.chatBuffer[payload.SessionID] = append(c.chatBuffer[payload.SessionID], terminalEvent)
		c.chatMu.Unlock()
		return
	}
	delete(c.chatSubs, payload.SessionID)
	c.chatMu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- terminalEvent:
		default:
		}
	}
}

// Close shuts down the connection.
func (c *Connection) Close() {
	close(c.send)
}

// dispatch routes an incoming message by type.
func (c *Connection) dispatch(env *protocol.Envelope) {
	// If this is a response to a pending request, deliver it
	if env.RequestID != "" {
		c.mu.Lock()
		ch, ok := c.pending[env.RequestID]
		c.mu.Unlock()
		if ok {
			ch <- env
			return
		}
	}

	switch env.Type {
	case protocol.TypeRegister:
		c.handleRegister(env)
	case protocol.TypeHeartbeat:
		c.handleHeartbeat(env)
	case protocol.TypeMissionEvent:
		c.fanOutMissionEvent(env)
	case protocol.TypeMissionComplete:
		c.fanOutMissionComplete(env)
	case protocol.TypeChatEvent:
		c.fanOutChatEvent(env)
	case protocol.TypeChatComplete:
		c.fanOutChatComplete(env)
	default:
		log.Printf("Unhandled message type: %s", env.Type)
	}
}

func (c *Connection) handleRegister(env *protocol.Envelope) {
	var payload protocol.RegisterPayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		log.Printf("Invalid register payload: %v", err)
		return
	}

	// Register in the registry
	instanceID := c.hub.GetRegistry().Register(payload)
	c.instanceID = instanceID
	c.hub.Register(instanceID, c)

	// Send ack
	ack, _ := protocol.NewResponse(env.RequestID, protocol.TypeRegisterAck, &protocol.RegisterAckPayload{
		InstanceID: instanceID,
		Accepted:   true,
	})
	c.Send(ack)

	log.Printf("Instance registered: %s (id=%s)", payload.InstanceName, instanceID)
}

func (c *Connection) handleHeartbeat(env *protocol.Envelope) {
	ack, _ := protocol.NewResponse(env.RequestID, protocol.TypeHeartbeatAck, &protocol.HeartbeatAckPayload{})
	c.Send(ack)
}
