package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"commander/internal/controlplane"
	"commander/internal/mcptools"
	"github.com/mark3labs/mcp-go/client/transport"
)

type connectionToolsTestStore struct {
	identities []controlplane.MissionRunIdentity
	credential controlplane.MCPConnectionCredential
	material   controlplane.MCPSecretMaterial
	loadErr    error
	loadedAs   controlplane.MCPIdentity
}

func (s *connectionToolsTestStore) UserForSubject(context.Context, string) (controlplane.User, error) {
	return controlplane.User{ID: mcpTestUserID, Name: "Test User", Role: controlplane.RoleMember}, nil
}
func (s *connectionToolsTestStore) ListWorkspaceConnectionIdentities(context.Context, controlplane.User, string) ([]controlplane.MissionRunIdentity, error) {
	return s.identities, nil
}
func (s *connectionToolsTestStore) LoadActiveMCPConnectionCredential(_ context.Context, _, _ string, identity controlplane.MCPIdentity, _ string) (controlplane.MCPConnectionCredential, controlplane.MCPSecretMaterial, error) {
	s.loadedAs = identity
	return s.credential, s.material, s.loadErr
}

func connectionToolsRequest(identity controlplane.MCPIdentity) *http.Request {
	path := "/api/workspaces/" + mcpTestWorkspaceID + "/mcp-connections/linear/tools?identityKind=" + identity.Kind + "&identityId=" + identity.ID
	request := mcpSessionRequest(http.MethodGet, path, "user")
	request.SetPathValue("id", mcpTestWorkspaceID)
	request.SetPathValue("name", "linear")
	return request
}

func TestConnectionToolsOnlyUseAllowedIdentity(t *testing.T) {
	store := &connectionToolsTestStore{identities: []controlplane.MissionRunIdentity{{Kind: "user", ID: mcpTestUserID, Name: "Test User"}}}
	called := false
	handler := handleWorkspaceMCPTools(testMCPRegistry(), store, func(context.Context, string, map[string]string) ([]mcptools.Tool, error) {
		called = true
		return nil, nil
	})
	response := httptest.NewRecorder()
	handler(response, connectionToolsRequest(controlplane.MCPIdentity{Kind: "service_principal", ID: mcpTestPrincipalID}))
	if response.Code != http.StatusForbidden || called || store.loadedAs.Kind != "" {
		t.Fatalf("unauthorized principal: status=%d, called=%v, loaded=%#v", response.Code, called, store.loadedAs)
	}
}

func TestConnectionToolsUseSelectedPrincipalCredential(t *testing.T) {
	principal := controlplane.MCPIdentity{Kind: "service_principal", ID: mcpTestPrincipalID}
	store := &connectionToolsTestStore{
		identities: []controlplane.MissionRunIdentity{{Kind: "user", ID: mcpTestUserID}, {Kind: principal.Kind, ID: principal.ID, Name: "Automation"}},
		credential: controlplane.MCPConnectionCredential{Method: "authorization_code", Status: "active"},
		material:   controlplane.MCPSecretMaterial{AccessToken: "principal-token", TokenType: "bearer"},
	}
	handler := handleWorkspaceMCPTools(testMCPRegistry(), store, func(_ context.Context, url string, headers map[string]string) ([]mcptools.Tool, error) {
		if url != "https://mcp.example/mcp" || headers["Authorization"] != "Bearer principal-token" {
			t.Fatalf("tool request URL=%q headers=%#v", url, headers)
		}
		return []mcptools.Tool{{Name: "principal_tool"}}, nil
	})
	response := httptest.NewRecorder()
	handler(response, connectionToolsRequest(principal))
	var result struct {
		Status string          `json:"status"`
		Tools  []mcptools.Tool `json:"tools"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || response.Code != http.StatusOK || result.Status != "available" || len(result.Tools) != 1 || result.Tools[0].Name != "principal_tool" || store.loadedAs != principal {
		t.Fatalf("result=%#v, status=%d, loaded=%#v, err=%v", result, response.Code, store.loadedAs, err)
	}
}

func TestConnectionToolsReportMissingAuthorization(t *testing.T) {
	store := &connectionToolsTestStore{identities: []controlplane.MissionRunIdentity{{Kind: "user", ID: mcpTestUserID}}, loadErr: controlplane.ErrMCPCredentialNotFound}
	handler := handleWorkspaceMCPTools(testMCPRegistry(), store, func(_ context.Context, _ string, headers map[string]string) ([]mcptools.Tool, error) {
		if len(headers) != 0 {
			t.Fatalf("anonymous tool lookup used headers: %#v", headers)
		}
		return nil, transport.ErrUnauthorized
	})
	response := httptest.NewRecorder()
	handler(response, connectionToolsRequest(controlplane.MCPIdentity{Kind: "user", ID: mcpTestUserID}))
	var result struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.Status != "authorization_required" {
		t.Fatalf("status=%d, result=%#v, err=%v", response.Code, result, err)
	}
}

func TestConnectionToolsReportMissingEndpointSeparatelyFromAuthorization(t *testing.T) {
	store := &connectionToolsTestStore{
		identities: []controlplane.MissionRunIdentity{{Kind: "user", ID: mcpTestUserID}},
		credential: controlplane.MCPConnectionCredential{Method: "authorization_code", Status: "active"},
		material:   controlplane.MCPSecretMaterial{AccessToken: "valid-token", TokenType: "bearer"},
	}
	handler := handleWorkspaceMCPTools(testMCPRegistry(), store, func(context.Context, string, map[string]string) ([]mcptools.Tool, error) {
		return nil, mcptools.ErrEndpointNotFound
	})
	response := httptest.NewRecorder()
	handler(response, connectionToolsRequest(controlplane.MCPIdentity{Kind: "user", ID: mcpTestUserID}))
	var result struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.Status != "endpoint_not_found" {
		t.Fatalf("status=%d, result=%#v, err=%v", response.Code, result, err)
	}
}
