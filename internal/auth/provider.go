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
	cfg               *Config
	oauth             *oauth2.Config
	verifier          *oidc.IDTokenVerifier
	logoutURL         string // end_session_endpoint from discovery; may be empty
	limiter           *bruteForceLimiter
	localStore        LocalStore
	oidcClaimStore    OIDCClaimStore
	setupToken        string
	servicePrincipals ServicePrincipalStore
}

// LocalUser is the minimum user data required for password authentication.
type LocalUser struct {
	ID, Email, Name string
	PasswordHash    []byte
	Role            string
}

// LocalStore keeps local credentials in the Command Center database. The
// interface keeps auth independent from the persistence implementation.
type LocalStore interface {
	IsClaimed(context.Context) (bool, error)
	ClaimInitialAdmin(context.Context, string, string, []byte) (LocalUser, error)
	AuthenticateLocal(context.Context, string) (LocalUser, error)
}

type OIDCClaimStore interface {
	IsClaimed(context.Context) (bool, error)
	ClaimInitialOIDCAdmin(context.Context, string, string, string) (LocalUser, error)
	ResolveOIDCUser(context.Context, string, string, string, string) (LocalUser, error)
}

func (p *Provider) SetOIDCClaimStore(store OIDCClaimStore) { p.oidcClaimStore = store }

type ServicePrincipal struct{ ID, Name string }
type ServicePrincipalStore interface {
	AuthenticateServicePrincipal(context.Context, string) (ServicePrincipal, error)
}

func (p *Provider) SetServicePrincipalStore(store ServicePrincipalStore) { p.servicePrincipals = store }

// NewLocalProvider creates the browser-first local authentication mode used
// when Command Center has no external identity provider configured.
func NewLocalProvider(store LocalStore, cookieSecret []byte, cookieSecure bool, setupToken string) *Provider {
	return &Provider{
		cfg:     &Config{Mode: ModeLocal, CookieSecret: cookieSecret, CookieName: defaultCookieName, CookieSecure: cookieSecure, SessionTTL: defaultSessionTTL},
		limiter: newBruteForceLimiter(), localStore: store, setupToken: setupToken,
	}
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
