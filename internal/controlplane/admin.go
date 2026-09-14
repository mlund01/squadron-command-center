package controlplane

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"commander/internal/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrLastAdministrator = errors.New("cannot remove the last command center administrator")

type AdminUser struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ServicePrincipal struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	CreatedBy   string     `json:"createdBy"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	LastUsedAt  *time.Time `json:"lastUsedAt,omitempty"`
}

type AuditEvent struct {
	ID         string         `json:"id"`
	ActorID    *string        `json:"actorId,omitempty"`
	ActorEmail string         `json:"actorEmail,omitempty"`
	EventType  string         `json:"eventType"`
	Data       map[string]any `json:"data"`
	CreatedAt  time.Time      `json:"createdAt"`
}

type WorkspaceUserGrant struct {
	WorkspaceID string   `json:"workspaceId"`
	UserID      string   `json:"userId"`
	Role        string   `json:"role"`
	Missions    []string `json:"missions"`
}

type WorkspaceServicePrincipalGrant struct {
	WorkspaceID        string   `json:"workspaceId"`
	ServicePrincipalID string   `json:"servicePrincipalId"`
	Missions           []string `json:"missions"`
	UserIDs            []string `json:"userIds"`
}

type MissionRunIdentity struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Store) ListAdminUsers(ctx context.Context) ([]AdminUser, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, email, name, role, status, created_at, updated_at FROM users ORDER BY LOWER(email)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []AdminUser{}
	for rows.Next() {
		var user AdminUser
		if err := rows.Scan(&user.ID, &user.Email, &user.Name, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) CreateAdminUser(ctx context.Context, actor User, email, name, role string) (AdminUser, string, error) {
	email, name, role = strings.ToLower(strings.TrimSpace(email)), strings.TrimSpace(name), strings.TrimSpace(role)
	if role != RoleAdmin {
		role = RoleMember
	}
	user := AdminUser{ID: uuid.NewString(), Email: email, Name: name, Role: role, Status: "invited"}
	secret, err := newInvitationSecret()
	if err != nil {
		return AdminUser{}, "", err
	}
	hash := sha256.Sum256([]byte(secret))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdminUser{}, "", err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `
INSERT INTO users (id, email, name, role, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING created_at, updated_at`, user.ID, user.Email, user.Name, user.Role, user.Status).Scan(&user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return AdminUser{}, "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO user_invitations (id,user_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,NOW()+INTERVAL '7 days',$4)`, uuid.NewString(), user.ID, hash[:], actor.ID)
	if err != nil {
		return AdminUser{}, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminUser{}, "", err
	}
	_ = s.audit(ctx, actor.ID, "user.created", map[string]any{"userId": user.ID, "email": user.Email, "role": user.Role})
	return user, secret, nil
}

func (s *Store) UpdateAdminUser(ctx context.Context, actor User, id, name, role, status string) (AdminUser, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdminUser{}, err
	}
	defer tx.Rollback(ctx)
	var currentRole, currentStatus string
	if err := tx.QueryRow(ctx, `SELECT role,status FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&currentRole, &currentStatus); errors.Is(err, pgx.ErrNoRows) {
		return AdminUser{}, ErrUserNotFound
	} else if err != nil {
		return AdminUser{}, err
	}
	if currentRole == RoleAdmin && currentStatus == "active" && (role != RoleAdmin || status != "active") {
		var count int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'`).Scan(&count); err != nil {
			return AdminUser{}, err
		}
		if count <= 1 {
			return AdminUser{}, ErrLastAdministrator
		}
	}
	var user AdminUser
	err = tx.QueryRow(ctx, `
UPDATE users SET name = $2, role = $3, status = $4, updated_at = NOW()
WHERE id = $1
RETURNING id, email, name, role, status, created_at, updated_at`, id, strings.TrimSpace(name), role, status).
		Scan(&user.ID, &user.Email, &user.Name, &user.Role, &user.Status, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return AdminUser{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminUser{}, err
	}
	_ = s.audit(ctx, actor.ID, "user.updated", map[string]any{"userId": user.ID, "role": user.Role, "status": user.Status})
	return user, nil
}

