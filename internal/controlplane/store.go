// Package controlplane persists Command Center's server-owned state.
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
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrAlreadyClaimed = errors.New("command center is already claimed")

var ErrUserNotFound = errors.New("user not found")

var ErrWorkspaceNotFound = errors.New("workspace not found")

var ErrWorkerAlreadyProvisioned = errors.New("workspace worker is already provisioned")

var ErrWorkerNotFound = errors.New("workspace worker not found")

var ErrInvalidWorkerCredential = errors.New("invalid worker credential")

var ErrWorkerCredentialUnavailable = errors.New("worker credential is unavailable")

const (
	RoleAdmin  = "admin"
	RoleMember = "member"
)

type User struct {
	ID           string
	Email        string
	Name         string
	PasswordHash []byte
	Role         string
}

// Workspace is a server-owned project that Squadron workers can later attach
// to. It intentionally does not contain worker-specific connection details.
type Workspace struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	RepositoryURL string           `json:"repositoryUrl,omitempty"`
	DefaultBranch string           `json:"defaultBranch"`
	CreatedBy     string           `json:"createdBy"`
	CreatedAt     time.Time        `json:"createdAt"`
	Worker        *WorkspaceWorker `json:"worker,omitempty"`
}

// WorkspaceWorker is the one Squadron worker assigned to a workspace.
// The credential's encrypted form remains in persistence so an administrator
// can retrieve it; callers never receive it through workspace list responses.
type WorkspaceWorker struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspaceId"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	EnrolledAt  *time.Time `json:"enrolledAt,omitempty"`
	LastSeenAt  *time.Time `json:"lastSeenAt,omitempty"`
}

type Store struct {
	pool             *pgxpool.Pool
	credentialCipher *credentialCipher
	variableCipher   *variableCipher
	modelCipher      *modelConnectionCipher
}

func Open(ctx context.Context, databaseURL string, masterKey []byte) (*Store, error) {
	credentialCipher, err := newCredentialCipher(masterKey)
	if err != nil {
		return nil, err
	}
	variableCipher, err := newVariableCipher(masterKey)
	if err != nil {
		return nil, err
	}
	modelCipher, err := newModelConnectionCipher(masterKey)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}
	s := &Store{pool: pool, credentialCipher: credentialCipher, variableCipher: variableCipher, modelCipher: modelCipher}
	if err := s.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if err := s.Migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if err := s.MigrateLegacyModelVariables(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	if err := s.ResetWorkspaceWorkerPresence(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}
func (s *Store) Ping(ctx context.Context) error {
	if err := s.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}
	return nil
}

// ResetWorkspaceWorkerPresence clears state that cannot survive a Command
// Center restart. Workers that are still running will reconnect and
// authenticate themselves again.
func (s *Store) ResetWorkspaceWorkerPresence(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
UPDATE workspace_workers
SET status = 'disconnected'
WHERE status = 'connected'
`)
	if err != nil {
		return fmt.Errorf("reset workspace worker presence: %w", err)
	}
	return nil
}

func (s *Store) IsClaimed(ctx context.Context) (bool, error) {
	var claimed bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM control_plane WHERE singleton = TRUE)`).Scan(&claimed)
	return claimed, err
}

// ClaimInitialAdmin atomically creates the first user and seals setup.
func (s *Store) ClaimInitialAdmin(ctx context.Context, email, name string, passwordHash []byte) (auth.LocalUser, error) {
	return s.claim(ctx, email, name, "", passwordHash)
}

func (s *Store) ClaimInitialOIDCAdmin(ctx context.Context, email, name, subject string) (auth.LocalUser, error) {
	return s.claim(ctx, email, name, subject, nil)
}

