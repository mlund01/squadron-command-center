package controlplane

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrMCPOAuthAttemptUnavailable = errors.New("MCP authorization attempt is unavailable")
var ErrMCPOAuthIssuerMismatch = errors.New("MCP authorization issuer mismatch")

// MCPOAuthAttempt records the metadata validated before redirecting to an
// authorization server. Client registration and PKCE state remain encrypted.
type MCPOAuthAttempt struct {
	WorkspaceID             string
	ConnectionName          string
	Identity                MCPIdentity
	ResourceURI             string
	ExpectedIssuer          string
	IssuerParameterRequired bool
	AuthorizationEndpoint   string
	TokenEndpoint           string
	RedirectURI             string
	RequestedScopes         []string
	ClientID                string `json:"-"`
	ClientSecret            string `json:"-"`
}

func (MCPOAuthAttempt) String() string { return "[redacted MCP OAuth attempt]" }

// StartedMCPOAuthAttempt contains values for one authorization redirect. The
// code verifier is never returned; only its S256 challenge leaves the store.
type StartedMCPOAuthAttempt struct {
	State         string `json:"state"`
	CodeChallenge string `json:"codeChallenge"`
}

type ConsumedMCPOAuthAttempt struct {
	MCPOAuthAttempt
	CodeVerifier string `json:"-"`
}

type mcpOAuthClientState struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret,omitempty"`
	Verifier     string `json:"verifier"`
}

