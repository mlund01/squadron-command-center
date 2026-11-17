package mcpauth

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestDiscoverValidatesResourceAndIssuer(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
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
	got, err := Discover(context.Background(), client, "https://mcp.example/mcp")
	if err != nil {
		t.Fatal(err)
	}
	if got.ResourceURI != "https://mcp.example/mcp" || got.Server.Issuer != "https://auth.example" || !got.Server.AuthorizationResponseISSParameterSupported || len(got.Resource.ScopesSupported) != 1 {
		t.Fatalf("discovery = %#v", got)
	}
}

func TestDiscoverRejectsWrongIssuer(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body := `{"resource":"https://mcp.example/mcp","authorization_servers":["https://auth.example"]}`
		if strings.Contains(request.URL.Path, "oauth-authorization-server") {
			body = `{"issuer":"https://other.example","authorization_endpoint":"https://auth.example/authorize","token_endpoint":"https://auth.example/token"}`
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}
	if _, err := Discover(context.Background(), client, "https://mcp.example/mcp"); err == nil {
		t.Fatal("accepted mismatched issuer")
	}
}

func TestPublicHTTPSRejectsInsecureURL(t *testing.T) {
	for _, value := range []string{"http://mcp.example/mcp", "https://user:pass@mcp.example/mcp", "https://mcp.example/mcp#fragment", "https://local.localhost/mcp"} {
		if PublicHTTPS(value) {
			t.Errorf("accepted %q", value)
		}
	}
}

func TestPublicHTTPClientBlocksLoopback(t *testing.T) {
	_, err := PublicHTTPClient().Get("https://127.0.0.1:8443/.well-known/oauth-protected-resource")
	if err == nil || !strings.Contains(err.Error(), "not publicly reachable") {
		t.Fatalf("loopback request = %v", err)
	}
}

func TestPublicIPRejectsNonPublicRanges(t *testing.T) {
	for _, value := range []string{"127.0.0.1", "10.0.0.1", "100.64.1.1", "198.18.1.1", "203.0.113.1", "2001:db8::1"} {
		if publicIP(net.ParseIP(value)) {
			t.Errorf("accepted %s", value)
		}
	}
	if !publicIP(net.ParseIP("8.8.8.8")) {
		t.Fatal("rejected public IP")
	}
}