func (s *Store) ListServicePrincipals(ctx context.Context) ([]ServicePrincipal, error) {
	rows, err := s.pool.Query(ctx, `
SELECT sp.id, sp.name, sp.description, sp.status, sp.created_by, sp.created_at, sp.updated_at, MAX(c.last_used_at)
FROM service_principals sp
LEFT JOIN service_principal_credentials c ON c.service_principal_id = sp.id
GROUP BY sp.id
ORDER BY LOWER(sp.name)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	principals := []ServicePrincipal{}
	for rows.Next() {
		var principal ServicePrincipal
		if err := rows.Scan(&principal.ID, &principal.Name, &principal.Description, &principal.Status, &principal.CreatedBy, &principal.CreatedAt, &principal.UpdatedAt, &principal.LastUsedAt); err != nil {
			return nil, err
		}
		principals = append(principals, principal)
	}
	return principals, rows.Err()
}

func (s *Store) CreateServicePrincipal(ctx context.Context, actor User, name, description string) (ServicePrincipal, string, error) {
	secret, err := newServicePrincipalSecret()
	if err != nil {
		return ServicePrincipal{}, "", err
	}
	hash := sha256.Sum256([]byte(secret))
	principal := ServicePrincipal{ID: uuid.NewString(), Name: strings.TrimSpace(name), Description: strings.TrimSpace(description), Status: "active", CreatedBy: actor.ID}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ServicePrincipal{}, "", err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `INSERT INTO service_principals (id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING created_at, updated_at`, principal.ID, principal.Name, principal.Description, actor.ID).Scan(&principal.CreatedAt, &principal.UpdatedAt)
	if err != nil {
		return ServicePrincipal{}, "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO service_principal_credentials (id, service_principal_id, secret_hash, created_by) VALUES ($1,$2,$3,$4)`, uuid.NewString(), principal.ID, hash[:], actor.ID)
	if err != nil {
		return ServicePrincipal{}, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return ServicePrincipal{}, "", err
	}
	_ = s.audit(ctx, actor.ID, "service_principal.created", map[string]any{"servicePrincipalId": principal.ID})
	return principal, secret, nil
}

func (s *Store) UpdateServicePrincipalStatus(ctx context.Context, actor User, id, status string) (ServicePrincipal, error) {
	var principal ServicePrincipal
	err := s.pool.QueryRow(ctx, `
UPDATE service_principals SET status=$2, updated_at=NOW() WHERE id=$1
RETURNING id,name,description,status,created_by,created_at,updated_at,
  (SELECT MAX(last_used_at) FROM service_principal_credentials WHERE service_principal_id=$1)`, id, status).
		Scan(&principal.ID, &principal.Name, &principal.Description, &principal.Status, &principal.CreatedBy, &principal.CreatedAt, &principal.UpdatedAt, &principal.LastUsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ServicePrincipal{}, ErrUserNotFound
	}
	if err != nil {
		return ServicePrincipal{}, err
	}
	_ = s.audit(ctx, actor.ID, "service_principal.status_updated", map[string]any{"servicePrincipalId": id, "status": status})
	return principal, nil
}

func (s *Store) RotateServicePrincipalCredential(ctx context.Context, actor User, id string) (string, error) {
	secret, err := newServicePrincipalSecret()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(secret))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM service_principals WHERE id=$1)`, id).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", ErrUserNotFound
	}
	if _, err = tx.Exec(ctx, `UPDATE service_principal_credentials SET revoked_at=NOW() WHERE service_principal_id=$1 AND revoked_at IS NULL`, id); err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO service_principal_credentials(id,service_principal_id,secret_hash,created_by) VALUES($1,$2,$3,$4)`, uuid.NewString(), id, hash[:], actor.ID); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	_ = s.audit(ctx, actor.ID, "service_principal.credential_rotated", map[string]any{"servicePrincipalId": id})
	return secret, nil
}

