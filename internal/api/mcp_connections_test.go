package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"commander/internal/auth"
	"commander/internal/controlplane"
)

const (
	mcpTestUserID      = "cdb2377b-4a40-41f8-803d-a06ea9e88a2c"
	mcpTestPrincipalID = "49fdb7f1-c441-48ba-ad2c-28f27a6c9bd9"
	mcpTestWorkspaceID = "364ff523-97a0-4654-a390-e3420b4f58b9"
)

type mcpCredentialTestStore struct {
	role      string
	listed    controlplane.MCPIdentity
	revoked   controlplane.MCPIdentity
	items     []controlplane.MCPConnectionCredential
	revokeErr error
}

func (s *mcpCredentialTestStore) UserForSubject(context.Context, string) (controlplane.User, error) {
	return controlplane.User{ID: mcpTestUserID, Role: s.role}, nil
}

func (s *mcpCredentialTestStore) ListMCPConnectionCredentials(_ context.Context, identity controlplane.MCPIdentity) ([]controlplane.MCPConnectionCredential, error) {
	s.listed = identity
	return s.items, nil
}

func (s *mcpCredentialTestStore) RevokeMCPConnectionCredential(_ context.Context, _, _ string, identity controlplane.MCPIdentity) error {
	s.revoked = identity
	return s.revokeErr
}

func mcpSessionRequest(method, path, kind string) *http.Request {
	request := httptest.NewRequest(method, path, nil)
	return request.WithContext(auth.WithSession(request.Context(), &auth.Session{Kind: kind, Sub: mcpTestUserID, Expires: time.Now().Add(time.Hour).Unix()}))
}

func TestPersonalMCPConnectionStatusUsesSessionIdentity(t *testing.T) {
	store := &mcpCredentialTestStore{role: controlplane.RoleMember, items: []controlplane.MCPConnectionCredential{{ConnectionName: "linear", Status: "active"}}}
	response := httptest.NewRecorder()
	handleMyMCPConnections(store, store)(response, mcpSessionRequest(http.MethodGet, "/api/me/mcp-connections", "user"))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status = %d, cache = %q", response.Code, response.Header().Get("Cache-Control"))
	}
	if store.listed != (controlplane.MCPIdentity{Kind: "user", ID: mcpTestUserID}) {
		t.Fatalf("listed identity = %#v", store.listed)
	}
	var result struct {
		Connections []controlplane.MCPConnectionCredential `json:"connections"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || len(result.Connections) != 1 {
		t.Fatalf("response = %#v, %v", result, err)
	}
}

func TestPersonalMCPConnectionsRejectServicePrincipalSession(t *testing.T) {
	store := &mcpCredentialTestStore{role: controlplane.RoleAdmin}
	response := httptest.NewRecorder()
	handleMyMCPConnections(store, store)(response, mcpSessionRequest(http.MethodGet, "/api/me/mcp-connections", "service_principal"))
	if response.Code != http.StatusForbidden || store.listed.Kind != "" {
		t.Fatalf("status = %d, listed = %#v", response.Code, store.listed)
	}
}

func TestServicePrincipalMCPConnectionStatusRequiresAdmin(t *testing.T) {
	path := "/api/admin/service-principals/" + mcpTestPrincipalID + "/mcp-connections"
	request := mcpSessionRequest(http.MethodGet, path, "user")
	request.SetPathValue("id", mcpTestPrincipalID)
	store := &mcpCredentialTestStore{role: controlplane.RoleMember}
	response := httptest.NewRecorder()
	handlePrincipalMCPConnections(store, store)(response, request)
	if response.Code != http.StatusForbidden || store.listed.Kind != "" {
		t.Fatalf("member status = %d, listed = %#v", response.Code, store.listed)
	}
	store.role = controlplane.RoleAdmin
	response = httptest.NewRecorder()
	handlePrincipalMCPConnections(store, store)(response, request)
	if response.Code != http.StatusOK || store.listed != (controlplane.MCPIdentity{Kind: "service_principal", ID: mcpTestPrincipalID}) {
		t.Fatalf("admin status = %d, listed = %#v", response.Code, store.listed)
	}
	store.listed = controlplane.MCPIdentity{}
	response = httptest.NewRecorder()
	handlePrincipalMCPConnections(store, store)(response, mcpSessionRequest(http.MethodGet, path, "service_principal"))
	if response.Code != http.StatusForbidden || store.listed.Kind != "" {
		t.Fatalf("principal session status = %d, listed = %#v", response.Code, store.listed)
	}
}

func TestPersonalMCPRevokeAffectsOnlyCurrentUser(t *testing.T) {
	store := &mcpCredentialTestStore{role: controlplane.RoleMember}
	request := mcpSessionRequest(http.MethodDelete, "/api/me/mcp-connections/"+mcpTestWorkspaceID+"/linear", "user")
	request.SetPathValue("workspaceId", mcpTestWorkspaceID)
	request.SetPathValue("connectionName", "linear")
	response := httptest.NewRecorder()
	handleMyMCPConnection(store, store)(response, request)
	if response.Code != http.StatusNoContent || store.revoked != (controlplane.MCPIdentity{Kind: "user", ID: mcpTestUserID}) {
		t.Fatalf("status = %d, revoked = %#v", response.Code, store.revoked)
	}
	store.revokeErr = controlplane.ErrMCPCredentialNotFound
	response = httptest.NewRecorder()
	handleMyMCPConnection(store, store)(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing credential status = %d", response.Code)
	}
	store.revokeErr = errors.New("database unavailable")
	response = httptest.NewRecorder()
	handleMyMCPConnection(store, store)(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("store failure status = %d", response.Code)
	}
}

func TestServicePrincipalMCPRevokeRequiresAdmin(t *testing.T) {
	store := &mcpCredentialTestStore{role: controlplane.RoleMember}
	path := "/api/admin/service-principals/" + mcpTestPrincipalID + "/mcp-connections/" + mcpTestWorkspaceID + "/linear"
	request := mcpSessionRequest(http.MethodDelete, path, "user")
	request.SetPathValue("id", mcpTestPrincipalID)
	request.SetPathValue("workspaceId", mcpTestWorkspaceID)
	request.SetPathValue("connectionName", "linear")
	response := httptest.NewRecorder()
	handlePrincipalMCPConnection(store, store)(response, request)
	if response.Code != http.StatusForbidden || store.revoked.Kind != "" {
		t.Fatalf("member status = %d, revoked = %#v", response.Code, store.revoked)
	}
	store.role = controlplane.RoleAdmin
	response = httptest.NewRecorder()
	handlePrincipalMCPConnection(store, store)(response, request)
	if response.Code != http.StatusNoContent || store.revoked != (controlplane.MCPIdentity{Kind: "service_principal", ID: mcpTestPrincipalID}) {
		t.Fatalf("admin status = %d, revoked = %#v", response.Code, store.revoked)
	}
}
