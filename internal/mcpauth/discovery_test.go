package mcpauth

import (
	"reflect"
	"testing"
)

func TestProtectedResourceMetadataCandidates(t *testing.T) {
	got, err := ProtectedResourceMetadataCandidates("https://mcp.example/public/mcp")
	if err != nil {
		t.Fatal(err)
	}
	want := []ProtectedResourceMetadataCandidate{
		{URL: "https://mcp.example/.well-known/oauth-protected-resource/public/mcp", ResourceIdentifier: "https://mcp.example/public/mcp"},
		{URL: "https://mcp.example/.well-known/oauth-protected-resource", ResourceIdentifier: "https://mcp.example"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
	root, err := ProtectedResourceMetadataCandidates("https://mcp.example")
	if err != nil || !reflect.DeepEqual(root, want[1:]) {
		t.Fatalf("root candidates = %#v, %v", root, err)
	}
}

func TestAuthorizationServerMetadataCandidates(t *testing.T) {
	got, err := AuthorizationServerMetadataURLs("https://auth.example/tenant1")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"https://auth.example/.well-known/oauth-authorization-server/tenant1",
		"https://auth.example/.well-known/openid-configuration/tenant1",
		"https://auth.example/tenant1/.well-known/openid-configuration",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
	root, err := AuthorizationServerMetadataURLs("https://auth.example")
	if err != nil || len(root) != 2 || root[0] != "https://auth.example/.well-known/oauth-authorization-server" {
		t.Fatalf("root candidates = %#v, %v", root, err)
	}
}

func TestDiscoveryRejectsIssuerSubstitution(t *testing.T) {
	resource := "https://mcp.example/mcp"
	if _, err := DecodeProtectedResourceMetadata([]byte(`{"resource":"https://other.example/mcp","authorization_servers":["https://auth.example"]}`), resource); err == nil {
		t.Fatal("accepted metadata for another protected resource")
	}
	if _, err := DecodeProtectedResourceMetadata([]byte(`{"resource":"https://mcp.example/mcp","authorization_servers":[]}`), resource); err == nil {
		t.Fatal("accepted resource metadata without an authorization server")
	}
	if _, err := DecodeAuthorizationServerMetadata([]byte(`{"issuer":"https://other.example","authorization_endpoint":"https://auth.example/authorize","token_endpoint":"https://auth.example/token"}`), "https://auth.example"); err == nil {
		t.Fatal("accepted metadata for another issuer")
	}
	if _, err := DecodeAuthorizationServerMetadata([]byte(`{"issuer":"https://auth.example","authorization_endpoint":"https://auth.example/authorize","token_endpoint":"https://auth.example/token"}`), "https://auth.example"); err != nil {
		t.Fatalf("valid authorization metadata rejected: %v", err)
	}
	if _, err := DecodeAuthorizationServerMetadata([]byte(`{"issuer":"https://auth.example","authorization_endpoint":"https://auth.example/authorize","token_endpoint":"http://auth.example/token"}`), "https://auth.example"); err == nil {
		t.Fatal("accepted insecure token endpoint for HTTPS issuer")
	}
}

func TestDiscoveryRejectsMalformedURLs(t *testing.T) {
	for _, raw := range []string{"mcp.example/mcp", "https://user:pass@mcp.example/mcp", "https://mcp.example/mcp#fragment", "https://mcp.example/mcp?token=secret", "ftp://mcp.example/mcp"} {
		if _, err := ProtectedResourceMetadataCandidates(raw); err == nil {
			t.Errorf("accepted malformed resource %q", raw)
		}
	}
	for _, raw := range []string{"https://auth.example/tenant?query=1", "https://auth.example/tenant#fragment"} {
		if _, err := AuthorizationServerMetadataURLs(raw); err == nil {
			t.Errorf("accepted malformed issuer %q", raw)
		}
	}
}
