package mcptools

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"commander/internal/mcpauth"
	client "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

const maxResponseBytes = 2 << 20

var ErrEndpointNotFound = errors.New("MCP endpoint not found")

type Tool struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// List makes a read-only MCP tools/list request with the selected identity's
// credential. Its HTTP client pins every request, including legacy SSE's
// advertised message endpoint, to the configured public MCP origin.
func List(ctx context.Context, serverURL string, headers map[string]string) ([]Tool, error) {
	if !mcpauth.PublicHTTPS(serverURL) {
		return nil, fmt.Errorf("MCP tool discovery requires public HTTPS")
	}
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.RawQuery != "" || parsed.User != nil {
		return nil, fmt.Errorf("invalid MCP server URL")
	}
	return listWithClient(ctx, serverURL, headers, mcpauth.PublicHTTPClient())
}

func listWithClient(ctx context.Context, serverURL string, headers map[string]string, httpClient *http.Client) ([]Tool, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return nil, err
	}
	httpClient = &http.Client{Transport: &sameOriginTransport{base: httpClient.Transport, origin: parsed.Scheme + "://" + parsed.Host}, Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	var mcpClient *client.Client
	if strings.HasSuffix(strings.TrimSuffix(parsed.Path, "/"), "/sse") {
		mcpClient, err = client.NewSSEMCPClient(serverURL, client.WithHeaders(headers), client.WithHTTPClient(httpClient))
	} else {
		mcpClient, err = client.NewStreamableHttpClient(serverURL, transport.WithHTTPHeaders(headers), transport.WithHTTPBasicClient(httpClient))
	}
	if err != nil {
		return nil, err
	}
	defer mcpClient.Close()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if err := mcpClient.Start(ctx); err != nil {
		return nil, err
	}
	initialize := mcp.InitializeRequest{}
	initialize.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initialize.Params.ClientInfo = mcp.Implementation{Name: "squadron-command-center", Version: "dev"}
	if _, err := mcpClient.Initialize(ctx, initialize); err != nil {
		return nil, err
	}
	result, err := mcpClient.ListTools(ctx, mcp.ListToolsRequest{})
	if err != nil {
		return nil, err
	}
	tools := make([]Tool, 0, len(result.Tools))
	for _, item := range result.Tools {
		tools = append(tools, Tool{Name: item.Name, Description: item.Description})
	}
	sort.Slice(tools, func(i, j int) bool { return tools[i].Name < tools[j].Name })
	return tools, nil
}

type sameOriginTransport struct {
	base   http.RoundTripper
	origin string
}

func (t *sameOriginTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme+"://"+request.URL.Host != t.origin {
		return nil, fmt.Errorf("MCP tool request left the configured server origin")
	}
	response, err := t.base.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusNotFound {
		response.Body.Close()
		return nil, ErrEndpointNotFound
	}
	response.Body = &limitedBody{Reader: io.LimitReader(response.Body, maxResponseBytes+1), Closer: response.Body}
	return response, nil
}

type limitedBody struct {
	io.Reader
	io.Closer
}
