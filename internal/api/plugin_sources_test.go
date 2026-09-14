package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"commander/internal/controlplane"
	"commander/internal/hub"
)

func TestPluginSourcesRequireAuthentication(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/workspaces/workspace-1/plugins/demo/files", nil)
	request.SetPathValue("id", "workspace-1")
	request.SetPathValue("name", "demo")
	response := httptest.NewRecorder()

	handleWorkspacePluginFiles(hub.New(false), &fakeWorkspaceStore{})(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET local plugin files = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestPluginSourcesRequireConnectedRunner(t *testing.T) {
	request := authenticatedRequest(http.MethodGet, "/api/workspaces/workspace-1/plugins/demo/files", nil)
	request.SetPathValue("id", "workspace-1")
	request.SetPathValue("name", "demo")
	response := httptest.NewRecorder()
	store := &fakeWorkspaceStore{user: controlplane.User{ID: "user-1", Role: controlplane.RoleMember}}

	handleWorkspacePluginFiles(hub.New(false), store)(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET local plugin files = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}
