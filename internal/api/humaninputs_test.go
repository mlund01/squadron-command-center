package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"commander/internal/auth"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type humanInputLookupTestProxy struct {
	registry *hub.Registry
	detail   protocol.GetHumanInputResultPayload
	err      error
	request  *protocol.Envelope
}

func (p *humanInputLookupTestProxy) GetRegistry() *hub.Registry { return p.registry }
func (p *humanInputLookupTestProxy) SendRequest(_ string, request *protocol.Envelope, _ time.Duration) (*protocol.Envelope, error) {
	p.request = request
	if p.err != nil {
		return nil, p.err
	}
	return protocol.NewResponse(request.RequestID, protocol.TypeGetHumanInputResult, &p.detail)
}

func TestHumanInputResponseRequiresMissionRunGrant(t *testing.T) {
	for _, test := range []struct {
		name       string
		canRun     bool
		found      bool
		mission    string
		lookupErr  error
		wantStatus int
		wantAllow  bool
	}{
		{name: "reader without run grant", found: true, mission: "demo", wantStatus: http.StatusForbidden},
		{name: "user with run grant", canRun: true, found: true, mission: "demo", wantStatus: http.StatusOK, wantAllow: true},
		{name: "missing request", wantStatus: http.StatusNotFound},
		{name: "request without mission", canRun: true, found: true, wantStatus: http.StatusForbidden},
		{name: "worker lookup unavailable", lookupErr: errors.New("offline"), wantStatus: http.StatusServiceUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			registry := hub.NewRegistry()
			instanceID := registry.Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
			proxy := &humanInputLookupTestProxy{registry: registry, detail: protocol.GetHumanInputResultPayload{
				Found: test.found, HumanInput: protocol.HumanInputRecord{MissionName: test.mission},
			}, err: test.lookupErr}
			request := httptest.NewRequest(http.MethodPost, "/api/instances/"+instanceID+"/human-inputs/tc-1/resolve", nil)
			request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()}))
			response := httptest.NewRecorder()
			allowed := authorizeHumanInputResponder(response, request, proxy, authorizationTestStore{canRun: test.canRun}, instanceID, "tc-1")
			if allowed != test.wantAllow {
				t.Fatalf("allowed = %v, want %v", allowed, test.wantAllow)
			}
			if !allowed && response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if allowed && (proxy.request == nil || proxy.request.Type != protocol.TypeGetHumanInput) {
				t.Fatal("expected persisted request lookup before answering")
			}
		})
	}
}

func TestHumanInputResolveStatus(t *testing.T) {
	cases := map[string]int{
		"not found":        http.StatusNotFound,
		"already resolved": http.StatusConflict,
		"expired":          http.StatusGone,
		"canceled":         http.StatusGone,
		"unexpected":       http.StatusBadGateway,
	}
	for reason, want := range cases {
		if got := humanInputResolveStatus(reason); got != want {
			t.Errorf("reason %q: got %d, want %d", reason, got, want)
		}
	}
}
