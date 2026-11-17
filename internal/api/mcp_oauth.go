package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
	"commander/internal/mcpauth"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

type mcpOAuthStore interface {
	controlPlaneUserStore
	WorkspaceRoleForUser(context.Context, controlplane.User, string) (string, error)
	ListWorkspaceServicePrincipalGrants(context.Context) ([]controlplane.WorkspaceServicePrincipalGrant, error)
	ListServicePrincipals(context.Context) ([]controlplane.ServicePrincipal, error)
	BeginMCPOAuthAttempt(context.Context, controlplane.User, controlplane.MCPOAuthAttempt) (controlplane.StartedMCPOAuthAttempt, error)
	ConsumeMCPOAuthAttempt(context.Context, string, string, string) (controlplane.ConsumedMCPOAuthAttempt, error)
	ReplaceMCPConnectionCredential(context.Context, string, string, controlplane.MCPIdentity, string, controlplane.NewMCPConnectionCredential) (controlplane.MCPConnectionCredential, error)
	LoadMCPClientRegistration(context.Context, string, string, controlplane.MCPIdentity, string, string) (string, string, error)
}

type mcpOAuthRegistry interface{ GetRegistry() *hub.Registry }

var mcpOAuthConnectionNamePattern = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

type mcpOAuthStartInput struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