func (s *Store) ListAuditEvents(ctx context.Context, limit int) ([]AuditEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.pool.Query(ctx, `
SELECT a.id,a.actor_id,COALESCE(u.email,''),a.event_type,a.data,a.created_at
FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
ORDER BY a.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []AuditEvent{}
	for rows.Next() {
		var event AuditEvent
		if err := rows.Scan(&event.ID, &event.ActorID, &event.ActorEmail, &event.EventType, &event.Data, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) SetWorkspaceUserGrant(ctx context.Context, actor User, workspaceID, userID, role string, missions []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO workspace_user_roles (workspace_id,user_id,role,granted_by) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role, granted_by=EXCLUDED.granted_by, updated_at=NOW()`, workspaceID, userID, role, actor.ID)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM mission_user_run_grants WHERE workspace_id=$1 AND user_id=$2`, workspaceID, userID); err != nil {
		return err
	}
	for _, mission := range normalizedMissions(missions) {
		if _, err = tx.Exec(ctx, `INSERT INTO mission_user_run_grants (workspace_id,mission_name,user_id,granted_by) VALUES ($1,$2,$3,$4)`, workspaceID, mission, userID, actor.ID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return s.audit(ctx, actor.ID, "workspace.user_access.updated", map[string]any{"workspaceId": workspaceID, "userId": userID, "role": role, "missions": normalizedMissions(missions)})
}

func (s *Store) SetWorkspaceServicePrincipalGrant(ctx context.Context, actor User, workspaceID, principalID string, missions, userIDs []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO workspace_service_principals (workspace_id,service_principal_id,granted_by) VALUES ($1,$2,$3) ON CONFLICT (workspace_id,service_principal_id) DO UPDATE SET granted_by=EXCLUDED.granted_by`, workspaceID, principalID, actor.ID)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM mission_service_principal_run_grants WHERE workspace_id=$1 AND service_principal_id=$2`, workspaceID, principalID); err != nil {
		return err
	}
	for _, mission := range normalizedMissions(missions) {
		if _, err = tx.Exec(ctx, `INSERT INTO mission_service_principal_run_grants (workspace_id,mission_name,service_principal_id,granted_by) VALUES ($1,$2,$3,$4)`, workspaceID, mission, principalID, actor.ID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM service_principal_user_grants WHERE workspace_id=$1 AND service_principal_id=$2`, workspaceID, principalID); err != nil {
		return err
	}
	for _, userID := range normalizedMissions(userIDs) {
		if _, err = tx.Exec(ctx, `INSERT INTO service_principal_user_grants (workspace_id,service_principal_id,user_id,granted_by) VALUES ($1,$2,$3,$4)`, workspaceID, principalID, userID, actor.ID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return s.audit(ctx, actor.ID, "workspace.service_principal_access.updated", map[string]any{"workspaceId": workspaceID, "servicePrincipalId": principalID, "missions": normalizedMissions(missions), "userIds": normalizedMissions(userIDs)})
}

func (s *Store) RemoveWorkspaceUserGrant(ctx context.Context, actor User, workspaceID, userID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM workspace_user_roles WHERE workspace_id=$1 AND user_id=$2`, workspaceID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return s.audit(ctx, actor.ID, "workspace.user_access.removed", map[string]any{"workspaceId": workspaceID, "userId": userID})
	}
	return nil
}
func (s *Store) RemoveWorkspaceServicePrincipalGrant(ctx context.Context, actor User, workspaceID, principalID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM workspace_service_principals WHERE workspace_id=$1 AND service_principal_id=$2`, workspaceID, principalID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return s.audit(ctx, actor.ID, "workspace.service_principal_access.removed", map[string]any{"workspaceId": workspaceID, "servicePrincipalId": principalID})
	}
	return nil
}

