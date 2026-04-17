package auth

import (
	"context"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Provider drives the configured auth backend. In OIDC mode it wraps a
// discovered OIDC provider and handles the auth-code flow; in basic mode it
// holds the username/password hash and an in-memory brute-force limiter.
type Provider struct {
	cfg       *Config
	oauth     *oauth2.Config
	verifier  *oidc.IDTokenVerifier
	logoutURL string // end_session_endpoint from discovery; may be empty
	limiter   *bruteForceLimiter
}

// NewProvider builds a Provider for the configured mode. For OIDC it performs
// discovery against cfg.IssuerURL at startup — discovery failure is fatal, we
// don't want to silently run without the endpoints. For basic mode there is
// no network call.
func NewProvider(ctx context.Context, cfg *Config) (*Provider, error) {
	if cfg == nil {
		return nil, fmt.Errorf("auth: nil config")
	}
	if cfg.Mode == ModeBasic {
		return &Provider{cfg: cfg, limiter: newBruteForceLimiter()}, nil
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