func handleMCPOAuthStart(h mcpOAuthRegistry, store mcpOAuthStore, publicURL string, client *http.Client, principal bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(r.Header.Get("Origin"), publicURL) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "authorization must start from Command Center"})
			return
		}
		if session := auth.SessionFromContext(r.Context()); session == nil || session.Kind == "service_principal" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "a user session is required"})
			return
		}
		actor, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		workspaceID, connectionName := r.PathValue("workspaceId"), r.PathValue("connectionName")
		if _, err := uuid.Parse(workspaceID); err != nil || !mcpOAuthConnectionNamePattern.MatchString(connectionName) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid connector"})
			return
		}
		identity := controlplane.MCPIdentity{Kind: "user", ID: actor.ID}
		if principal {
			if actor.Role != controlplane.RoleAdmin {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "administrator access is required"})
				return
			}
			if _, err := uuid.Parse(r.PathValue("id")); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid service principal ID"})
				return
			}
			identity = controlplane.MCPIdentity{Kind: "service_principal", ID: r.PathValue("id")}
			grants, err := store.ListWorkspaceServicePrincipalGrants(r.Context())
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "principal access unavailable"})
				return
			}
			assigned := false
			for _, grant := range grants {
				if grant.WorkspaceID == workspaceID && grant.ServicePrincipalID == identity.ID {
					assigned = true
					break
				}
			}
			if !assigned {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "service principal has no workspace access"})
				return
			}
			principals, err := store.ListServicePrincipals(r.Context())
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "service principal unavailable"})
				return
			}
			active := false
			for _, candidate := range principals {
				if candidate.ID == identity.ID && candidate.Status == "active" {
					active = true
					break
				}
			}
			if !active {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "service principal is not active"})
				return
			}
		} else {
			role, err := store.WorkspaceRoleForUser(r.Context(), actor, workspaceID)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace access unavailable"})
				return
			}
			if workspaceRoleRank[role] == 0 {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace access is required"})
				return
			}
		}
		var input mcpOAuthStartInput
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid authorization request"})
			return
		}
		input.ClientID = strings.TrimSpace(input.ClientID)
		if len(input.ClientID) > 2048 || len(input.ClientSecret) > 4096 || (input.ClientID == "" && input.ClientSecret != "") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid OAuth client details"})
			return
		}
		instance := h.GetRegistry().GetInstanceByWorkspaceID(workspaceID)
		if instance == nil || !instance.ConfigReady {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace connector configuration is unavailable"})
			return
		}
		resourceURI := ""
		for _, connector := range instance.Config.Plugins {
			if connector.Kind == "mcp" && connector.Name == connectionName {
				resourceURI = connector.Path
				break
			}
		}
		if !mcpauth.PublicHTTPS(resourceURI) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "this connector does not support public HTTPS OAuth discovery"})
			return
		}
		discovery, err := mcpauth.Discover(r.Context(), client, resourceURI)
		if err != nil || !mcpauth.PublicHTTPS(discovery.Server.Issuer) || !mcpauth.PublicHTTPS(discovery.Server.AuthorizationEndpoint) || !mcpauth.PublicHTTPS(discovery.Server.TokenEndpoint) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "MCP OAuth metadata is unavailable or invalid"})
			return
		}
		baseURL, err := url.Parse(publicURL)
		if err != nil || baseURL.Host == "" || (baseURL.Path != "" && baseURL.Path != "/") || baseURL.RawQuery != "" || baseURL.Fragment != "" || (baseURL.Scheme != "https" && !(baseURL.Scheme == "http" && (baseURL.Hostname() == "localhost" || baseURL.Hostname() == "127.0.0.1"))) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Command Center public URL is not configured for OAuth"})
			return
		}
		redirectURI := strings.TrimRight(publicURL, "/") + "/api/mcp/oauth/callback"
		if input.ClientID == "" {
			clientID, clientSecret, err := store.LoadMCPClientRegistration(r.Context(), workspaceID, connectionName, identity, discovery.ResourceURI, discovery.Server.Issuer)
			switch {
			case err == nil:
				input.ClientID, input.ClientSecret = clientID, clientSecret
			case errors.Is(err, controlplane.ErrMCPCredentialNotFound), errors.Is(err, controlplane.ErrMCPConnectionChanged), errors.Is(err, controlplane.ErrMCPAuthorizationServerChanged):
				// Register below for a first connection or a changed server.
			default:
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "existing client registration is unavailable"})
				return
			}
		}
		if input.ClientID == "" {
			if discovery.Server.RegistrationEndpoint == "" {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "this server does not advertise dynamic client registration; enter a registered client ID"})
				return
			}
			registered, err := mcpauth.RegisterClient(r.Context(), client, discovery.Server.RegistrationEndpoint, redirectURI)
			if err != nil {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "automatic client registration failed; enter a registered client ID"})
				return
			}
			input.ClientID, input.ClientSecret = registered.ClientID, registered.ClientSecret
		}
		scopes := discovery.Resource.ScopesSupported
		started, err := store.BeginMCPOAuthAttempt(r.Context(), actor, controlplane.MCPOAuthAttempt{
			WorkspaceID: workspaceID, ConnectionName: connectionName, Identity: identity,
			ResourceURI: discovery.ResourceURI, ExpectedIssuer: discovery.Server.Issuer,
			IssuerParameterRequired: discovery.Server.AuthorizationResponseISSParameterSupported,
			AuthorizationEndpoint:   discovery.Server.AuthorizationEndpoint, TokenEndpoint: discovery.Server.TokenEndpoint,
			RedirectURI: redirectURI, RequestedScopes: scopes, ClientID: input.ClientID, ClientSecret: input.ClientSecret,
		})
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "unable to start authorization"})
			return
		}
		config := oauth2.Config{ClientID: input.ClientID, ClientSecret: input.ClientSecret, RedirectURL: redirectURI, Scopes: scopes,
			Endpoint: oauth2.Endpoint{AuthURL: discovery.Server.AuthorizationEndpoint, TokenURL: discovery.Server.TokenEndpoint}}
		authorizationURL := config.AuthCodeURL(started.State,
			oauth2.SetAuthURLParam("code_challenge", started.CodeChallenge),
			oauth2.SetAuthURLParam("code_challenge_method", "S256"),
			oauth2.SetAuthURLParam("resource", discovery.ResourceURI))
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]string{"authorizationUrl": authorizationURL})
	}
}

