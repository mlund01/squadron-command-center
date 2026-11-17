package mcpauth

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const maxMetadataSize = 1 << 20

var nonPublicRanges = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"), // Shared address space.
	netip.MustParsePrefix("198.18.0.0/15"), // Benchmark networks.
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("2001:db8::/32"),
}

type Discovery struct {
	ResourceURI string
	Resource    ProtectedResourceMetadata
	Server      AuthorizationServerMetadata
}

// Discover reads only metadata advertised by the configured MCP resource.
// The resource and issuer are checked against the documents before use.
func Discover(ctx context.Context, client *http.Client, resourceURI string) (Discovery, error) {
	if !PublicHTTPS(resourceURI) {
		return Discovery{}, fmt.Errorf("MCP OAuth requires a public HTTPS resource")
	}
	candidates, err := ProtectedResourceMetadataCandidates(resourceURI)
	if err != nil {
		return Discovery{}, err
	}
	var resource ProtectedResourceMetadata
	var selected ProtectedResourceMetadataCandidate
	for _, candidate := range candidates {
		body, err := fetchMetadata(ctx, client, candidate.URL)
		if err != nil {
			continue
		}
		resource, err = DecodeProtectedResourceMetadata(body, candidate.ResourceIdentifier)
		if err != nil {
			return Discovery{}, err
		}
		selected = candidate
		break
	}
	if selected.URL == "" {
		return Discovery{}, fmt.Errorf("MCP protected resource metadata unavailable")
	}
	// The first advertised authorization server is the deterministic default.
	issuer := resource.AuthorizationServers[0]
	if !PublicHTTPS(issuer) {
		return Discovery{}, fmt.Errorf("MCP authorization server must use public HTTPS")
	}
	metadataURLs, err := AuthorizationServerMetadataURLs(issuer)
	if err != nil {
		return Discovery{}, err
	}
	for _, metadataURL := range metadataURLs {
		body, err := fetchMetadata(ctx, client, metadataURL)
		if err != nil {
			continue
		}
		server, err := DecodeAuthorizationServerMetadata(body, issuer)
		if err != nil {
			return Discovery{}, err
		}
		return Discovery{ResourceURI: selected.ResourceIdentifier, Resource: resource, Server: server}, nil
	}
	return Discovery{}, fmt.Errorf("MCP authorization server metadata unavailable")
}

func fetchMetadata(ctx context.Context, client *http.Client, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metadata HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxMetadataSize+1))
	if err != nil || len(body) > maxMetadataSize {
		return nil, fmt.Errorf("MCP metadata exceeds size limit")
	}
	return body, nil
}

// PublicHTTPClient prevents a connector's discovery metadata from making
// Command Center issue requests to loopback, private, or link-local services.
// Explicit enterprise network allowlists can be added at this boundary later.
func PublicHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, resolved := range ips {
			ip := resolved.IP
			if !publicIP(ip) {
				continue
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		}
		return nil, fmt.Errorf("MCP authorization endpoint is not publicly reachable")
	}
	return &http.Client{
		Timeout:       10 * time.Second,
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func publicIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok || !addr.IsGlobalUnicast() || addr.IsPrivate() {
		return false
	}
	addr = addr.Unmap()
	for _, prefix := range nonPublicRanges {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

// PublicHTTPS rejects insecure or ambiguous URLs before the network request.
func PublicHTTPS(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil && parsed.Fragment == "" && !strings.HasSuffix(parsed.Hostname(), ".localhost")
}
