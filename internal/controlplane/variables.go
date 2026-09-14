package controlplane

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
)

var variableNamePattern = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

type WorkspaceVariable struct {
	Name      string    `json:"name"`
	Secret    bool      `json:"secret"`
	HasValue  bool      `json:"hasValue"`
	Value     string    `json:"value,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Store) ListWorkspaceVariables(ctx context.Context, workspaceID string) ([]WorkspaceVariable, error) {
	rows, err := s.pool.Query(ctx, `SELECT name, value_ciphertext, secret, updated_at FROM workspace_variables WHERE workspace_id=$1 ORDER BY name`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace variables: %w", err)
	}
	defer rows.Close()
	var result []WorkspaceVariable
	for rows.Next() {
		var item WorkspaceVariable
		var ciphertext []byte
		if err := rows.Scan(&item.Name, &ciphertext, &item.Secret, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace variable: %w", err)
		}
		item.HasValue = true
		if item.Secret {
			item.Value = "********"
		} else {
			item.Value, err = s.variableCipher.Decrypt(workspaceID, item.Name, ciphertext)
			if err != nil {
				return nil, err
			}
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) WorkspaceVariablesForRunner(ctx context.Context, workspaceID string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT name, value_ciphertext FROM workspace_variables WHERE workspace_id=$1`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load workspace variables: %w", err)
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var name string
		var ciphertext []byte
		if err := rows.Scan(&name, &ciphertext); err != nil {
			return nil, fmt.Errorf("scan workspace variable: %w", err)
		}
		value, err := s.variableCipher.Decrypt(workspaceID, name, ciphertext)
		if err != nil {
			return nil, err
		}
		result[name] = value
	}
	return result, rows.Err()
}

func (s *Store) RevealWorkspaceVariable(ctx context.Context, actor User, workspaceID, name string) (string, error) {
	var ciphertext []byte
	if err := s.pool.QueryRow(ctx, `SELECT value_ciphertext FROM workspace_variables WHERE workspace_id=$1 AND name=$2`, workspaceID, name).Scan(&ciphertext); err != nil {
		return "", fmt.Errorf("variable not found")
	}
	value, err := s.variableCipher.Decrypt(workspaceID, name, ciphertext)
	if err != nil {
		return "", err
	}
	if err := s.audit(ctx, actor.ID, "workspace.variable_revealed", map[string]any{"workspaceId": workspaceID, "name": name}); err != nil {
		return "", fmt.Errorf("audit workspace variable reveal: %w", err)
	}
	return value, nil
}

func (s *Store) SetWorkspaceVariable(ctx context.Context, actor User, workspaceID, name, value string, secret bool) error {
	if !variableNamePattern.MatchString(name) {
		return fmt.Errorf("invalid variable name")
	}
	ciphertext, err := s.variableCipher.Encrypt(workspaceID, name, value)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin workspace variable update: %w", err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO workspace_variables(workspace_id,name,value_ciphertext,secret,updated_by)
		VALUES($1,$2,$3,$4,$5)
		ON CONFLICT(workspace_id,name) DO UPDATE SET value_ciphertext=EXCLUDED.value_ciphertext, secret=EXCLUDED.secret, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, workspaceID, name, ciphertext, secret, actor.ID)
	if err != nil {
		return fmt.Errorf("set workspace variable: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_events (id,actor_id,event_type,data) VALUES($1,$2,'workspace.variable_set',$3)`, uuid.NewString(), actor.ID, map[string]any{"workspaceId": workspaceID, "name": name, "secret": secret}); err != nil {
		return fmt.Errorf("audit workspace variable update: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteWorkspaceVariable(ctx context.Context, actor User, workspaceID, name string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin workspace variable delete: %w", err)
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM workspace_variables WHERE workspace_id=$1 AND name=$2`, workspaceID, name)
	if err != nil {
		return fmt.Errorf("delete workspace variable: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("variable not found")
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_events (id,actor_id,event_type,data) VALUES($1,$2,'workspace.variable_deleted',$3)`, uuid.NewString(), actor.ID, map[string]any{"workspaceId": workspaceID, "name": name}); err != nil {
		return fmt.Errorf("audit workspace variable delete: %w", err)
	}
	return tx.Commit(ctx)
}
