package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type fakeWorkspaceStore struct {
	user       controlplane.User
	workspaces []controlplane.Workspace
	created    controlplane.Workspace
	worker     controlplane.WorkspaceWorker
	credential string
}

func (s *fakeWorkspaceStore) UserForSubject(_ context.Context, _ string) (controlplane.User, error) {
	return s.user, nil
}

func (s *fakeWorkspaceStore) ListWorkspaces(context.Context) ([]controlplane.Workspace, error) {
	return s.workspaces, nil
}

func (s *fakeWorkspaceStore) CreateWorkspace(_ context.Context, owner controlplane.User, name, repositoryURL string) (controlplane.Workspace, error) {
	s.created = controlplane.Workspace{
		ID:            "workspace-1",
		Name:          name,
		RepositoryURL: repositoryURL,
		DefaultBranch: "main",
		CreatedBy:     owner.ID,
		CreatedAt:     time.Now().UTC(),
	}
	return s.created, nil
}

func (s *fakeWorkspaceStore) ProvisionWorkspaceWorker(_ context.Context, workspaceID, credential string) (controlplane.WorkspaceWorker, error) {
	s.credential = credential
	s.worker = controlplane.WorkspaceWorker{ID: "worker-1", WorkspaceID: workspaceID, Status: "pending"}
	return s.worker, nil
}

func (s *fakeWorkspaceStore) RevealWorkspaceWorkerCredential(_ context.Context, workspaceID string) (string, error) {
	if workspaceID != "workspace-1" {
		return "", controlplane.ErrWorkerNotFound
	}
	return "worker-secret", nil
}

func TestCreateWorkspaceForAdmin(t *testing.T) {
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleAdmin}}
	body := bytes.NewBufferString(`{"name":"launch","repositoryUrl":"https://github.com/acme/launch"}`)
	request := authenticatedRequest(http.MethodPost, "/api/workspaces", body)
	response := httptest.NewRecorder()

	handleCreateWorkspace(store)(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("POST /api/workspaces = %d: %s", response.Code, response.Body.String())
	}
	if store.created.Name != "launch" || store.created.CreatedBy != "user-1" {
		t.Fatalf("created workspace = %#v", store.created)
	}
}

func TestCreateWorkspaceRejectsMember(t *testing.T) {
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleMember}}
	request := authenticatedRequest(http.MethodPost, "/api/workspaces", bytes.NewBufferString(`{"name":"launch"}`))
	response := httptest.NewRecorder()

	handleCreateWorkspace(store)(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("POST /api/workspaces as member = %d", response.Code)
	}
}

func TestListWorkspaces(t *testing.T) {
	store := &fakeWorkspaceStore{
		user:       controlplane.User{ID: "user-1", Role: controlplane.RoleAdmin},
		workspaces: []controlplane.Workspace{{ID: "workspace-1", Name: "launch", DefaultBranch: "main"}},
	}
	request := authenticatedRequest(http.MethodGet, "/api/workspaces", nil)
	response := httptest.NewRecorder()

	handleListWorkspaces(store)(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET /api/workspaces = %d", response.Code)
	}
	var payload struct {
		Workspaces []controlplane.Workspace `json:"workspaces"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Workspaces) != 1 || payload.Workspaces[0].Name != "launch" {
		t.Fatalf("workspaces = %#v", payload.Workspaces)
	}
}

func TestGetWorkspaceConfig(t *testing.T) {
	commandHub := hub.New(false)
	commandHub.GetRegistry().Register(protocol.RegisterPayload{
		InstanceName: "workspace-runner",
		ConfigReady:  true,
		Config: protocol.InstanceConfig{Missions: []protocol.MissionInfo{
			{Name: "release", Tasks: []protocol.TaskInfo{{Name: "verify"}}},
		}},
	}, "workspace-1")
	request := httptest.NewRequest(http.MethodGet, "/api/workspaces/workspace-1/config", nil)
	request.SetPathValue("id", "workspace-1")
	response := httptest.NewRecorder()

	handleGetWorkspaceConfig(commandHub)(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET workspace config = %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Config protocol.InstanceConfig `json:"config"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Config.Missions) != 1 || payload.Config.Missions[0].Name != "release" {
		t.Fatalf("config missions = %#v", payload.Config.Missions)
	}
}

func TestGetWorkspaceConfigBeforeRunnerConnects(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/workspaces/workspace-1/config", nil)
	request.SetPathValue("id", "workspace-1")
	response := httptest.NewRecorder()

	handleGetWorkspaceConfig(hub.New(false))(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("GET workspace config = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestProvisionWorkerForAdmin(t *testing.T) {
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleAdmin}}
	request := authenticatedRequest(http.MethodPost, "/api/workspaces/workspace-1/worker-enrollment", nil)
	request.SetPathValue("id", "workspace-1")
	response := httptest.NewRecorder()

	handleProvisionWorker(store, "https://command.example.com")(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("POST worker enrollment = %d: %s", response.Code, response.Body.String())
	}
	if store.worker.WorkspaceID != "workspace-1" || store.credential == "" {
		t.Fatalf("provisioned worker = %#v, credential = %q", store.worker, store.credential)
	}
	var payload struct {
		CommandCenterURL string `json:"commandCenterURL"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode enrollment response: %v", err)
	}
	if payload.CommandCenterURL != "wss://command.example.com/ws" {
		t.Fatalf("command center URL = %q", payload.CommandCenterURL)
	}
}

func TestRevealWorkerCredentialForAdmin(t *testing.T) {
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleAdmin}}
	request := authenticatedRequest(http.MethodGet, "/api/workspaces/workspace-1/worker-credential", nil)
	request.SetPathValue("id", "workspace-1")
	response := httptest.NewRecorder()

	handleRevealWorkerCredential(store, "https://command.example.com")(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET worker credential = %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Credential       string `json:"credential"`
		CommandCenterURL string `json:"commandCenterURL"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode credential response: %v", err)
	}
	if payload.Credential != "worker-secret" {
		t.Fatalf("credential = %q", payload.Credential)
	}
	if payload.CommandCenterURL != "wss://command.example.com/ws" {
		t.Fatalf("command center URL = %q", payload.CommandCenterURL)
	}
}

func authenticatedRequest(method, target string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, target, body)
	return request.WithContext(auth.WithSession(request.Context(), &auth.Session{Sub: "user-1"}))
}
