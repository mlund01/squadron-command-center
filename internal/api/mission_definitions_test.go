package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"commander/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-wire/protocol"
)

func TestMissionDefinitionRequiresConnectedRunner(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.SetPathValue("id", "workspace-1")
	request.SetPathValue("name", "release")
	response := httptest.NewRecorder()
	handleMissionDefinition(hub.New(false))(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestMissionDefinitionProxiesSourceFromRunner(t *testing.T) {
	h := hub.New(false)
	h.Start()
	defer h.Stop()
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		connection := hub.NewConnection(h, ws, "workspace-1")
		go connection.WritePump()
		connection.ReadPump()
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	register, _ := protocol.NewRequest(protocol.TypeRegister, protocol.RegisterPayload{InstanceName: "worker"})
	if err := ws.WriteJSON(register); err != nil {
		t.Fatal(err)
	}
	var ack protocol.Envelope
	if err := ws.ReadJSON(&ack); err != nil || ack.Type != protocol.TypeRegisterAck {
		t.Fatalf("registration: %s, %v", ack.Type, err)
	}

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.SetPathValue("id", "workspace-1")
	request.SetPathValue("name", "release")
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handleMissionDefinition(h)(response, request)
		close(done)
	}()
	var outbound protocol.Envelope
	for {
		if err := ws.ReadJSON(&outbound); err != nil {
			t.Fatal(err)
		}
		if outbound.Type == "get_mission_definition" {
			break
		}
	}
	var body missionDefinitionRequest
	if outbound.Type != "get_mission_definition" || protocol.DecodePayload(&outbound, &body) != nil || body.MissionName != "release" {
		t.Fatalf("wrong request: %#v, %#v", outbound, body)
	}
	result, _ := protocol.NewResponse(outbound.RequestID, "mission_definition_result", map[string]any{"name": "release", "source": map[string]any{"path": "missions.hcl", "startLine": 2, "content": "mission"}})
	if err := ws.WriteJSON(result); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("API did not finish")
	}
	var payload map[string]any
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &payload) != nil || payload["name"] != "release" {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}