func handleMCPOAuthCallback(store mcpOAuthStore, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if session := auth.SessionFromContext(r.Context()); session == nil || session.Kind == "service_principal" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "a user session is required"})
			return
		}
		actor, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		attempt, err := store.ConsumeMCPOAuthAttempt(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("iss"), actor.ID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "authorization response is invalid or expired"})
			return
		}
		if !mcpCallbackIdentityAllowed(r.Context(), store, actor, attempt.MCPOAuthAttempt) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "identity access changed during authorization"})
			return
		}
		returnPath := "/profile"
		if attempt.Identity.Kind == "service_principal" {
			returnPath = "/service-principals/" + attempt.Identity.ID
		}
		if r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
			http.Redirect(w, r, returnPath+"?authorization=failed", http.StatusSeeOther)
			return
		}
		if len(r.URL.Query().Get("code")) > 8192 {
			http.Redirect(w, r, returnPath+"?authorization=failed", http.StatusSeeOther)
			return
		}
		config := oauth2.Config{ClientID: attempt.ClientID, ClientSecret: attempt.ClientSecret, RedirectURL: attempt.RedirectURI,
			Endpoint: oauth2.Endpoint{AuthURL: attempt.AuthorizationEndpoint, TokenURL: attempt.TokenEndpoint}}
		ctx := context.WithValue(r.Context(), oauth2.HTTPClient, client)
		token, err := config.Exchange(ctx, r.URL.Query().Get("code"),
			oauth2.VerifierOption(attempt.CodeVerifier), oauth2.SetAuthURLParam("resource", attempt.ResourceURI))
		if err != nil || token.AccessToken == "" {
			http.Redirect(w, r, returnPath+"?authorization=failed", http.StatusSeeOther)
			return
		}
		var expiry *time.Time
		if !token.Expiry.IsZero() {
			expiry = &token.Expiry
		}
		scopes := attempt.RequestedScopes
		if granted, ok := token.Extra("scope").(string); ok {
			scopes = strings.Fields(granted)
		}
		_, err = store.ReplaceMCPConnectionCredential(r.Context(), attempt.WorkspaceID, attempt.ConnectionName, attempt.Identity, actor.ID,
			controlplane.NewMCPConnectionCredential{Method: "authorization_code", ResourceURI: attempt.ResourceURI,
				Issuer: attempt.ExpectedIssuer, Scopes: scopes, AccessExpiresAt: expiry,
				Material: controlplane.MCPSecretMaterial{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken,
					TokenType: token.TokenType, ClientID: attempt.ClientID, ClientSecret: attempt.ClientSecret}})
		if err != nil {
			http.Redirect(w, r, returnPath+"?authorization=failed", http.StatusSeeOther)
			return
		}
		http.Redirect(w, r, returnPath+"?authorization=connected", http.StatusSeeOther)
	}
}

func mcpCallbackIdentityAllowed(ctx context.Context, store mcpOAuthStore, actor controlplane.User, attempt controlplane.MCPOAuthAttempt) bool {
	switch attempt.Identity.Kind {
	case "user":
		if attempt.Identity.ID != actor.ID {
			return false
		}
		role, err := store.WorkspaceRoleForUser(ctx, actor, attempt.WorkspaceID)
		return err == nil && workspaceRoleRank[role] > 0
	case "service_principal":
		if actor.Role != controlplane.RoleAdmin {
			return false
		}
		grants, err := store.ListWorkspaceServicePrincipalGrants(ctx)
		if err != nil {
			return false
		}
		assigned := false
		for _, grant := range grants {
			if grant.WorkspaceID == attempt.WorkspaceID && grant.ServicePrincipalID == attempt.Identity.ID {
				assigned = true
				break
			}
		}
		if !assigned {
			return false
		}
		principals, err := store.ListServicePrincipals(ctx)
		if err != nil {
			return false
		}
		for _, principal := range principals {
			if principal.ID == attempt.Identity.ID {
				return principal.Status == "active"
			}
		}
	}
	return false
}

func sameOrigin(origin, publicURL string) bool {
	actual, err := url.Parse(origin)
	if err != nil || actual.Scheme == "" || actual.Host == "" || actual.User != nil || actual.Path != "" || actual.RawQuery != "" || actual.Fragment != "" {
		return false
	}
	expected, err := url.Parse(publicURL)
	return err == nil && actual.Scheme == expected.Scheme && actual.Host == expected.Host
}