func (s *Store) ListWorkspaceUserGrants(ctx context.Context) ([]WorkspaceUserGrant, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.workspace_id, r.user_id, r.role, COALESCE(array_agg(g.mission_name ORDER BY g.mission_name) FILTER (WHERE g.mission_name IS NOT NULL), '{}') FROM workspace_user_roles r LEFT JOIN mission_user_run_grants g ON g.workspace_id=r.workspace_id AND g.user_id=r.user_id GROUP BY r.workspace_id,r.user_id,r.role`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []WorkspaceUserGrant{}
	for rows.Next() {
		var grant WorkspaceUserGrant
		if err := rows.Scan(&grant.WorkspaceID, &grant.UserID, &grant.Role, &grant.Missions); err != nil {
			return nil, err
		}
		result = append(result, grant)
	}
	return result, rows.Err()
}

func (s *Store) ListWorkspaceServicePrincipalGrants(ctx context.Context) ([]WorkspaceServicePrincipalGrant, error) {
	rows, err := s.pool.Query(ctx, `
SELECT r.workspace_id, r.service_principal_id,
       COALESCE((SELECT array_agg(g.mission_name ORDER BY g.mission_name) FROM mission_service_principal_run_grants g WHERE g.workspace_id=r.workspace_id AND g.service_principal_id=r.service_principal_id), '{}'),
       COALESCE((SELECT array_agg(u.user_id::text ORDER BY u.user_id::text) FROM service_principal_user_grants u WHERE u.workspace_id=r.workspace_id AND u.service_principal_id=r.service_principal_id), '{}')
FROM workspace_service_principals r`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []WorkspaceServicePrincipalGrant{}
	for rows.Next() {
		var grant WorkspaceServicePrincipalGrant
		if err := rows.Scan(&grant.WorkspaceID, &grant.ServicePrincipalID, &grant.Missions, &grant.UserIDs); err != nil {
			return nil, err
		}
		result = append(result, grant)
	}
	return result, rows.Err()
}

func (s *Store) audit(ctx context.Context, actorID, eventType string, data map[string]any) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO audit_events (id, actor_id, event_type, data) VALUES ($1,$2,$3,$4)`, uuid.NewString(), actorID, eventType, data)
	return err
}

func normalizedMissions(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func newServicePrincipalSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate service principal credential: %w", err)
	}
	return "sp_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func newInvitationSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate invitation: %w", err)
	}
	return "invite_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Store) InvitationUser(ctx context.Context, token string) (auth.LocalUser, error) {
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	var user auth.LocalUser
	err := s.pool.QueryRow(ctx, `SELECT u.id,u.email,u.name,u.password_hash,u.role FROM user_invitations i JOIN users u ON u.id=i.user_id WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>NOW() AND u.status='invited'`, hash[:]).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.LocalUser{}, ErrUserNotFound
	}
	return user, err
}

