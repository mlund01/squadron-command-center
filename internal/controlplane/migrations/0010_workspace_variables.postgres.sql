CREATE TABLE workspace_variables (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value_ciphertext BYTEA NOT NULL,
    secret BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, name),
    CHECK (name ~ '^[a-z_][a-z0-9_]*$')
);

CREATE INDEX workspace_variables_workspace_idx
    ON workspace_variables (workspace_id);
