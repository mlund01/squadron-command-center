package mcptools

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func TestListUsesSelectedCredential(t *testing.T) {
	toolServer := func(name string) http.Handler {
		mcpServer := server.NewMCPServer("test", "1.0", server.WithToolCapabilities(false))
		mcpServer.AddTool(mcp.NewTool(name, mcp.WithDescription(name+" description")), func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return mcp.NewToolResultText("ok"), nil
		})
		return server.NewStreamableHTTPServer(mcpServer)
	}
	alice := toolServer("alice_tool")
	bob := toolServer("bob_tool")
	testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Authorization") {
		case "Bearer alice":
			alice.ServeHTTP(w, r)
		case "Bearer bob":
			bob.ServeHTTP(w, r)
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer testServer.Close()
	for _, test := range []struct{ token, name string }{{"alice", "alice_tool"}, {"bob", "bob_tool"}} {
		tools, err := listWithClient(context.Background(), testServer.URL, map[string]string{"Authorization": "Bearer " + test.token}, testServer.Client())
		if err != nil {
			t.Fatal(err)
		}
		if len(tools) != 1 || tools[0].Name != test.name || tools[0].Description != test.name+" description" {
			t.Fatalf("%s tools = %#v", test.token, tools)
		}
	}
	if _, err := listWithClient(context.Background(), testServer.URL, nil, testServer.Client()); !errors.Is(err, transport.ErrUnauthorized) {
		t.Fatalf("anonymous list error = %v, want unauthorized", err)
	}
}

func TestToolTransportRejectsCrossOriginEndpoint(t *testing.T) {
	transport := &sameOriginTransport{base: http.DefaultTransport, origin: "https://mcp.example"}
	request, err := http.NewRequest(http.MethodPost, "https://other.example/mcp", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(request); err == nil {
		t.Fatal("sent selected identity credential to another origin")
	}
}

func TestListReportsRetiredEndpoint(t *testing.T) {
	testServer := httptest.NewServer(http.NotFoundHandler())
	defer testServer.Close()
	_, err := listWithClient(context.Background(), testServer.URL+"/sse", nil, testServer.Client())
	if !errors.Is(err, ErrEndpointNotFound) {
		t.Fatalf("retired endpoint error = %v, want ErrEndpointNotFound", err)
	}
}
