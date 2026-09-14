package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type authorizationTestStore struct {
	role                 string
	identities           []controlplane.MissionRunIdentity
	identitiesErr        error
	canRun               bool
	canRunErr            error
	canRunAs             bool
	canRunAsErr          error
	probe                *authorizationProbe
	canRunSP             bool
	recordedUserRun      *recordedMissionRun
	recordedRunAs        *recordedMissionRunAs
	recordedPrincipalRun *recordedPrincipalMissionRun
}

type authorizationProbe struct {
	runAsPrincipalID string
	runAsWorkspaceID string
	runAsMissionName string
}

type recordedMissionRun struct {
	userID, workspaceID, missionID, missionName string
}

type recordedMissionRunAs struct {
	userID, principalID, workspaceID, missionID, missionName string
}

type recordedPrincipalMissionRun struct {
	principalID, workspaceID, missionID, missionName string
}

func (s authorizationTestStore) UserForSubject(context.Context, string) (controlplane.User, error) {
	return controlplane.User{ID: "user-1", Role: controlplane.RoleMember}, nil
}
func (s authorizationTestStore) WorkspaceRoleForUser(context.Context, controlplane.User, string) (string, error) {
	return s.role, nil
}
func (s authorizationTestStore) CanRunMission(context.Context, controlplane.User, string, string) (bool, error) {
	return s.canRun, s.canRunErr
}
func (s authorizationTestStore) ListMissionRunIdentities(context.Context, controlplane.User, string, string) ([]controlplane.MissionRunIdentity, error) {
	return s.identities, s.identitiesErr
}