func (s *Store) AcceptInvitation(ctx context.Context, token string, passwordHash []byte) (auth.LocalUser, error) {
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.LocalUser{}, err
	}
	defer tx.Rollback(ctx)
	var user auth.LocalUser
	err = tx.QueryRow(ctx, `SELECT u.id,u.email,u.name,u.password_hash,u.role FROM user_invitations i JOIN users u ON u.id=i.user_id WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at>NOW() AND u.status='invited' FOR UPDATE`, hash[:]).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.LocalUser{}, ErrUserNotFound
	}
	if err != nil {
		return auth.LocalUser{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE users SET password_hash=$2,status='active',updated_at=NOW() WHERE id=$1`, user.ID, passwordHash)
	if err != nil {
		return auth.LocalUser{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE user_invitations SET accepted_at=NOW() WHERE token_hash=$1`, hash[:])
	if err != nil {
		return auth.LocalUser{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO user_identities(id,user_id,provider,issuer,subject,last_login_at) VALUES($1,$2,'builtin','',$2::text,NOW()) ON CONFLICT(provider,issuer,subject) DO NOTHING`, uuid.NewString(), user.ID)
	if err != nil {
		return auth.LocalUser{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.LocalUser{}, err
	}
	user.PasswordHash = passwordHash
	return user, nil
}

func (s *Store) ListWorkspacesForUser(ctx context.Context, user User) ([]Workspace, error) {
	if user.Role == RoleAdmin {
		return s.ListWorkspaces(ctx)
	}
	rows, err := s.pool.Query(ctx, `
SELECT w.id,w.name,COALESCE(w.repository_url,''),w.default_branch,w.created_by,w.created_at,
       ww.id,ww.status,ww.created_at,ww.enrolled_at,ww.last_seen_at
FROM workspaces w JOIN workspace_user_roles r ON r.workspace_id=w.id AND r.user_id=$1
LEFT JOIN workspace_workers ww ON ww.workspace_id=w.id
ORDER BY w.created_at,w.name`, user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Workspace{}
	for rows.Next() {
		var workspace Workspace
		var workerID, workerStatus *string
		var workerCreated, workerEnrolled, workerSeen *time.Time
		if err := rows.Scan(&workspace.ID, &workspace.Name, &workspace.RepositoryURL, &workspace.DefaultBranch, &workspace.CreatedBy, &workspace.CreatedAt, &workerID, &workerStatus, &workerCreated, &workerEnrolled, &workerSeen); err != nil {
			return nil, err
		}
		if workerID != nil {
			workspace.Worker = &WorkspaceWorker{ID: *workerID, WorkspaceID: workspace.ID, Status: *workerStatus, CreatedAt: *workerCreated, EnrolledAt: workerEnrolled, LastSeenAt: workerSeen}
		}
		result = append(result, workspace)
	}
	return result, rows.Err()
}

func (s *Store) WorkspaceRoleForUser(ctx context.Context, user User, workspaceID string) (string, error) {
	if user.Role == RoleAdmin {
		return "admin", nil
	}
	var role string
	err := s.pool.QueryRow(ctx, `SELECT role FROM workspace_user_roles WHERE workspace_id=$1 AND user_id=$2`, workspaceID, user.ID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

func (s *Store) CanRunMission(ctx context.Context, user User, workspaceID, missionName string) (bool, error) {
	role, err := s.WorkspaceRoleForUser(ctx, user, workspaceID)
	if err != nil || role == "" {
		return false, err
	}
	if role == "manager" || role == "admin" {
		return true, nil
	}
	var allowed bool
	err = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mission_user_run_grants WHERE workspace_id=$1 AND user_id=$2 AND mission_name=$3)`, workspaceID, user.ID, missionName).Scan(&allowed)
	return allowed, err
}

func (s *Store) ListMissionRunIdentities(ctx context.Context, user User, workspaceID, missionName string) ([]MissionRunIdentity, error) {
	identities := []MissionRunIdentity{}
	allowed, err := s.CanRunMission(ctx, user, workspaceID, missionName)
	if err != nil {
		return nil, err
	}
	if allowed {
		identities = append(identities, MissionRunIdentity{Kind: "user", ID: user.ID, Name: user.Name})
	}
	rows, err := s.pool.Query(ctx, `
SELECT sp.id, sp.name
FROM service_principal_user_grants u
JOIN service_principals sp ON sp.id=u.service_principal_id AND sp.status='active'
JOIN mission_service_principal_run_grants m ON m.workspace_id=u.workspace_id AND m.service_principal_id=u.service_principal_id
WHERE u.workspace_id=$1 AND u.user_id=$2 AND m.mission_name=$3
ORDER BY LOWER(sp.name), sp.id`, workspaceID, user.ID, missionName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var identity MissionRunIdentity
		identity.Kind = "service_principal"
		if err := rows.Scan(&identity.ID, &identity.Name); err != nil {
			return nil, err
		}
		identities = append(identities, identity)
	}
	return identities, rows.Err()
}

func (s *Store) CanUserRunAsServicePrincipal(ctx context.Context, user User, principalID, workspaceID, missionName string) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM service_principal_user_grants u
  JOIN service_principals sp ON sp.id=u.service_principal_id AND sp.status='active'
  JOIN mission_service_principal_run_grants m ON m.workspace_id=u.workspace_id AND m.service_principal_id=u.service_principal_id
  WHERE u.workspace_id=$1 AND u.user_id=$2 AND u.service_principal_id=$3 AND m.mission_name=$4
)`, workspaceID, user.ID, principalID, missionName).Scan(&allowed)
	return allowed, err
}

func (s *Store) RecordMissionRunActor(ctx context.Context, user User, workspaceID, missionID, missionName string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO mission_run_actors(workspace_id,mission_id,mission_name,user_id,initiated_by_user_id) VALUES($1,$2,$3,$4,$4) ON CONFLICT(workspace_id,mission_id) DO NOTHING`, workspaceID, missionID, missionName, user.ID)
	return err
}

