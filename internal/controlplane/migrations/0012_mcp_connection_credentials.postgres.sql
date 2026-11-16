CREATE TABLE mcp_connection_credentials (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connection_name TEXT NOT NULL,
    user_id UUID,
    service_principal_id UUID,
    method TEXT NOT NULL CHECK (method IN ('authorization_code', 'client_credentials', 'static_header')),
    resource_uri TEXT NOT NULL,
    issuer TEXT NOT NULL DEFAULT '',
    scopes TEXT[] NOT NULL DEFAULT '{}',
    credential_ciphertext BYTEA,
    access_expires_at TIMESTAMPTZ,
    version INTEGER NOT NULL CHECK (version > 0),
    refresh_revision BIGINT NOT NULL DEFAULT 0,
    refresh_lease_owner UUID,
    refresh_lease_until TIMESTAMPTZ,
    last_successful_refresh_at TIMESTAMPTZ,
    last_error_code TEXT NOT NULL DEFAULT '',
    last_error_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_action', 'transient_error', 'revoked')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CHECK (connection_name ~ '^[a-z_][a-z0-9_]*$'),
    CHECK ((user_id IS NOT NULL)::INTEGER + (service_principal_id IS NOT NULL)::INTEGER = 1),
    CHECK ((refresh_lease_owner IS NULL) = (refresh_lease_until IS NULL)),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((revoked_at IS NULL) = (credential_ciphertext IS NOT NULL)),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_user_roles(workspace_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, service_principal_id) REFERENCES workspace_service_principals(workspace_id, service_principal_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX mcp_connection_credentials_user_version_idx
    ON mcp_connection_credentials (workspace_id, connection_name, user_id, version)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX mcp_connection_credentials_principal_version_idx
    ON mcp_connection_credentials (workspace_id, connection_name, service_principal_id, version)
    WHERE service_principal_id IS NOT NULL;

CREATE UNIQUE INDEX mcp_connection_credentials_active_user_idx
    ON mcp_connection_credentials (workspace_id, connection_name, user_id)
    WHERE revoked_at IS NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX mcp_connection_credentials_active_principal_idx
    ON mcp_connection_credentials (workspace_id, connection_name, service_principal_id)
    WHERE revoked_at IS NULL AND service_principal_id IS NOT NULL;

CREATE INDEX mcp_connection_credentials_refresh_idx
    ON mcp_connection_credentials (access_expires_at)
    WHERE revoked_at IS NULL AND method = 'authorization_code';

CREATE TABLE mcp_oauth_attempts (
    id UUID PRIMARY KEY,
    state_hash BYTEA NOT NULL UNIQUE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connection_name TEXT NOT NULL,
    user_id UUID,
    service_principal_id UUID,
    resource_uri TEXT NOT NULL,
    expected_issuer TEXT NOT NULL,
    issuer_parameter_required BOOLEAN NOT NULL DEFAULT FALSE,
    authorization_endpoint TEXT NOT NULL,
    token_endpoint TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    requested_scopes TEXT[] NOT NULL DEFAULT '{}',
    encrypted_client_state BYTEA NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (connection_name ~ '^[a-z_][a-z0-9_]*$'),
    CHECK ((user_id IS NOT NULL)::INTEGER + (service_principal_id IS NOT NULL)::INTEGER = 1),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_user_roles(workspace_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, service_principal_id) REFERENCES workspace_service_principals(workspace_id, service_principal_id) ON DELETE CASCADE
);

CREATE INDEX mcp_oauth_attempts_expiry_idx ON mcp_oauth_attempts (expires_at) WHERE consumed_at IS NULL;
