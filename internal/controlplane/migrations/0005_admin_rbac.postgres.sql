ALTER TABLE users
    ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE user_identities (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('builtin', 'oidc')),
    issuer TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    UNIQUE (provider, issuer, subject)
);

CREATE TABLE user_invitations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_identities (id, user_id, provider, issuer, subject)
SELECT id, id, 'oidc', '', auth_subject
FROM users
WHERE auth_subject IS NOT NULL;

CREATE TABLE service_principals (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deactivated')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX service_principals_name_lower_idx
    ON service_principals (LOWER(name));

CREATE TABLE service_principal_credentials (
    id UUID PRIMARY KEY,
    service_principal_id UUID NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'default',
    secret_hash BYTEA NOT NULL,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_user_roles (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('reader', 'developer', 'manager', 'admin')),
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO workspace_user_roles (workspace_id, user_id, role, granted_by)
SELECT w.id, u.id, 'admin', u.id
FROM workspaces w
CROSS JOIN users u
WHERE u.role = 'admin'
ON CONFLICT DO NOTHING;

CREATE TABLE workspace_service_principals (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    service_principal_id UUID NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, service_principal_id)
);

CREATE TABLE mission_user_run_grants (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mission_name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, mission_name, user_id)
);

CREATE TABLE mission_service_principal_run_grants (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mission_name TEXT NOT NULL,
    service_principal_id UUID NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, mission_name, service_principal_id)
);

CREATE TABLE mission_run_actors (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mission_id TEXT NOT NULL,
    mission_name TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    service_principal_id UUID REFERENCES service_principals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, mission_id),
    CHECK ((user_id IS NOT NULL)::INTEGER + (service_principal_id IS NOT NULL)::INTEGER = 1)
);

CREATE INDEX workspace_user_roles_user_idx ON workspace_user_roles (user_id);
CREATE INDEX workspace_service_principals_principal_idx ON workspace_service_principals (service_principal_id);
CREATE INDEX mission_user_run_grants_user_idx ON mission_user_run_grants (user_id);
CREATE INDEX mission_service_principal_run_grants_principal_idx ON mission_service_principal_run_grants (service_principal_id);