func TestMissionRunIdentitiesReturnsEligibleActors(t *testing.T) {
	h := hub.New(false)
	instanceID := h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
	want := []controlplane.MissionRunIdentity{
		{Kind: "user", ID: "user-1", Name: "Test User"},
		{Kind: "service_principal", ID: "sp-1", Name: "Automation"},
	}
	handler := handleMissionRunIdentities(h, authorizationTestStore{identities: want})
	request := httptest.NewRequest(http.MethodGet, "/api/instances/"+instanceID+"/missions/demo/run-identities", nil)
	request.SetPathValue("id", instanceID)
	request.SetPathValue("name", "demo")
	request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{Sub: "user-1", Name: "Test User", Expires: time.Now().Add(time.Hour).Unix()}))
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body struct {
		Identities []controlplane.MissionRunIdentity `json:"identities"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Identities) != 2 || body.Identities[0] != want[0] || body.Identities[1] != want[1] {
		t.Fatalf("identities = %#v, want %#v", body.Identities, want)
	}
}

func TestMissionRunIdentitiesRejectsServicePrincipalSession(t *testing.T) {
	h := hub.New(false)
	instanceID := h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
	handler := handleMissionRunIdentities(h, authorizationTestStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/instances/"+instanceID+"/missions/demo/run-identities", nil)
	request.SetPathValue("id", instanceID)
	request.SetPathValue("name", "demo")
	request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{
		Kind: "service_principal", Sub: "sp-1", Expires: time.Now().Add(time.Hour).Unix(),
	}))
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestMissionRunIdentitiesHandlesAuthorizationFailure(t *testing.T) {
	h := hub.New(false)
	instanceID := h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
	handler := handleMissionRunIdentities(h, authorizationTestStore{identitiesErr: errors.New("database unavailable")})
	request := httptest.NewRequest(http.MethodGet, "/api/instances/"+instanceID+"/missions/demo/run-identities", nil)
	request.SetPathValue("id", instanceID)
	request.SetPathValue("name", "demo")
	request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{
		Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix(),
	}))
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

type missionRunTestProxy struct {
	registry *hub.Registry
	ack      protocol.RunMissionAckPayload
	err      error
	request  *protocol.Envelope
}

func (p *missionRunTestProxy) GetRegistry() *hub.Registry { return p.registry }

func (p *missionRunTestProxy) SendRequest(_ string, request *protocol.Envelope, _ time.Duration) (*protocol.Envelope, error) {
	p.request = request
	if p.err != nil {
		return nil, p.err
	}
	return protocol.NewResponse(request.RequestID, protocol.TypeRunMissionAck, &p.ack)
}

func newMissionRunTestProxy(t *testing.T, ack protocol.RunMissionAckPayload) (*missionRunTestProxy, string) {
	t.Helper()
	registry := hub.NewRegistry()
	instanceID := registry.Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
	return &missionRunTestProxy{registry: registry, ack: ack}, instanceID
}

func missionRunRequest(instanceID, body string, session *auth.Session) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/api/instances/"+instanceID+"/missions/demo/run", strings.NewReader(body))
	request.SetPathValue("id", instanceID)
	request.SetPathValue("name", "demo")
	if session != nil {
		request = request.WithContext(auth.WithSession(request.Context(), session))
	}
	return request
}

func TestRunMissionRejectsUnauthorizedExecutionIdentities(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		session    *auth.Session
		store      authorizationTestStore
		wantStatus int
	}{
		{
			name:       "user without mission grant",
			body:       `{"inputs":{}}`,
			session:    &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:      authorizationTestStore{},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "user selecting unassigned service principal",
			body:       `{"servicePrincipalId":"sp-forged","inputs":{}}`,
			session:    &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:      authorizationTestStore{},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "service principal without mission grant",
			body:       `{"inputs":{}}`,
			session:    &auth.Session{Kind: "service_principal", Sub: "sp-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:      authorizationTestStore{},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "service principal chaining",
			body:       `{"servicePrincipalId":"sp-2","inputs":{}}`,
			session:    &auth.Session{Kind: "service_principal", Sub: "sp-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:      authorizationTestStore{canRunSP: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "authorization backend unavailable",
			body:       `{"servicePrincipalId":"sp-1","inputs":{}}`,
			session:    &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:      authorizationTestStore{canRunAsErr: errors.New("database unavailable")},
			wantStatus: http.StatusServiceUnavailable,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			proxy, instanceID := newMissionRunTestProxy(t, protocol.RunMissionAckPayload{Accepted: true, MissionID: "run-1"})
			response := httptest.NewRecorder()
			handleRunMission(proxy, test.store)(response, missionRunRequest(instanceID, test.body, test.session))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, test.wantStatus, response.Body.String())
			}
			if proxy.request != nil {
				t.Fatal("unauthorized request was dispatched to the workspace runner")
			}
		})
	}
}

func TestRunMissionScopesRunAsAuthorizationToRoute(t *testing.T) {
	probe := &authorizationProbe{}
	store := authorizationTestStore{probe: probe}
	proxy, instanceID := newMissionRunTestProxy(t, protocol.RunMissionAckPayload{Accepted: true, MissionID: "run-1"})
	response := httptest.NewRecorder()
	handleRunMission(proxy, store)(response, missionRunRequest(instanceID, `{"servicePrincipalId":"sp-forged"}`, &auth.Session{
		Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix(),
	}))
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if probe.runAsPrincipalID != "sp-forged" || probe.runAsWorkspaceID != "workspace-1" || probe.runAsMissionName != "demo" {
		t.Fatalf("run-as authorization scope = %#v", probe)
	}
}

func TestRunMissionRecordsEffectiveActorAfterAcceptedDispatch(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		session *auth.Session
		store   authorizationTestStore
		verify  func(*testing.T, authorizationTestStore)
	}{
		{
			name:    "user runs as self",
			body:    `{"inputs":{"topic":"security"}}`,
			session: &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:   authorizationTestStore{canRun: true, recordedUserRun: &recordedMissionRun{}},
			verify: func(t *testing.T, store authorizationTestStore) {
				want := recordedMissionRun{userID: "user-1", workspaceID: "workspace-1", missionID: "run-1", missionName: "demo"}
				if *store.recordedUserRun != want {
					t.Fatalf("recorded user run = %#v, want %#v", *store.recordedUserRun, want)
				}
			},
		},
		{
			name:    "user runs as service principal",
			body:    `{"servicePrincipalId":"sp-1","inputs":{}}`,
			session: &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:   authorizationTestStore{canRunAs: true, recordedRunAs: &recordedMissionRunAs{}},
			verify: func(t *testing.T, store authorizationTestStore) {
				want := recordedMissionRunAs{userID: "user-1", principalID: "sp-1", workspaceID: "workspace-1", missionID: "run-1", missionName: "demo"}
				if *store.recordedRunAs != want {
					t.Fatalf("recorded run-as actor = %#v, want %#v", *store.recordedRunAs, want)
				}
			},
		},
		{
			name:    "service principal runs directly",
			body:    `{"inputs":{}}`,
			session: &auth.Session{Kind: "service_principal", Sub: "sp-1", Expires: time.Now().Add(time.Hour).Unix()},
			store:   authorizationTestStore{canRunSP: true, recordedPrincipalRun: &recordedPrincipalMissionRun{}},
			verify: func(t *testing.T, store authorizationTestStore) {
				want := recordedPrincipalMissionRun{principalID: "sp-1", workspaceID: "workspace-1", missionID: "run-1", missionName: "demo"}
				if *store.recordedPrincipalRun != want {
					t.Fatalf("recorded service principal run = %#v, want %#v", *store.recordedPrincipalRun, want)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			proxy, instanceID := newMissionRunTestProxy(t, protocol.RunMissionAckPayload{Accepted: true, MissionID: "run-1"})
			response := httptest.NewRecorder()
			handleRunMission(proxy, test.store)(response, missionRunRequest(instanceID, test.body, test.session))
			if response.Code != http.StatusAccepted {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusAccepted, response.Body.String())
			}
			if proxy.request == nil || proxy.request.Type != protocol.TypeRunMission {
				t.Fatalf("dispatched request = %#v", proxy.request)
			}
			test.verify(t, test.store)
		})
	}
}

func TestRunMissionDoesNotRecordActorWhenRunnerRejectsRequest(t *testing.T) {
	recorded := &recordedMissionRun{}
	store := authorizationTestStore{canRun: true, recordedUserRun: recorded}
	proxy, instanceID := newMissionRunTestProxy(t, protocol.RunMissionAckPayload{Accepted: false, Reason: "mission already running"})
	response := httptest.NewRecorder()
	handleRunMission(proxy, store)(response, missionRunRequest(instanceID, `{"inputs":{}}`, &auth.Session{
		Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix(),
	}))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if *recorded != (recordedMissionRun{}) {
		t.Fatalf("rejected run was recorded as %#v", *recorded)
	}
}

func TestRunMissionRejectsMalformedBodyBeforeAuthorizationOrDispatch(t *testing.T) {
	proxy, instanceID := newMissionRunTestProxy(t, protocol.RunMissionAckPayload{Accepted: true, MissionID: "run-1"})
	response := httptest.NewRecorder()
	handleRunMission(proxy, authorizationTestStore{canRun: true})(response, missionRunRequest(instanceID, `{`, &auth.Session{
		Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix(),
	}))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if proxy.request != nil {
		t.Fatal("malformed request was dispatched to the workspace runner")
	}
}
func (s authorizationTestStore) CanUserRunAsServicePrincipal(_ context.Context, _ controlplane.User, principalID, workspaceID, missionName string) (bool, error) {
	if s.probe != nil {
		s.probe.runAsPrincipalID = principalID
		s.probe.runAsWorkspaceID = workspaceID
		s.probe.runAsMissionName = missionName
	}
	return s.canRunAs, s.canRunAsErr
}
func (s authorizationTestStore) RecordMissionRunActor(_ context.Context, user controlplane.User, workspaceID, missionID, missionName string) error {
	if s.recordedUserRun != nil {
		*s.recordedUserRun = recordedMissionRun{userID: user.ID, workspaceID: workspaceID, missionID: missionID, missionName: missionName}
	}
	return nil
}
func (s authorizationTestStore) RecordMissionRunAsServicePrincipal(_ context.Context, user controlplane.User, principalID, workspaceID, missionID, missionName string) error {
	if s.recordedRunAs != nil {
		*s.recordedRunAs = recordedMissionRunAs{userID: user.ID, principalID: principalID, workspaceID: workspaceID, missionID: missionID, missionName: missionName}
	}
	return nil
}
func (authorizationTestStore) CanControlMissionRun(context.Context, controlplane.User, string, string) (bool, error) {
	return false, nil
}
func (s authorizationTestStore) CanRunMissionServicePrincipal(context.Context, string, string, string) (bool, error) {
	return s.canRunSP, nil
}
func (s authorizationTestStore) RecordMissionRunServicePrincipal(_ context.Context, principalID, workspaceID, missionID, missionName string) error {
	if s.recordedPrincipalRun != nil {
		*s.recordedPrincipalRun = recordedPrincipalMissionRun{principalID: principalID, workspaceID: workspaceID, missionID: missionID, missionName: missionName}
	}
	return nil
}
func (authorizationTestStore) CanControlMissionRunServicePrincipal(context.Context, string, string, string) (bool, error) {
	return false, nil
}

func TestRequireWorkspaceRoleUsesCumulativeRoles(t *testing.T) {
	tests := []struct {
		name, role, minimum string
		wantStatus          int
	}{
		{name: "reader may read", role: "reader", minimum: "reader", wantStatus: http.StatusNoContent},
		{name: "developer includes reader", role: "developer", minimum: "reader", wantStatus: http.StatusNoContent},
		{name: "reader may not develop", role: "reader", minimum: "developer", wantStatus: http.StatusForbidden},
		{name: "unassigned is denied", role: "", minimum: "reader", wantStatus: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			next := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }
			handler := requireWorkspaceRole(authorizationTestStore{role: test.role}, test.minimum, next)
			request := httptest.NewRequest(http.MethodGet, "/api/workspaces/workspace-1/config", nil)
			request.SetPathValue("id", "workspace-1")
			request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{Sub: "user-1", Expires: time.Now().Add(time.Hour).Unix()}))
			response := httptest.NewRecorder()
			handler(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

func TestRequireInstanceWorkspaceRoleRejectsServicePrincipal(t *testing.T) {
	h := hub.New(false)
	instanceID := h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "test"}, "workspace-1")
	handler := requireInstanceWorkspaceRole(h, authorizationTestStore{role: "admin"}, "reader", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/api/instances/"+instanceID, nil)
	request.SetPathValue("id", instanceID)
	request = request.WithContext(auth.WithSession(request.Context(), &auth.Session{Kind: "service_principal", Sub: "sp-1", Expires: time.Now().Add(time.Hour).Unix()}))
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}
