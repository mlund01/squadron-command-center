package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/gorilla/websocket"
	"github.com/mlund01/squadron-wire/protocol"
)

func TestAgentConversationRejectsInvalidRequests(t *testing.T) {
	for _, tc := range []struct {
		name, body, contentType  string
		connected, authenticated bool
		want                     int
	}{
		{"auth required", `{}`, "application/json", true, false, http.StatusUnauthorized},
		{"runner offline", `{}`, "application/json", false, true, http.StatusServiceUnavailable},
		{"invalid JSON", `{`, "application/json", true, true, http.StatusBadRequest},
		{"simple cross-origin POST", `{}`, "text/plain", true, true, http.StatusUnsupportedMediaType},
		{"authoring cannot be task", `{"purpose":"authoring","mode":"task","content":"hello"}`, "application/json", true, true, http.StatusBadRequest},
		{"unknown mode", `{"purpose":"session","mode":"other","content":"hello"}`, "application/json", true, true, http.StatusBadRequest},
		{"empty message", `{"purpose":"session","mode":"interactive","content":"  "}`, "application/json", true, true, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := hub.New(false)
			if tc.connected {
				h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "worker"}, "workspace-1")
			}
			store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleAdmin}}
			request := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(tc.body))
			if tc.authenticated {
				request = authenticatedRequest(http.MethodPost, "/", bytes.NewBufferString(tc.body))
			}
			request.Header.Set("Content-Type", tc.contentType)
			request.SetPathValue("id", "workspace-1")
			request.SetPathValue("name", "reviewer")
			response := httptest.NewRecorder()
			handleAgentConversation(h, store, "send")(response, request)
			if response.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", response.Code, tc.want, response.Body.String())
			}
		})
	}
}

func TestAgentConversationProxyUsesAuthenticatedContext(t *testing.T) {
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
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "authenticated-user", Role: controlplane.RoleAdmin}}
	request := authenticatedRequest(http.MethodPost, "/", bytes.NewBufferString(`{"owner":"spoofed-user","agentName":"wrong-agent","operation":"stop","purpose":"session","mode":"task","mission":"release","content":"test task"}`))
	request.Header.Set("Content-Type", "application/json")
	request.SetPathValue("id", "workspace-1")
	request.SetPathValue("name", "reviewer")
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		handleAgentConversation(h, store, "send")(response, request)
		close(done)
	}()
	var outbound protocol.Envelope
	for {
		if err := ws.ReadJSON(&outbound); err != nil {
			t.Fatal(err)
		}
		if outbound.Type == "agent_conversation" {
			break
		}
	}
	var body agentConversationRequest
	if err := protocol.DecodePayload(&outbound, &body); err != nil {
		t.Fatal(err)
	}
	if body.Owner != "authenticated-user" || body.AgentName != "reviewer" || body.Operation != "send" || body.Mission != "release" || body.Mode != "task" {
		t.Fatalf("wrong trusted context: %#v", body)
	}
	result, _ := protocol.NewResponse(outbound.RequestID, "agent_conversation_result", map[string]any{"sessionId": "cc_test", "running": true})
	if err := ws.WriteJSON(result); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("API did not finish")
	}
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
	var state map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil || state["sessionId"] != "cc_test" {
		t.Fatalf("invalid response: %v, %v", state, err)
	}
}