// ResolveOIDCUser binds an invited user by verified email on first login, then
// resolves future logins exclusively by the provider's issuer and subject.
func (s *Store) ResolveOIDCUser(ctx context.Context, issuer, subject, email, name string) (auth.LocalUser, error) {
	issuer, subject, email = strings.TrimSpace(issuer), strings.TrimSpace(subject), strings.ToLower(strings.TrimSpace(email))
	var user auth.LocalUser
	err := s.pool.QueryRow(ctx, `
SELECT u.id, u.email, u.name, u.password_hash, u.role
FROM user_identities i JOIN users u ON u.id=i.user_id
WHERE i.provider='oidc' AND i.issuer=$1 AND i.subject=$2 AND u.status='active'`, issuer, subject).
		Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	if err == nil {
		_, _ = s.pool.Exec(ctx, `UPDATE user_identities SET last_login_at=NOW() WHERE provider='oidc' AND issuer=$1 AND subject=$2`, issuer, subject)
		return user, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return auth.LocalUser{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return auth.LocalUser{}, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT id,email,name,password_hash,role FROM users WHERE LOWER(email)=LOWER($1) AND status IN ('invited','active') FOR UPDATE`, email).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.LocalUser{}, ErrUserNotFound
	}
	if err != nil {
		return auth.LocalUser{}, err
	}
	if user.Name == "" {
		user.Name = strings.TrimSpace(name)
	}
	_, err = tx.Exec(ctx, `INSERT INTO user_identities (id,user_id,provider,issuer,subject,last_login_at) VALUES ($1,$2,'oidc',$3,$4,NOW())`, uuid.NewString(), user.ID, issuer, subject)
	if err != nil {
		return auth.LocalUser{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE users SET name=$2,status='active',auth_subject=$3,updated_at=NOW() WHERE id=$1`, user.ID, user.Name, subject)
	if err != nil {
		return auth.LocalUser{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return auth.LocalUser{}, err
	}
	return user, nil
}

func (s *Store) claim(ctx context.Context, email, name, subject string, passwordHash []byte) (auth.LocalUser, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return auth.LocalUser{}, fmt.Errorf("email is required")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return auth.LocalUser{}, err
	}
	defer tx.Rollback(ctx)

	u := auth.LocalUser{
		ID:           uuid.NewString(),
		Email:        email,
		Name:         strings.TrimSpace(name),
		PasswordHash: passwordHash,
		Role:         RoleAdmin,
	}
	tag, err := tx.Exec(ctx, `INSERT INTO control_plane (singleton, claimed_at, claimed_by) VALUES (TRUE, NOW(), $1) ON CONFLICT (singleton) DO NOTHING`, u.ID)
	if err != nil {
		return auth.LocalUser{}, err
	}
	if tag.RowsAffected() == 0 {
		return auth.LocalUser{}, ErrAlreadyClaimed
	}
	_, err = tx.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, auth_subject, role) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)`, u.ID, u.Email, u.Name, u.PasswordHash, subject, u.Role)
	if err != nil {
		return auth.LocalUser{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_events (id, actor_id, event_type) VALUES ($1, $2, 'instance.claimed')`, uuid.NewString(), u.ID)
	if err != nil {
		return auth.LocalUser{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.LocalUser{}, err
	}
	return u, nil
}

func (s *Store) AuthenticateLocal(ctx context.Context, email string) (auth.LocalUser, error) {
	var u auth.LocalUser
	err := s.pool.QueryRow(ctx, `SELECT id, email, name, password_hash, role FROM users WHERE LOWER(email) = LOWER($1) AND status = 'active'`, strings.TrimSpace(email)).Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.LocalUser{}, nil
	}
	return u, err
}

// UserForSubject resolves the signed-in Command Center user. Local sessions
// use the database user ID, while OIDC sessions use the provider subject.
func (s *Store) UserForSubject(ctx context.Context, subject string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
SELECT id, email, name, password_hash, role
FROM users
WHERE (id::text = $1 OR auth_subject = $1) AND status = 'active'
`, subject).Scan(&user.ID, &user.Email, &user.Name, &user.PasswordHash, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	return user, err
}

func (s *Store) ListWorkspaces(ctx context.Context) ([]Workspace, error) {
	rows, err := s.pool.Query(ctx, `
SELECT w.id, w.name, COALESCE(w.repository_url, ''), w.default_branch, w.created_by, w.created_at,
       ww.id, ww.status, ww.created_at, ww.enrolled_at, ww.last_seen_at
FROM workspaces w
LEFT JOIN workspace_workers ww ON ww.workspace_id = w.id
ORDER BY w.created_at ASC, w.name ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	workspaces := make([]Workspace, 0)
	for rows.Next() {
		var workspace Workspace
		var workerID, workerStatus *string
		var workerCreatedAt, workerEnrolledAt, workerLastSeenAt *time.Time
		if err := rows.Scan(
			&workspace.ID,
			&workspace.Name,
			&workspace.RepositoryURL,
			&workspace.DefaultBranch,
			&workspace.CreatedBy,
			&workspace.CreatedAt,
			&workerID,
			&workerStatus,
			&workerCreatedAt,
			&workerEnrolledAt,
			&workerLastSeenAt,
		); err != nil {
			return nil, err
		}
		if workerID != nil {
			workspace.Worker = &WorkspaceWorker{
				ID:          *workerID,
				WorkspaceID: workspace.ID,
				Status:      *workerStatus,
				CreatedAt:   *workerCreatedAt,
				EnrolledAt:  workerEnrolledAt,
				LastSeenAt:  workerLastSeenAt,
			}
		}
		workspaces = append(workspaces, workspace)
	}
	return workspaces, rows.Err()
}

