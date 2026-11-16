// Package mcpauth implements the discovery and validation rules used before
// Command Center starts an identity-scoped MCP authorization flow.
package mcpauth

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

type ProtectedResourceMetadata struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
	ScopesSupported      []string `json:"scopes_supported,omitempty"`
}

type ProtectedResourceMetadataCandidate struct {
	URL                string
	ResourceIdentifier string
}

type AuthorizationServerMetadata struct {
	Issuer                                     string   `json:"issuer"`
	AuthorizationEndpoint                      string   `json:"authorization_endpoint"`
	TokenEndpoint                              string   `json:"token_endpoint"`
	RegistrationEndpoint                       string   `json:"registration_endpoint,omitempty"`
	ScopesSupported                            []string `json:"scopes_supported,omitempty"`
	ClientIDMetadataDocumentSupported          bool     `json:"client_id_metadata_document_supported,omitempty"`
	AuthorizationResponseISSParameterSupported bool     `json:"authorization_response_iss_parameter_supported,omitempty"`
}

func parseAbsoluteURL(raw string) (*url.URL, error) {
	value, err := url.Parse(raw)
	if err != nil || value == nil || (value.Scheme != "https" && value.Scheme != "http") || value.Host == "" || value.User != nil || value.Fragment != "" {
		return nil, fmt.Errorf("invalid absolute HTTP URL")
	}
	return value, nil
}

// ProtectedResourceMetadataCandidates follows MCP's path-specific then root
// well-known fallback. Each candidate carries the exact resource identifier
// that RFC 9728 requires in that document's resource field. A challenged
// resource_metadata URL, when present, takes precedence in the fetcher.
func ProtectedResourceMetadataCandidates(resource string) ([]ProtectedResourceMetadataCandidate, error) {
	parsed, err := parseAbsoluteURL(resource)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" {
		return nil, fmt.Errorf("MCP resource URL cannot include a query")
	}
	origin := parsed.Scheme + "://" + parsed.Host
	root := origin + "/.well-known/oauth-protected-resource"
	path := parsed.EscapedPath()
	if path == "" || path == "/" {
		return []ProtectedResourceMetadataCandidate{{URL: root, ResourceIdentifier: origin}}, nil
	}
	return []ProtectedResourceMetadataCandidate{
		{URL: root + path, ResourceIdentifier: origin + path},
		{URL: root, ResourceIdentifier: origin},
	}, nil
}

// AuthorizationServerMetadataURLs follows the OAuth and OpenID Connect
// discovery priority required for issuers with and without path components.
func AuthorizationServerMetadataURLs(issuer string) ([]string, error) {
	parsed, err := parseAbsoluteURL(issuer)
	if err != nil || parsed.RawQuery != "" {
		return nil, fmt.Errorf("invalid authorization server issuer")
	}
	origin := parsed.Scheme + "://" + parsed.Host
	path := strings.TrimSuffix(parsed.EscapedPath(), "/")
	if path == "" {
		return []string{origin + "/.well-known/oauth-authorization-server", origin + "/.well-known/openid-configuration"}, nil
	}
	return []string{
		origin + "/.well-known/oauth-authorization-server" + path,
		origin + "/.well-known/openid-configuration" + path,
		origin + path + "/.well-known/openid-configuration",
	}, nil
}

func DecodeProtectedResourceMetadata(raw []byte, resourceIdentifier string) (ProtectedResourceMetadata, error) {
	identifier, err := parseAbsoluteURL(resourceIdentifier)
	if err != nil {
		return ProtectedResourceMetadata{}, err
	}
	if identifier.RawQuery != "" {
		return ProtectedResourceMetadata{}, fmt.Errorf("MCP resource identifier cannot include a query")
	}
	var metadata ProtectedResourceMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return ProtectedResourceMetadata{}, fmt.Errorf("decode protected resource metadata: %w", err)
	}
	if metadata.Resource != resourceIdentifier || len(metadata.AuthorizationServers) == 0 {
		return ProtectedResourceMetadata{}, fmt.Errorf("protected resource metadata does not match the MCP server")
	}
	for _, issuer := range metadata.AuthorizationServers {
		if _, err := AuthorizationServerMetadataURLs(issuer); err != nil {
			return ProtectedResourceMetadata{}, fmt.Errorf("invalid authorization server in protected resource metadata: %w", err)
		}
	}
	return metadata, nil
}

func DecodeAuthorizationServerMetadata(raw []byte, expectedIssuer string) (AuthorizationServerMetadata, error) {
	if _, err := AuthorizationServerMetadataURLs(expectedIssuer); err != nil {
		return AuthorizationServerMetadata{}, err
	}
	var metadata AuthorizationServerMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return AuthorizationServerMetadata{}, fmt.Errorf("decode authorization server metadata: %w", err)
	}
	// OAuth metadata issuer comparison is exact, including URL casing and
	// trailing slash. Normalization here would permit issuer confusion.
	if metadata.Issuer != expectedIssuer {
		return AuthorizationServerMetadata{}, fmt.Errorf("authorization server metadata issuer mismatch")
	}
	issuerURL, _ := parseAbsoluteURL(expectedIssuer)
	authorizationURL, err := parseAbsoluteURL(metadata.AuthorizationEndpoint)
	if err != nil || (issuerURL.Scheme == "https" && authorizationURL.Scheme != "https") {
		return AuthorizationServerMetadata{}, fmt.Errorf("invalid authorization endpoint")
	}
	tokenURL, err := parseAbsoluteURL(metadata.TokenEndpoint)
	if err != nil || (issuerURL.Scheme == "https" && tokenURL.Scheme != "https") {
		return AuthorizationServerMetadata{}, fmt.Errorf("invalid token endpoint")
	}
	if metadata.RegistrationEndpoint != "" {
		registrationURL, err := parseAbsoluteURL(metadata.RegistrationEndpoint)
		if err != nil || (issuerURL.Scheme == "https" && registrationURL.Scheme != "https") {
			return AuthorizationServerMetadata{}, fmt.Errorf("invalid registration endpoint")
		}
	}
	return metadata, nil
}
