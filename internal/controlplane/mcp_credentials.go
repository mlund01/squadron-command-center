package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrMCPCredentialNotFound = errors.New("MCP credential not found")
var ErrMCPConnectionChanged = errors.New("MCP connection URL changed; reconnect this identity")
var ErrMCPCredentialNeedsAction = errors.New("MCP credential needs reauthorization")

var mcpConnectionNamePattern = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// MCPIdentity is the one user or service principal that owns a connection
// credential. It is independent of the user who initiated a run-as request.
type MCPIdentity struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func (i MCPIdentity) column() (string, error) {
	if _, err := uuid.Parse(i.ID); err != nil {
		return "", fmt.Errorf("invalid MCP credential identity ID")
	}
	switch i.Kind {
	case "user":
		return "user_id", nil
	case "service_principal":
		return "service_principal_id", nil
	default:
		return "", fmt.Errorf("invalid MCP credential identity kind %q", i.Kind)
	}
}

// MCPSecretMaterial is never serialized into an API response or run record.
// Only the Command Center credential store decrypts it.
type MCPSecretMaterial struct {
	AccessToken       string `json:"-"`
	RefreshToken      string `json:"-"`
	TokenType         string `json:"-"`
	ClientID          string `json:"-"`
	ClientSecret      string `json:"-"`
	StaticHeaderName  string `json:"-"`
	StaticHeaderValue string `json:"-"`
}

func (m MCPSecretMaterial) String() string { return "[redacted MCP credential]" }

type mcpSecretPayload struct {
	AccessToken       string `json:"access_token,omitempty"`
	RefreshToken      string `json:"refresh_token,omitempty"`
	TokenType         string `json:"token_type,omitempty"`
	ClientID          string `json:"client_id,omitempty"`
	ClientSecret      string `json:"client_secret,omitempty"`
	StaticHeaderName  string `json:"static_header_name,omitempty"`
	StaticHeaderValue string `json:"static_header_value,omitempty"`
}

func (m MCPSecretMaterial) encode() ([]byte, error) {
	return json.Marshal(mcpSecretPayload{
		AccessToken: m.AccessToken, RefreshToken: m.RefreshToken, TokenType: m.TokenType,
		ClientID: m.ClientID, ClientSecret: m.ClientSecret,
		StaticHeaderName: m.StaticHeaderName, StaticHeaderValue: m.StaticHeaderValue,
	})
}

func decodeMCPSecretMaterial(data []byte) (MCPSecretMaterial, error) {
	var payload mcpSecretPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return MCPSecretMaterial{}, fmt.Errorf("decode MCP credential: %w", err)
	}
	return MCPSecretMaterial{
		AccessToken: payload.AccessToken, RefreshToken: payload.RefreshToken, TokenType: payload.TokenType,
		ClientID: payload.ClientID, ClientSecret: payload.ClientSecret,
		StaticHeaderName: payload.StaticHeaderName, StaticHeaderValue: payload.StaticHeaderValue,
	}, nil
}

// MCPConnectionCredential is the safe, non-secret status returned to callers.
type MCPConnectionCredential struct {
	ID                      string      `json:"id"`
	WorkspaceID             string      `json:"workspaceId"`
	ConnectionName          string      `json:"connectionName"`
	Identity                MCPIdentity `json:"identity"`
	Method                  string      `json:"method"`
	ResourceURI             string      `json:"resourceUri"`
	Issuer                  string      `json:"issuer,omitempty"`
	Scopes                  []string    `json:"scopes"`
	AccessExpiresAt         *time.Time  `json:"accessExpiresAt,omitempty"`
	Version                 int         `json:"version"`
	Status                  string      `json:"status"`
	LastSuccessfulRefreshAt *time.Time  `json:"lastSuccessfulRefreshAt,omitempty"`
	LastErrorCode           string      `json:"lastErrorCode,omitempty"`
	LastErrorAt             *time.Time  `json:"lastErrorAt,omitempty"`
	CreatedAt               time.Time   `json:"createdAt"`
	UpdatedAt               time.Time   `json:"updatedAt"`
}

type NewMCPConnectionCredential struct {
	Method          string
	ResourceURI     string
	Issuer          string
	Scopes          []string
	AccessExpiresAt *time.Time
	Material        MCPSecretMaterial
}

func validateNewMCPCredential(connectionName string, value NewMCPConnectionCredential) error {
	if !mcpConnectionNamePattern.MatchString(connectionName) {
		return fmt.Errorf("invalid MCP connection name")
	}
	if value.ResourceURI == "" {
		return fmt.Errorf("MCP resource URI is required")
	}
	switch value.Method {
	case "authorization_code", "client_credentials":
		if value.Material.AccessToken == "" {
			return fmt.Errorf("MCP OAuth access token is required")
		}
	case "static_header":
		if value.Material.StaticHeaderName == "" || value.Material.StaticHeaderValue == "" {
			return fmt.Errorf("MCP static header name and value are required")
		}
	default:
		return fmt.Errorf("invalid MCP credential method %q", value.Method)
	}
	return nil
}

