package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type oauthTestTransport func(*http.Request) (*http.Response, error)

func (fn oauthTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type oauthTestStore struct {
	actor      controlplane.User
	role       string
	attempt    controlplane.MCPOAuthAttempt
	consumed   controlplane.ConsumedMCPOAuthAttempt
	saved      controlplane.NewMCPConnectionCredential
	grants     []controlplane.WorkspaceServicePrincipalGrant
	principals []controlplane.ServicePrincipal
}

func (s *oauthTestStore) UserForSubject(context.Context, string) (controlplane.User, error) {
	return s.actor, nil
}
func (s *oauthTestStore) WorkspaceRoleForUser(context.Context, controlplane.User, string) (string, error) {
	return s.role, nil
}
func (s *oauthTestStore) ListWorkspaceServicePrincipalGrants(context.Context) ([]controlplane.WorkspaceServicePrincipalGrant, error) {
	return s.grants, nil
}
func (s *oauthTestStore) ListServicePrincipals(context.Context) ([]controlplane.ServicePrincipal, error) {
	return s.principals, nil
}
func (s *oauthTestStore) BeginMCPOAuthAttempt(_ context.Context, _ controlplane.User, value controlplane.MCPOAuthAttempt) (controlplane.StartedMCPOAuthAttempt, error) {
	s.attempt = value
	return controlplane.StartedMCPOAuthAttempt{State: "test-state", CodeChallenge: "test-challenge"}, nil
}
func (s *oauthTestStore) ConsumeMCPOAuthAttempt(_ context.Context, state, issuer, actorID string) (controlplane.ConsumedMCPOAuthAttempt, error) {
	if state != "test-state" || issuer != "https://auth.example" || actorID != s.actor.ID {
		return controlplane.ConsumedMCPOAuthAttempt{}, controlplane.ErrMCPOAuthAttemptUnavailable
	}
	return s.consumed, nil
}
func (s *oauthTestStore) ReplaceMCPConnectionCredential(_ context.Context, _, _ string, _ controlplane.MCPIdentity, _ string, value controlplane.NewMCPConnectionCredential) (controlplane.MCPConnectionCredential, error) {
	s.saved = value
	return controlplane.MCPConnectionCredential{}, nil
}

func oauthTestRequest(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r = r.WithContext(auth.WithSession(r.Context(), &auth.Session{Kind: "user", Sub: mcpTestUserID, Expires: time.Now().Add(time.Hour).Unix()}))
	r.Header.Set("Origin", "http://localhost:8081")
	return r
}

func testMCPRegistry() *hub.Hub {
	h := hub.New(false)
	h.GetRegistry().Register(protocol.RegisterPayload{InstanceName: "runner", ConfigReady: true,
		Config: protocol.InstanceConfig{Plugins: []protocol.PluginInfo{{Name: "linear", Kind: "mcp", Path: "https://mcp.example/mcp"}}}}, mcpTestWorkspaceID)
	return h
}

func TestMCPOAuthStartUsesDeclaredResourceAndPKCE(t *testing.T) {
	client := &http.Client{Transport: oauthTestTransport(func(request *http.Request) (*http.Response, error) {
		body := ""
		switch request.URL.String() {
		case "https://mcp.example/.well-known/oauth-protected-resource/mcp":
			body = `{"resource":"https://mcp.example/mcp","authorization_servers":["https://auth.example"],"scopes_supported":["read"]}`
		case "https://auth.example/.well-known/oauth-authorization-server":
			body = `{"issuer":"https://auth.example","authorization_endpoint":"https://auth.example/authorize","token_endpoint":"https://auth.example/token","authorization_response_iss_parameter_supported":true}`
		default:
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	store := &oauthTestStore{actor: controlplane.User{ID: mcpTestUserID}, role: "reader"}
	request := oauthTestRequest(http.MethodPost, "/api/me/mcp-connections/"+mcpTestWorkspaceID+"/linear/authorize", `{"clientId":"registered-client"}`)
	request.SetPathValue("workspaceId", mcpTestWorkspaceID)
	request.SetPathValue("connectionName", "linear")
	response := httptest.NewRecorder()
	handleMCPOAuthStart(testMCPRegistry(), store, "http://localhost:8081", client, false)(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	var result struct {
		AuthorizationURL string `json:"authorizationUrl"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(result.AuthorizationURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.String() == "" || parsed.Host != "auth.example" || query.Get("resource") != "https://mcp.example/mcp" || query.Get("code_challenge") != "test-challenge" || query.Get("code_challenge_method") != "S256" || query.Get("state") != "test-state" || store.attempt.Identity.ID != mcpTestUserID || !store.attempt.IssuerParameterRequired {
		t.Fatalf("authorization URL = %s; attempt = %#v", result.AuthorizationURL, store.attempt)
	}
	if query.Get("redirect_uri") != "http://localhost:8081/api/mcp/oauth/callback" {
		t.Fatalf("redirect URI = %q", query.Get("redirect_uri"))
	}
}

func TestMCPOAuthStartRejectsUntrustedOriginAndUndeclaredResource(t *testing.T) {
	store := &oauthTestStore{actor: controlplane.User{ID: mcpTestUserID}, role: "reader"}
	request := oauthTestRequest(http.MethodPost, "/", `{"clientId":"registered-client"}`)
	request.SetPathValue("workspaceId", mcpTestWorkspaceID)
	request.SetPathValue("connectionName", "other")
	response := httptest.NewRecorder()
	handleMCPOAuthStart(testMCPRegistry(), store, "http://localhost:8081", &http.Client{}, false)(response, request)
	if response.Code != http.StatusUnprocessableEntity || store.attempt.ClientID != "" {
		t.Fatalf("undeclared connector status = %d", response.Code)
	}
	request.Header.Set("Origin", "https://evil.example")
	response = httptest.NewRecorder()
	handleMCPOAuthStart(testMCPRegistry(), store, "http://localhost:8081", &http.Client{}, false)(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d", response.Code)
	}
}

func TestMCPOAuthStartRequiresPrincipalAdminAndWorkspaceAssignment(t *testing.T) {
	store := &oauthTestStore{actor: controlplane.User{ID: mcpTestUserID, Role: controlplane.RoleMember}}
	request := oauthTestRequest(http.MethodPost, "/", `{"clientId":"registered-client"}`)
	request.SetPathValue("id", mcpTestPrincipalID)
	request.SetPathValue("workspaceId", mcpTestWorkspaceID)
	request.SetPathValue("connectionName", "linear")
	response := httptest.NewRecorder()
	handleMCPOAuthStart(testMCPRegistry(), store, "http://localhost:8081", &http.Client{}, true)(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("member status = %d", response.Code)
	}
	store.actor.Role = controlplane.RoleAdmin
	response = httptest.NewRecorder()
	handleMCPOAuthStart(testMCPRegistry(), store, "http://localhost:8081", &http.Client{}, true)(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("unassigned principal status = %d", response.Code)
	}
}

func TestMCPOAuthCallbackStoresOnlyValidatedToken(t *testing.T) {
	store := &oauthTestStore{actor: controlplane.User{ID: mcpTestUserID}, role: "reader", consumed: controlplane.ConsumedMCPOAuthAttempt{
		MCPOAuthAttempt: controlplane.MCPOAuthAttempt{WorkspaceID: mcpTestWorkspaceID, ConnectionName: "linear", Identity: controlplane.MCPIdentity{Kind: "user", ID: mcpTestUserID}, ResourceURI: "https://mcp.example/mcp", ExpectedIssuer: "https://auth.example", TokenEndpoint: "https://auth.example/token", RedirectURI: "http://localhost:8081/api/mcp/oauth/callback", ClientID: "registered-client"}, CodeVerifier: "verifier",
	}}
	client := &http.Client{Transport: oauthTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://auth.example/token" {
			t.Fatalf("token URL = %s", request.URL)
		}
		if err := request.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if request.Form.Get("resource") != "https://mcp.example/mcp" || request.Form.Get("code_verifier") != "verifier" {
			t.Fatalf("token form = %#v", request.Form)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"access_token":"access-secret","refresh_token":"refresh-secret","token_type":"Bearer","expires_in":3600}`)), Header: http.Header{"Content-Type": []string{"application/json"}}}, nil
	})}
	request := oauthTestRequest(http.MethodGet, "/api/mcp/oauth/callback?state=test-state&iss=https%3A%2F%2Fauth.example&code=one-time-code", "")
	response := httptest.NewRecorder()
	handleMCPOAuthCallback(store, client)(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/profile?authorization=connected" || store.saved.Material.AccessToken != "access-secret" || store.saved.Material.RefreshToken != "refresh-secret" {
		t.Fatalf("callback status = %d location = %q saved = %#v", response.Code, response.Header().Get("Location"), store.saved)
	}
	if strings.Contains(response.Body.String(), "secret") {
		t.Fatal("token leaked in callback response")
	}
	request = oauthTestRequest(http.MethodGet, "/api/mcp/oauth/callback?state=test-state&iss=https%3A%2F%2Fevil.example&code=one-time-code", "")
	response = httptest.NewRecorder()
	handleMCPOAuthCallback(store, client)(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("issuer mismatch status = %d", response.Code)
	}
	store.role = ""
	request = oauthTestRequest(http.MethodGet, "/api/mcp/oauth/callback?state=test-state&iss=https%3A%2F%2Fauth.example&code=one-time-code", "")
	response = httptest.NewRecorder()
	handleMCPOAuthCallback(store, client)(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("revoked workspace access status = %d", response.Code)
	}
}
