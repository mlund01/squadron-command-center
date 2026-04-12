package auth

import (
	"context"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Provider wraps an OIDC provider discovered at startup plus the pieces we
// need to drive the auth-code flow and verify ID tokens.
type Provider struct {
	cfg       *Config
	oauth     *oauth2.Config
	verifier  *oidc.IDTokenVerifier
	logoutURL string // end_session_endpoint from discovery; may be empty
}

// NewProvider performs OIDC discovery against cfg.IssuerURL and returns a
// Provider ready to handle login/callback/logout. Discovery failure is
// fatal — we don't want to silently run without the endpoints.
func NewProvider(ctx context.Context, cfg *Config) (*Provider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("auth: nil config")
	}
	oidcProvider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}

	// Pull end_session_endpoint from discovery — part of OIDC RP-Initiated
	// Logout, exposed by Auth0 and most modern providers. Older providers
	// may omit it, in which case we just clear the local cookie on logout.
	var extra struct {
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	_ = oidcProvider.Claims(&extra)

	oauthCfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Endpoint:     oidcProvider.Endpoint(),
		Scopes:       cfg.Scopes,
	}

	verifier := oidcProvider.Verifier(&oidc.Config{ClientID: cfg.ClientID})

	return &Provider{
		cfg:       cfg,
		oauth:     oauthCfg,
		verifier:  verifier,
		logoutURL: extra.EndSessionEndpoint,
	}, nil
}
