package controlplane

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var modelConnectionProviders = map[string]bool{
	"anthropic": true, "openai": true, "gemini": true, "openai_compatible": true,
}

// MigrateLegacyModelVariables moves the three former provider-key variables
// into first-class model connections. It is idempotent and only removes a
// variable after the replacement connection has been written successfully.
func (s *Store) MigrateLegacyModelVariables(ctx context.Context) error {
	for _, legacy := range []struct{ name, provider string }{{"anthropic_api_key", "anthropic"}, {"openai_api_key", "openai"}, {"gemini_api_key", "gemini"}} {
		rows, queryErr := s.pool.Query(ctx, `SELECT workspace_id,value_ciphertext,updated_by FROM workspace_variables WHERE name=$1`, legacy.name)
		if queryErr != nil {
			return fmt.Errorf("find legacy model variables: %w", queryErr)
		}
		type item struct {
			workspaceID string
			ciphertext  []byte
			updatedBy   string
		}
		var items []item
		for rows.Next() {
			var value item
			if scanErr := rows.Scan(&value.workspaceID, &value.ciphertext, &value.updatedBy); scanErr != nil {
				rows.Close()
				return scanErr
			}
			items = append(items, value)
		}
		rows.Close()
		for _, value := range items {
			var exists bool
			if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_model_connections WHERE workspace_id=$1 AND name=$2)`, value.workspaceID, legacy.provider).Scan(&exists); err != nil {
				return err
			}
			if exists {
				if _, err := s.pool.Exec(ctx, `DELETE FROM workspace_variables WHERE workspace_id=$1 AND name=$2`, value.workspaceID, legacy.name); err != nil {
					return err
				}
				continue
			}
			plaintext, err := s.variableCipher.Decrypt(value.workspaceID, legacy.name, value.ciphertext)
			if err != nil {
				return err
			}
			encrypted, err := s.modelCipher.Encrypt(value.workspaceID, legacy.provider, plaintext)
			if err != nil {
				return err
			}
			tx, err := s.pool.Begin(ctx)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO workspace_model_connections(workspace_id,name,provider,api_key_ciphertext,updated_by) VALUES($1,$2,$2,$3,$4)`, value.workspaceID, legacy.provider, encrypted, value.updatedBy); err == nil {
				_, err = tx.Exec(ctx, `DELETE FROM workspace_variables WHERE workspace_id=$1 AND name=$2`, value.workspaceID, legacy.name)
			}
			if err != nil {
				tx.Rollback(ctx)
				return fmt.Errorf("migrate legacy model variable %s: %w", legacy.name, err)
			}
			if err = tx.Commit(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

type WorkspaceModelConnection struct {
	Name          string    `json:"name"`
	Provider      string    `json:"provider"`
	BaseURL       string    `json:"baseUrl,omitempty"`
	HasAPIKey     bool      `json:"hasApiKey"`
	PromptCaching bool      `json:"promptCaching"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type RunnerModelConnection struct {
	Provider      string `json:"provider"`
	BaseURL       string `json:"baseUrl,omitempty"`
	APIKey        string `json:"apiKey,omitempty"`
	PromptCaching bool   `json:"promptCaching"`
}

func (s *Store) ListWorkspaceModelConnections(ctx context.Context, workspaceID string) ([]WorkspaceModelConnection, error) {
	rows, err := s.pool.Query(ctx, `SELECT name,provider,base_url,api_key_ciphertext IS NOT NULL,prompt_caching,updated_at FROM workspace_model_connections WHERE workspace_id=$1 ORDER BY name`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace model connections: %w", err)
	}
	defer rows.Close()
	var result []WorkspaceModelConnection
	for rows.Next() {
		var item WorkspaceModelConnection
		if err := rows.Scan(&item.Name, &item.Provider, &item.BaseURL, &item.HasAPIKey, &item.PromptCaching, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace model connection: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) WorkspaceModelConnectionsForRunner(ctx context.Context, workspaceID string) (map[string]RunnerModelConnection, error) {
	rows, err := s.pool.Query(ctx, `SELECT name,provider,base_url,api_key_ciphertext,prompt_caching FROM workspace_model_connections WHERE workspace_id=$1`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load workspace model connections: %w", err)
	}
	defer rows.Close()
	result := make(map[string]RunnerModelConnection)
	for rows.Next() {
		var name string
		var item RunnerModelConnection
		var ciphertext []byte
		if err := rows.Scan(&name, &item.Provider, &item.BaseURL, &ciphertext, &item.PromptCaching); err != nil {
			return nil, fmt.Errorf("scan workspace model connection: %w", err)
		}
		if len(ciphertext) > 0 {
			item.APIKey, err = s.modelCipher.Decrypt(workspaceID, name, ciphertext)
			if err != nil {
				return nil, err
			}
		}
		result[name] = item
	}
	return result, rows.Err()
}

func (s *Store) SetWorkspaceModelConnection(ctx context.Context, actor User, workspaceID, name, provider, baseURL string, apiKey *string, promptCaching bool) error {
	name, provider, baseURL = strings.TrimSpace(name), strings.TrimSpace(provider), strings.TrimSpace(baseURL)
	if !variableNamePattern.MatchString(name) {
		return fmt.Errorf("invalid connection name")
	}
	if !modelConnectionProviders[provider] {
		return fmt.Errorf("unsupported model provider")
	}
	if provider == "openai_compatible" && baseURL == "" {
		return fmt.Errorf("base URL is required for OpenAI-compatible connections")
	}
	if provider != "openai_compatible" && (apiKey == nil || *apiKey == "") {
		var hasAPIKey bool
		if err := s.pool.QueryRow(ctx, `SELECT api_key_ciphertext IS NOT NULL FROM workspace_model_connections WHERE workspace_id=$1 AND name=$2`, workspaceID, name).Scan(&hasAPIKey); err != nil || !hasAPIKey {
			return fmt.Errorf("API key is required for provider %q", provider)
		}
	}
	var ciphertext []byte
	var err error
	if apiKey != nil && *apiKey != "" {
		ciphertext, err = s.modelCipher.Encrypt(workspaceID, name, *apiKey)
		if err != nil {
			return err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin model connection update: %w", err)
	}
	defer tx.Rollback(ctx)
	if apiKey == nil || *apiKey == "" {
		_, err = tx.Exec(ctx, `INSERT INTO workspace_model_connections(workspace_id,name,provider,base_url,prompt_caching,updated_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,name) DO UPDATE SET provider=EXCLUDED.provider,base_url=EXCLUDED.base_url,prompt_caching=EXCLUDED.prompt_caching,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, workspaceID, name, provider, baseURL, promptCaching, actor.ID)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO workspace_model_connections(workspace_id,name,provider,base_url,api_key_ciphertext,prompt_caching,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,name) DO UPDATE SET provider=EXCLUDED.provider,base_url=EXCLUDED.base_url,api_key_ciphertext=EXCLUDED.api_key_ciphertext,prompt_caching=EXCLUDED.prompt_caching,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, workspaceID, name, provider, baseURL, ciphertext, promptCaching, actor.ID)
	}
	if err != nil {
		return fmt.Errorf("set workspace model connection: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,event_type,data) VALUES($1,$2,'workspace.model_connection_set',$3)`, uuid.NewString(), actor.ID, map[string]any{"workspaceId": workspaceID, "name": name, "provider": provider}); err != nil {
		return fmt.Errorf("audit model connection update: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteWorkspaceModelConnection(ctx context.Context, actor User, workspaceID, name string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM workspace_model_connections WHERE workspace_id=$1 AND name=$2`, workspaceID, name)
	if err != nil {
		return fmt.Errorf("delete workspace model connection: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("model connection not found")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,event_type,data) VALUES($1,$2,'workspace.model_connection_deleted',$3)`, uuid.NewString(), actor.ID, map[string]any{"workspaceId": workspaceID, "name": name}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RevealWorkspaceModelConnectionKey(ctx context.Context, actor User, workspaceID, name string) (string, error) {
	var ciphertext []byte
	if err := s.pool.QueryRow(ctx, `SELECT api_key_ciphertext FROM workspace_model_connections WHERE workspace_id=$1 AND name=$2`, workspaceID, name).Scan(&ciphertext); err != nil || len(ciphertext) == 0 {
		return "", fmt.Errorf("model connection credential not found")
	}
	value, err := s.modelCipher.Decrypt(workspaceID, name, ciphertext)
	if err != nil {
		return "", err
	}
	if err := s.audit(ctx, actor.ID, "workspace.model_connection_revealed", map[string]any{"workspaceId": workspaceID, "name": name}); err != nil {
		return "", err
	}
	return value, nil
}