func (s *Store) ReplaceMCPConnectionCredential(ctx context.Context, workspaceID, connectionName string, identity MCPIdentity, createdBy string, value NewMCPConnectionCredential) (MCPConnectionCredential, error) {
	column, err := identity.column()
	if err != nil {
		return MCPConnectionCredential{}, err
	}
	if err := validateNewMCPCredential(connectionName, value); err != nil {
		return MCPConnectionCredential{}, err
	}
	if _, err := uuid.Parse(workspaceID); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("invalid workspace ID")
	}
	var actor any
	if createdBy != "" {
		if _, err := uuid.Parse(createdBy); err != nil {
			return MCPConnectionCredential{}, fmt.Errorf("invalid credential creator ID")
		}
		actor = createdBy
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("begin MCP credential replacement: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serializing on the workspace row makes replacement/version allocation
	// atomic without holding a lock during a remote OAuth exchange.
	var lockedID string
	if err := tx.QueryRow(ctx, `SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, workspaceID).Scan(&lockedID); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("lock workspace for MCP credential replacement: %w", err)
	}
	var version int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(version),0)+1 FROM mcp_connection_credentials WHERE workspace_id=$1 AND connection_name=$2 AND `+column+`=$3`, workspaceID, connectionName, identity.ID).Scan(&version); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("select MCP credential version: %w", err)
	}
	plaintext, err := value.Material.encode()
	if err != nil {
		return MCPConnectionCredential{}, err
	}
	ciphertext, err := s.mcpCipher.Encrypt(workspaceID, connectionName, identity.Kind, identity.ID, value.ResourceURI, version, plaintext)
	if err != nil {
		return MCPConnectionCredential{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE mcp_connection_credentials SET status='revoked',revoked_at=NOW(),credential_ciphertext=NULL,refresh_lease_owner=NULL,refresh_lease_until=NULL,updated_at=NOW() WHERE workspace_id=$1 AND connection_name=$2 AND `+column+`=$3 AND revoked_at IS NULL`, workspaceID, connectionName, identity.ID); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("retire previous MCP credential: %w", err)
	}
	var item MCPConnectionCredential
	item.WorkspaceID, item.ConnectionName, item.Identity = workspaceID, connectionName, identity
	item.Method, item.ResourceURI, item.Issuer = value.Method, value.ResourceURI, value.Issuer
	item.Scopes, item.AccessExpiresAt, item.Version, item.Status = append([]string(nil), value.Scopes...), value.AccessExpiresAt, version, "active"
	if item.Scopes == nil {
		item.Scopes = []string{}
	}
	item.ID = uuid.NewString()
	if err := tx.QueryRow(ctx, `INSERT INTO mcp_connection_credentials(id,workspace_id,connection_name,user_id,service_principal_id,method,resource_uri,issuer,scopes,credential_ciphertext,access_expires_at,version,created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING created_at,updated_at`,
		item.ID, workspaceID, connectionName, mcpUserID(identity), mcpServicePrincipalID(identity), value.Method, value.ResourceURI, value.Issuer, item.Scopes, ciphertext, value.AccessExpiresAt, version, actor,
	).Scan(&item.CreatedAt, &item.UpdatedAt); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("store MCP credential: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return MCPConnectionCredential{}, fmt.Errorf("commit MCP credential replacement: %w", err)
	}
	return item, nil
}

func mcpUserID(identity MCPIdentity) any {
	if identity.Kind == "user" {
		return identity.ID
	}
	return nil
}

func mcpServicePrincipalID(identity MCPIdentity) any {
	if identity.Kind == "service_principal" {
		return identity.ID
	}
	return nil
}

// LoadActiveMCPConnectionCredential rejects a changed server URI before it
// decrypts anything, so a connection edit cannot reuse a token at a new host.
func (s *Store) LoadActiveMCPConnectionCredential(ctx context.Context, workspaceID, connectionName string, identity MCPIdentity, resourceURI string) (MCPConnectionCredential, MCPSecretMaterial, error) {
	column, err := identity.column()
	if err != nil {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, err
	}
	var item MCPConnectionCredential
	var ciphertext []byte
	item.WorkspaceID, item.ConnectionName, item.Identity = workspaceID, connectionName, identity
	err = s.pool.QueryRow(ctx, `SELECT id,method,resource_uri,issuer,scopes,credential_ciphertext,access_expires_at,version,status,last_successful_refresh_at,last_error_code,last_error_at,created_at,updated_at
		FROM mcp_connection_credentials WHERE workspace_id=$1 AND connection_name=$2 AND `+column+`=$3 AND revoked_at IS NULL`, workspaceID, connectionName, identity.ID).
		Scan(&item.ID, &item.Method, &item.ResourceURI, &item.Issuer, &item.Scopes, &ciphertext, &item.AccessExpiresAt, &item.Version, &item.Status, &item.LastSuccessfulRefreshAt, &item.LastErrorCode, &item.LastErrorAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, ErrMCPCredentialNotFound
	}
	if err != nil {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, fmt.Errorf("load MCP credential: %w", err)
	}
	if item.ResourceURI != resourceURI {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, ErrMCPConnectionChanged
	}
	if item.Status == "needs_action" {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, ErrMCPCredentialNeedsAction
	}
	plaintext, err := s.mcpCipher.Decrypt(workspaceID, connectionName, identity.Kind, identity.ID, item.ResourceURI, item.Version, ciphertext)
	if err != nil {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, err
	}
	material, err := decodeMCPSecretMaterial(plaintext)
	if err != nil {
		return MCPConnectionCredential{}, MCPSecretMaterial{}, err
	}
	return item, material, nil
}

// ListMCPConnectionCredentials returns only metadata for an identity's active
// connections. Personal profile and service-principal management use the same
// query, each after their own authorization check.
func (s *Store) ListMCPConnectionCredentials(ctx context.Context, identity MCPIdentity) ([]MCPConnectionCredential, error) {
	column, err := identity.column()
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,connection_name,method,resource_uri,issuer,scopes,access_expires_at,version,status,last_successful_refresh_at,last_error_code,last_error_at,created_at,updated_at
		FROM mcp_connection_credentials WHERE `+column+`=$1 AND revoked_at IS NULL ORDER BY workspace_id,connection_name`, identity.ID)
	if err != nil {
		return nil, fmt.Errorf("list MCP credentials: %w", err)
	}
	defer rows.Close()
	items := make([]MCPConnectionCredential, 0)
	for rows.Next() {
		var item MCPConnectionCredential
		item.Identity = identity
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.ConnectionName, &item.Method, &item.ResourceURI, &item.Issuer, &item.Scopes, &item.AccessExpiresAt, &item.Version, &item.Status, &item.LastSuccessfulRefreshAt, &item.LastErrorCode, &item.LastErrorAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan MCP credential status: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListMCPConnectionCredentialHistory retains non-secret replacement and
// revocation facts without keeping old access or refresh grants.
func (s *Store) ListMCPConnectionCredentialHistory(ctx context.Context, workspaceID, connectionName string, identity MCPIdentity) ([]MCPConnectionCredential, error) {
	column, err := identity.column()
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id,method,resource_uri,issuer,scopes,access_expires_at,version,status,last_successful_refresh_at,last_error_code,last_error_at,created_at,updated_at
		FROM mcp_connection_credentials WHERE workspace_id=$1 AND connection_name=$2 AND `+column+`=$3 ORDER BY version DESC`, workspaceID, connectionName, identity.ID)
	if err != nil {
		return nil, fmt.Errorf("list MCP credential history: %w", err)
	}
	defer rows.Close()
	items := make([]MCPConnectionCredential, 0)
	for rows.Next() {
		var item MCPConnectionCredential
		item.WorkspaceID, item.ConnectionName, item.Identity = workspaceID, connectionName, identity
		if err := rows.Scan(&item.ID, &item.Method, &item.ResourceURI, &item.Issuer, &item.Scopes, &item.AccessExpiresAt, &item.Version, &item.Status, &item.LastSuccessfulRefreshAt, &item.LastErrorCode, &item.LastErrorAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan MCP credential history: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// RevokeMCPConnectionCredential retains non-secret history and destroys the
// encrypted material. A subsequent connection gets a new version.
func (s *Store) RevokeMCPConnectionCredential(ctx context.Context, workspaceID, connectionName string, identity MCPIdentity) error {
	column, err := identity.column()
	if err != nil {
		return err
	}
	command, err := s.pool.Exec(ctx, `UPDATE mcp_connection_credentials SET status='revoked',revoked_at=NOW(),credential_ciphertext=NULL,refresh_lease_owner=NULL,refresh_lease_until=NULL,updated_at=NOW() WHERE workspace_id=$1 AND connection_name=$2 AND `+column+`=$3 AND revoked_at IS NULL`, workspaceID, connectionName, identity.ID)
	if err != nil {
		return fmt.Errorf("revoke MCP credential: %w", err)
	}
	if command.RowsAffected() == 0 {
		return ErrMCPCredentialNotFound
	}
	return nil
}