func (s *Store) CreateWorkspace(ctx context.Context, owner User, name, repositoryURL string) (Workspace, error) {
	workspace := Workspace{
		ID:            uuid.NewString(),
		Name:          strings.TrimSpace(name),
		RepositoryURL: strings.TrimSpace(repositoryURL),
		DefaultBranch: "main",
		CreatedBy:     owner.ID,
	}
	err := s.pool.QueryRow(ctx, `
INSERT INTO workspaces (id, name, repository_url, default_branch, created_by)
VALUES ($1, $2, NULLIF($3, ''), $4, $5)
RETURNING created_at
`, workspace.ID, workspace.Name, workspace.RepositoryURL, workspace.DefaultBranch, workspace.CreatedBy).Scan(&workspace.CreatedAt)
	if err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

// NewWorkerCredential creates an opaque credential suitable for a single
// worker enrollment. Its digest authenticates the worker and its encrypted
// value lets an administrator retrieve it later.
func NewWorkerCredential() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate worker credential: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(secret), nil
}

func (s *Store) ProvisionWorkspaceWorker(ctx context.Context, workspaceID, credential string) (WorkspaceWorker, error) {
	workspaceID = strings.TrimSpace(workspaceID)

	credentialHash := sha256.Sum256([]byte(credential))
	credentialCiphertext, err := s.credentialCipher.Encrypt(credential)
	if err != nil {
		return WorkspaceWorker{}, err
	}
	worker := WorkspaceWorker{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Status:      "pending",
	}
	err = s.pool.QueryRow(ctx, `
INSERT INTO workspace_workers (id, workspace_id, credential_hash, credential_ciphertext)
SELECT $1, id, $2, $3
FROM workspaces
WHERE id = $4
ON CONFLICT (workspace_id) DO NOTHING
RETURNING created_at
`, worker.ID, credentialHash[:], credentialCiphertext, workspaceID).Scan(&worker.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1)`, workspaceID).Scan(&exists); err != nil {
			return WorkspaceWorker{}, err
		}
		if !exists {
			return WorkspaceWorker{}, ErrWorkspaceNotFound
		}
		return WorkspaceWorker{}, ErrWorkerAlreadyProvisioned
	}
	if err != nil {
		return WorkspaceWorker{}, err
	}
	return worker, nil
}

// RevealWorkspaceWorkerCredential decrypts the current worker credential for
// an authorized administrator.
func (s *Store) RevealWorkspaceWorkerCredential(ctx context.Context, workspaceID string) (string, error) {
	var ciphertext []byte
	err := s.pool.QueryRow(ctx, `SELECT credential_ciphertext FROM workspace_workers WHERE workspace_id = $1`, strings.TrimSpace(workspaceID)).Scan(&ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrWorkerNotFound
	}
	if err != nil {
		return "", err
	}
	if len(ciphertext) == 0 {
		return "", ErrWorkerCredentialUnavailable
	}
	return s.credentialCipher.Decrypt(ciphertext)
}

// AuthenticateWorker verifies a credential presented by a Squadron worker and
// records that its sole workspace worker is connected.
func (s *Store) AuthenticateWorker(ctx context.Context, credential string) (string, error) {
	credentialHash := sha256.Sum256([]byte(credential))
	var workspaceID string
	err := s.pool.QueryRow(ctx, `
UPDATE workspace_workers
SET status = 'connected', enrolled_at = COALESCE(enrolled_at, NOW()), last_seen_at = NOW()
WHERE credential_hash = $1
RETURNING workspace_id
`, credentialHash[:]).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidWorkerCredential
	}
	if err != nil {
		return "", err
	}
	return workspaceID, nil
}

// TouchWorkspaceWorker records liveness from an authenticated worker heartbeat.
func (s *Store) TouchWorkspaceWorker(ctx context.Context, workspaceID string) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE workspace_workers
SET status = 'connected', last_seen_at = NOW()
WHERE workspace_id = $1
`, strings.TrimSpace(workspaceID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrWorkerNotFound
	}
	return nil
}

// MarkWorkspaceWorkerDisconnected persists the state observed when its
// Command Center WebSocket closes.
func (s *Store) MarkWorkspaceWorkerDisconnected(ctx context.Context, workspaceID string) error {
	tag, err := s.pool.Exec(ctx, `
UPDATE workspace_workers
SET status = 'disconnected', last_seen_at = NOW()
WHERE workspace_id = $1
`, strings.TrimSpace(workspaceID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrWorkerNotFound
	}
	return nil
}