func (s *Store) BeginMCPOAuthAttempt(ctx context.Context, actor User, value MCPOAuthAttempt) (StartedMCPOAuthAttempt, error) {
	if _, err := uuid.Parse(value.WorkspaceID); err != nil {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("invalid workspace ID")
	}
	if _, err := uuid.Parse(actor.ID); err != nil {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("invalid actor ID")
	}
	if _, err := value.Identity.column(); err != nil {
		return StartedMCPOAuthAttempt{}, err
	}
	if !mcpConnectionNamePattern.MatchString(value.ConnectionName) || value.ResourceURI == "" || value.ExpectedIssuer == "" || value.AuthorizationEndpoint == "" || value.TokenEndpoint == "" || value.RedirectURI == "" || value.ClientID == "" {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("incomplete MCP authorization attempt")
	}
	if value.Identity.Kind == "user" && value.Identity.ID != actor.ID {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("personal MCP authorization must belong to its initiating user")
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM mcp_oauth_attempts WHERE expires_at < NOW() OR consumed_at < NOW() - INTERVAL '1 hour'`); err != nil {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("clear stale MCP authorization attempts: %w", err)
	}
	state, err := randomMCPOAuthSecret()
	if err != nil {
		return StartedMCPOAuthAttempt{}, err
	}
	verifier, err := randomMCPOAuthSecret()
	if err != nil {
		return StartedMCPOAuthAttempt{}, err
	}
	challengeHash := sha256.Sum256([]byte(verifier))
	clientState, err := json.Marshal(mcpOAuthClientState{ClientID: value.ClientID, ClientSecret: value.ClientSecret, Verifier: verifier})
	if err != nil {
		return StartedMCPOAuthAttempt{}, err
	}
	attemptID := uuid.NewString()
	ciphertext, err := s.mcpOAuthCipher.Encrypt(attemptID, clientState)
	if err != nil {
		return StartedMCPOAuthAttempt{}, err
	}
	stateHash := sha256.Sum256([]byte(state))
	_, err = s.pool.Exec(ctx, `INSERT INTO mcp_oauth_attempts(id,state_hash,workspace_id,connection_name,user_id,service_principal_id,resource_uri,expected_issuer,issuer_parameter_required,authorization_endpoint,token_endpoint,redirect_uri,requested_scopes,encrypted_client_state,created_by,expires_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()+INTERVAL '10 minutes')`,
		attemptID, stateHash[:], value.WorkspaceID, value.ConnectionName, mcpUserID(value.Identity), mcpServicePrincipalID(value.Identity), value.ResourceURI, value.ExpectedIssuer, value.IssuerParameterRequired, value.AuthorizationEndpoint, value.TokenEndpoint, value.RedirectURI, value.RequestedScopes, ciphertext, actor.ID)
	if err != nil {
		return StartedMCPOAuthAttempt{}, fmt.Errorf("store MCP authorization attempt: %w", err)
	}
	return StartedMCPOAuthAttempt{State: state, CodeChallenge: base64.RawURLEncoding.EncodeToString(challengeHash[:])}, nil
}

func randomMCPOAuthSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate MCP authorization secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

// ConsumeMCPOAuthAttempt accepts a state only once, including when the
// callback issuer is wrong. The caller must do this before token exchange.
func (s *Store) ConsumeMCPOAuthAttempt(ctx context.Context, state, callbackIssuer, actorID string) (ConsumedMCPOAuthAttempt, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil || len(decoded) != 32 {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthAttemptUnavailable
	}
	if _, err := uuid.Parse(actorID); err != nil {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthAttemptUnavailable
	}
	stateHash := sha256.Sum256([]byte(state))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConsumedMCPOAuthAttempt{}, fmt.Errorf("begin MCP authorization callback: %w", err)
	}
	defer tx.Rollback(ctx)
	var item ConsumedMCPOAuthAttempt
	var attemptID string
	var userID, principalID *string
	var ciphertext []byte
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `SELECT id,workspace_id,connection_name,user_id,service_principal_id,resource_uri,expected_issuer,issuer_parameter_required,authorization_endpoint,token_endpoint,redirect_uri,requested_scopes,encrypted_client_state,expires_at
		FROM mcp_oauth_attempts WHERE state_hash=$1 AND created_by=$2 AND consumed_at IS NULL FOR UPDATE`, stateHash[:], actorID).
		Scan(&attemptID, &item.WorkspaceID, &item.ConnectionName, &userID, &principalID, &item.ResourceURI, &item.ExpectedIssuer, &item.IssuerParameterRequired, &item.AuthorizationEndpoint, &item.TokenEndpoint, &item.RedirectURI, &item.RequestedScopes, &ciphertext, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthAttemptUnavailable
	}
	if err != nil {
		return ConsumedMCPOAuthAttempt{}, fmt.Errorf("load MCP authorization attempt: %w", err)
	}
	if !time.Now().Before(expiresAt) {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthAttemptUnavailable
	}
	if userID != nil {
		item.Identity = MCPIdentity{Kind: "user", ID: *userID}
	} else if principalID != nil {
		item.Identity = MCPIdentity{Kind: "service_principal", ID: *principalID}
	} else {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthAttemptUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE mcp_oauth_attempts SET consumed_at=NOW(),encrypted_client_state=$2 WHERE id=$1`, attemptID, []byte{}); err != nil {
		return ConsumedMCPOAuthAttempt{}, fmt.Errorf("consume MCP authorization attempt: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ConsumedMCPOAuthAttempt{}, fmt.Errorf("commit MCP authorization callback: %w", err)
	}
	if !validMCPOAuthIssuer(item.ExpectedIssuer, callbackIssuer, item.IssuerParameterRequired) {
		return ConsumedMCPOAuthAttempt{}, ErrMCPOAuthIssuerMismatch
	}
	plaintext, err := s.mcpOAuthCipher.Decrypt(attemptID, ciphertext)
	if err != nil {
		return ConsumedMCPOAuthAttempt{}, err
	}
	var clientState mcpOAuthClientState
	if err := json.Unmarshal(plaintext, &clientState); err != nil {
		return ConsumedMCPOAuthAttempt{}, fmt.Errorf("decode MCP authorization client state: %w", err)
	}
	item.ClientID, item.ClientSecret, item.CodeVerifier = clientState.ClientID, clientState.ClientSecret, clientState.Verifier
	return item, nil
}

func validMCPOAuthIssuer(expected, actual string, required bool) bool {
	if actual == "" {
		return !required
	}
	return actual == expected
}