func (s *Store) CanControlMissionRun(ctx context.Context, user User, workspaceID, missionID string) (bool, error) {
	role, err := s.WorkspaceRoleForUser(ctx, user, workspaceID)
	if err != nil || role == "" {
		return false, err
	}
	if role == "manager" || role == "admin" {
		return true, nil
	}
	var allowed bool
	err = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mission_run_actors WHERE workspace_id=$1 AND mission_id=$2 AND (user_id=$3 OR initiated_by_user_id=$3))`, workspaceID, missionID, user.ID).Scan(&allowed)
	return allowed, err
}

func (s *Store) AuthenticateServicePrincipal(ctx context.Context, secret string) (auth.ServicePrincipal, error) {
	hash := sha256.Sum256([]byte(strings.TrimSpace(secret)))
	var principal auth.ServicePrincipal
	err := s.pool.QueryRow(ctx, `SELECT sp.id,sp.name FROM service_principal_credentials c JOIN service_principals sp ON sp.id=c.service_principal_id WHERE c.secret_hash=$1 AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>NOW()) AND sp.status='active'`, hash[:]).Scan(&principal.ID, &principal.Name)
	if err != nil {
		return auth.ServicePrincipal{}, err
	}
	_, _ = s.pool.Exec(ctx, `UPDATE service_principal_credentials SET last_used_at=NOW() WHERE secret_hash=$1`, hash[:])
	return principal, nil
}

func (s *Store) CanRunMissionServicePrincipal(ctx context.Context, principalID, workspaceID, missionName string) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_service_principals w JOIN service_principals sp ON sp.id=w.service_principal_id AND sp.status='active' JOIN mission_service_principal_run_grants g ON g.workspace_id=w.workspace_id AND g.service_principal_id=w.service_principal_id WHERE w.workspace_id=$1 AND w.service_principal_id=$2 AND g.mission_name=$3)`, workspaceID, principalID, missionName).Scan(&allowed)
	return allowed, err
}
func (s *Store) RecordMissionRunServicePrincipal(ctx context.Context, principalID, workspaceID, missionID, missionName string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO mission_run_actors(workspace_id,mission_id,mission_name,service_principal_id) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,mission_id) DO NOTHING`, workspaceID, missionID, missionName, principalID)
	return err
}
func (s *Store) RecordMissionRunAsServicePrincipal(ctx context.Context, user User, principalID, workspaceID, missionID, missionName string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO mission_run_actors(workspace_id,mission_id,mission_name,service_principal_id,initiated_by_user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,mission_id) DO NOTHING`, workspaceID, missionID, missionName, principalID, user.ID)
	return err
}
func (s *Store) CanControlMissionRunServicePrincipal(ctx context.Context, principalID, workspaceID, missionID string) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mission_run_actors WHERE workspace_id=$1 AND mission_id=$2 AND service_principal_id=$3)`, workspaceID, missionID, principalID).Scan(&allowed)
	return allowed, err
}
