package mcpauth

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestRegisterClientRequestsPublicClientWithCallback(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != "https://auth.example/register" || request.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("registration request = %s %s", request.Method, request.URL)
		}
		body, _ := io.ReadAll(request.Body)
		for _, expected := range []string{`"application_type":"native"`, `"token_endpoint_auth_method":"none"`, `"http://localhost:8081/api/mcp/oauth/callback"`} {
			if !strings.Contains(string(body), expected) {
				t.Fatalf("registration body missing %s: %s", expected, body)
			}
		}
		return &http.Response{StatusCode: http.StatusCreated, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"client_id":"generated-client","redirect_uris":["http://localhost:8081/api/mcp/oauth/callback"],"token_endpoint_auth_method":"none"}`))}, nil
	})}
	registered, err := RegisterClient(context.Background(), client, "https://auth.example/register", "http://localhost:8081/api/mcp/oauth/callback")
	if err != nil || registered.ClientID != "generated-client" || registered.ClientSecret != "" {
		t.Fatalf("registration = %#v, %v", registered, err)
	}
}

func TestRegisterClientRejectsWrongCallback(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusCreated, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"client_id":"generated-client","redirect_uris":["https://evil.example/callback"]}`))}, nil
	})}
	if _, err := RegisterClient(context.Background(), client, "https://auth.example/register", "http://localhost:8081/api/mcp/oauth/callback"); err == nil {
		t.Fatal("accepted registration for a different callback")
	}
}
