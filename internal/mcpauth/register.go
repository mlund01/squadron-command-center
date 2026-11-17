package mcpauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ClientRegistration struct {
	ClientID     string
	ClientSecret string
}

// RegisterClient uses RFC 7591 only when the discovered authorization server
// advertises a registration endpoint. A public client with PKCE is requested.
func RegisterClient(ctx context.Context, client *http.Client, endpoint, redirectURI string) (ClientRegistration, error) {
	if !PublicHTTPS(endpoint) {
		return ClientRegistration{}, fmt.Errorf("MCP client registration endpoint must use public HTTPS")
	}
	callback, err := url.Parse(redirectURI)
	if err != nil || callback.Host == "" || callback.Path == "" {
		return ClientRegistration{}, fmt.Errorf("invalid MCP OAuth callback URL")
	}
	applicationType := "web"
	if callback.Hostname() == "localhost" || callback.Hostname() == "127.0.0.1" {
		applicationType = "native"
	}
	requestBody, err := json.Marshal(map[string]any{
		"client_name":                "Squadron Command Center",
		"redirect_uris":              []string{redirectURI},
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"application_type":           applicationType,
	})
	if err != nil {
		return ClientRegistration{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBody))
	if err != nil {
		return ClientRegistration{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return ClientRegistration{}, fmt.Errorf("MCP client registration unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		return ClientRegistration{}, fmt.Errorf("MCP client registration failed with HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxMetadataSize+1))
	if err != nil || len(data) > maxMetadataSize {
		return ClientRegistration{}, fmt.Errorf("MCP client registration response exceeds size limit")
	}
	var registered struct {
		ClientID                string   `json:"client_id"`
		ClientSecret            string   `json:"client_secret"`
		ClientSecretExpiresAt   *int64   `json:"client_secret_expires_at"`
		RedirectURIs            []string `json:"redirect_uris"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	}
	if err := json.Unmarshal(data, &registered); err != nil {
		return ClientRegistration{}, fmt.Errorf("decode MCP client registration: %w", err)
	}
	if strings.TrimSpace(registered.ClientID) == "" || len(registered.ClientID) > 2048 || len(registered.ClientSecret) > 4096 {
		return ClientRegistration{}, fmt.Errorf("MCP client registration returned invalid client credentials")
	}
	if registered.ClientSecretExpiresAt != nil && *registered.ClientSecretExpiresAt != 0 && *registered.ClientSecretExpiresAt <= time.Now().Unix() {
		return ClientRegistration{}, fmt.Errorf("MCP client registration returned an expired client secret")
	}
	if len(registered.RedirectURIs) > 0 {
		matched := false
		for _, value := range registered.RedirectURIs {
			if value == redirectURI {
				matched = true
				break
			}
		}
		if !matched {
			return ClientRegistration{}, fmt.Errorf("MCP client registration omitted the requested callback URL")
		}
	}
	switch registered.TokenEndpointAuthMethod {
	case "none":
		if registered.ClientSecret != "" {
			return ClientRegistration{}, fmt.Errorf("MCP client registration returned an unexpected client secret")
		}
	case "", "client_secret_basic", "client_secret_post":
		if registered.TokenEndpointAuthMethod != "" && registered.ClientSecret == "" {
			return ClientRegistration{}, fmt.Errorf("MCP client registration omitted its client secret")
		}
	default:
		return ClientRegistration{}, fmt.Errorf("MCP client registration uses an unsupported token authentication method")
	}
	return ClientRegistration{ClientID: registered.ClientID, ClientSecret: registered.ClientSecret}, nil
}
