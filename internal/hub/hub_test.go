package hub_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

type recordingWorkerStore struct {
	disconnected chan string
	touched      chan string
}

func (s *recordingWorkerStore) AuthenticateWorker(_ context.Context, credential string) (string, error) {
	return "workspace-1", nil
}

func (s *recordingWorkerStore) MarkWorkspaceWorkerDisconnected(_ context.Context, workspaceID string) error {
	s.disconnected <- workspaceID
	return nil
}

func (s *recordingWorkerStore) TouchWorkspaceWorker(_ context.Context, workspaceID string) error {
	s.touched <- workspaceID
	return nil
}

func setupTestServer(t *testing.T) (*hub.Hub, *httptest.Server) {
	t.Helper()
	h := hub.New(false)
	h.Start()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		h.Stop()
		srv.Close()
	})
	return h, srv
}

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ws, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { ws.Close() })
	return ws
}

func sendEnvelope(t *testing.T, ws *websocket.Conn, env *protocol.Envelope) {
	t.Helper()
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func readEnvelope(t *testing.T, ws *websocket.Conn) *protocol.Envelope {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var env protocol.Envelope
	if err := json.Unmarshal(msg, &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return &env
}

func registerInstance(t *testing.T, ws *websocket.Conn, name string) string {
	t.Helper()
	req, err := protocol.NewRequest(protocol.TypeRegister, &protocol.RegisterPayload{
		InstanceName: name,
		Version:      "1.0.0",
		Config: protocol.InstanceConfig{
			Models: []protocol.ModelInfo{
				{Name: "test-model", Provider: "openai", Model: "gpt-4"},
			},
			Agents: []protocol.AgentInfo{
				{Name: "test-agent", Model: "test-model", Tools: []string{"web_search"}},
			},
			Missions: []protocol.MissionInfo{
				{
					Name: "test-mission",
					Inputs: []protocol.MissionInputInfo{
						{Name: "query", Type: "string", Required: true},
					},
					Tasks: []protocol.TaskInfo{
						{Name: "search", Agent: "test-agent"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new request: %v", err)
	}

	sendEnvelope(t, ws, req)
	resp := readEnvelope(t, ws)

	if resp.Type != protocol.TypeRegisterAck {
		t.Fatalf("expected register_ack, got %s", resp.Type)
	}

	var ack protocol.RegisterAckPayload
	if err := protocol.DecodePayload(resp, &ack); err != nil {
		t.Fatalf("decode ack: %v", err)
	}
	if !ack.Accepted {
		t.Fatalf("registration rejected: %s", ack.Reason)
	}

	return ack.InstanceID
}

func TestRegister(t *testing.T) {
	h, srv := setupTestServer(t)
	ws := dialWS(t, srv)

	instanceID := registerInstance(t, ws, "prod-scraper")

	if instanceID == "" {
		t.Fatal("expected non-empty instance ID")
	}

	// Verify instance appears in registry
	instance := h.GetRegistry().GetInstance(instanceID)
	if instance == nil {
		t.Fatal("instance not found in registry")
	}
	if instance.Name != "prod-scraper" {
		t.Errorf("expected name 'prod-scraper', got %q", instance.Name)
	}
	if !instance.Connected {
		t.Error("expected instance to be connected")
	}
	if instance.Version != "1.0.0" {
		t.Errorf("expected version '1.0.0', got %q", instance.Version)
	}
	if len(instance.Config.Models) != 1 {
		t.Errorf("expected 1 model, got %d", len(instance.Config.Models))
	}
}

func TestListInstances(t *testing.T) {
	h, srv := setupTestServer(t)

	// Initially empty
	instances := h.GetRegistry().ListInstances()
	if len(instances) != 0 {
		t.Fatalf("expected 0 instances, got %d", len(instances))
	}

	// Register two instances
	ws1 := dialWS(t, srv)
	registerInstance(t, ws1, "instance-1")

	ws2 := dialWS(t, srv)
	registerInstance(t, ws2, "instance-2")

	instances = h.GetRegistry().ListInstances()
	if len(instances) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(instances))
	}
}

func TestReconnect(t *testing.T) {
	h, srv := setupTestServer(t)

	// Connect and register
	ws1 := dialWS(t, srv)
	instanceID := registerInstance(t, ws1, "reconnect-test")

	// Disconnect
	ws1.Close()
	time.Sleep(100 * time.Millisecond) // Give read pump time to detect close

	instance := h.GetRegistry().GetInstance(instanceID)
	if instance == nil {
		t.Fatal("instance should still be in registry after disconnect")
	}
	if instance.Connected {
		t.Error("instance should be disconnected")
	}

	// Reconnect with same name
	ws2 := dialWS(t, srv)
	newID := registerInstance(t, ws2, "reconnect-test")

	if newID != instanceID {
		t.Errorf("expected same instance ID %q on reconnect, got %q", instanceID, newID)
	}

	instance = h.GetRegistry().GetInstance(instanceID)
	if !instance.Connected {
		t.Error("instance should be connected after reconnect")
	}
}

func TestHeartbeat(t *testing.T) {
	_, srv := setupTestServer(t)
	ws := dialWS(t, srv)
	registerInstance(t, ws, "heartbeat-test")

	// Drain the auto-subscribe message sent after registration
	readEnvelope(t, ws)

	// Send heartbeat
	req, err := protocol.NewRequest(protocol.TypeHeartbeat, &protocol.HeartbeatPayload{})
	if err != nil {
		t.Fatalf("new heartbeat: %v", err)
	}
	sendEnvelope(t, ws, req)

	resp := readEnvelope(t, ws)
	if resp.Type != protocol.TypeHeartbeatAck {
		t.Errorf("expected heartbeat_ack, got %s", resp.Type)
	}
}

func TestWorkerPresencePersistsHeartbeatAndDisconnect(t *testing.T) {
	store := &recordingWorkerStore{
		disconnected: make(chan string, 1),
		touched:      make(chan string, 1),
	}
	h := hub.New(false, store)
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	header := http.Header{"Authorization": []string{"Bearer worker-credential"}}
	ws, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.Fatalf("dial authenticated worker: %v", err)
	}

	registerInstance(t, ws, "ignored-worker-name")
	readEnvelope(t, ws) // Drain the global subscribe message.

	heartbeat, err := protocol.NewRequest(protocol.TypeHeartbeat, &protocol.HeartbeatPayload{})
	if err != nil {
		t.Fatalf("new heartbeat: %v", err)
	}
	sendEnvelope(t, ws, heartbeat)
	if response := readEnvelope(t, ws); response.Type != protocol.TypeHeartbeatAck {
		t.Fatalf("expected heartbeat_ack, got %s", response.Type)
	}
	select {
	case workspaceID := <-store.touched:
		if workspaceID != "workspace-1" {
			t.Fatalf("touched workspace %q", workspaceID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for persisted heartbeat")
	}

	if err := ws.Close(); err != nil {
		t.Fatalf("close worker websocket: %v", err)
	}
	select {
	case workspaceID := <-store.disconnected:
		if workspaceID != "workspace-1" {
			t.Fatalf("disconnected workspace %q", workspaceID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for persisted disconnect")
	}
}

func TestSendRequest(t *testing.T) {
	h, srv := setupTestServer(t)
	ws := dialWS(t, srv)
	instanceID := registerInstance(t, ws, "request-test")

	// Drain auto-subscribe
	readEnvelope(t, ws)

	// Commander sends a get_config request to the instance via hub
	go func() {
		req, _ := protocol.NewRequest(protocol.TypeGetConfig, &protocol.GetConfigPayload{})
		resp, err := h.SendRequest(instanceID, req, 5*time.Second)
		if err != nil {
			t.Errorf("SendRequest: %v", err)
			return
		}
		if resp.Type != protocol.TypeGetConfigResult {
			t.Errorf("expected get_config_result, got %s", resp.Type)
		}
	}()

	// Instance receives the request and responds
	incoming := readEnvelope(t, ws)
	if incoming.Type != protocol.TypeGetConfig {
		t.Fatalf("expected get_config, got %s", incoming.Type)
	}

	resp, _ := protocol.NewResponse(incoming.RequestID, protocol.TypeGetConfigResult, &protocol.GetConfigResultPayload{
		Config: protocol.InstanceConfig{
			Models: []protocol.ModelInfo{{Name: "m1", Provider: "openai", Model: "gpt-4"}},
		},
	})
	sendEnvelope(t, ws, resp)

	// Give goroutine time to complete
	time.Sleep(200 * time.Millisecond)
}

func TestSendRequestDisconnected(t *testing.T) {
	h, _ := setupTestServer(t)

	req, _ := protocol.NewRequest(protocol.TypeGetConfig, &protocol.GetConfigPayload{})
	_, err := h.SendRequest("nonexistent", req, 1*time.Second)
	if err != hub.ErrInstanceDisconnected {
		t.Errorf("expected ErrInstanceDisconnected, got %v", err)
	}
}

func TestMissionEventFanOut(t *testing.T) {
	h, srv := setupTestServer(t)
	ws := dialWS(t, srv)
	instanceID := registerInstance(t, ws, "event-test")

	// Drain auto-subscribe
	readEnvelope(t, ws)

	conn := h.GetConnection(instanceID)
	if conn == nil {
		t.Fatal("expected connection")
	}

	// Subscribe to mission events
	ch, cleanup := conn.SubscribeMissionEvents("mission-123")
	defer cleanup()

	// Send a mission event from the "instance"
	eventEnv, _ := protocol.NewEvent(protocol.TypeMissionEvent, &protocol.MissionEventPayload{
		MissionID: "mission-123",
		EventType: protocol.EventTaskStarted,
		Data: protocol.TaskStartedData{
			TaskName:  "search",
			Objective: "Find results",
		},
	})
	sendEnvelope(t, ws, eventEnv)

	// Wait for fan-out
	select {
	case event := <-ch:
		if event.MissionID != "mission-123" {
			t.Errorf("expected mission-123, got %s", event.MissionID)
		}
		if event.EventType != protocol.EventTaskStarted {
			t.Errorf("expected task_started, got %s", event.EventType)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for mission event")
	}
}

func TestGlobalSubscribeOnRegister(t *testing.T) {
	_, srv := setupTestServer(t)
	ws := dialWS(t, srv)

	// Register — should trigger a global subscribe message back to the instance
	registerInstance(t, ws, "sub-test")

	// Read the subscribe message that the hub sends after registration
	env := readEnvelope(t, ws)
	if env.Type != protocol.TypeSubscribe {
		t.Fatalf("expected subscribe message after register, got %s", env.Type)
	}

	var payload protocol.SubscribePayload
	if err := protocol.DecodePayload(env, &payload); err != nil {
		t.Fatalf("decode subscribe: %v", err)
	}
	if payload.Scope != "global" {
		t.Errorf("expected global scope, got %s", payload.Scope)
	}
}

func TestSendMessageFireAndForget(t *testing.T) {
	h, srv := setupTestServer(t)
	ws := dialWS(t, srv)
	instanceID := registerInstance(t, ws, "msg-test")

	// Drain the auto-subscribe message
	readEnvelope(t, ws)

	// Send a fire-and-forget message
	env, _ := protocol.NewRequest(protocol.TypeSubscribe, &protocol.SubscribePayload{
		Scope:     "mission",
		MissionID: "test-mission-1",
	})
	err := h.SendMessage(instanceID, env)
	if err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	// Instance should receive it
	received := readEnvelope(t, ws)
	if received.Type != protocol.TypeSubscribe {
		t.Fatalf("expected subscribe, got %s", received.Type)
	}

	var payload protocol.SubscribePayload
	if err := protocol.DecodePayload(received, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.MissionID != "test-mission-1" {
		t.Errorf("expected mission test-mission-1, got %s", payload.MissionID)
	}
}

func TestSendMessageDisconnected(t *testing.T) {
	h, srv := setupTestServer(t)
	_ = srv // keep server alive

	env, _ := protocol.NewRequest(protocol.TypeSubscribe, &protocol.SubscribePayload{
		Scope: "global",
	})
	err := h.SendMessage("nonexistent", env)
	if err == nil {
		t.Fatal("expected error for disconnected instance")
	}
}
