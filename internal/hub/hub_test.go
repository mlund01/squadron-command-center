package hub_test

import (
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

func TestSendRequest(t *testing.T) {
	h, srv := setupTestServer(t)
	ws := dialWS(t, srv)
	instanceID := registerInstance(t, ws, "request-test")

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
