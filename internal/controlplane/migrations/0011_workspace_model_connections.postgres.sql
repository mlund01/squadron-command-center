CREATE TABLE workspace_model_connections (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key_ciphertext BYTEA,
    prompt_caching BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, name),
    CHECK (name ~ '^[a-z_][a-z0-9_]*$'),
    CHECK (provider IN ('anthropic', 'openai', 'gemini', 'openai_compatible'))
);

CREATE INDEX workspace_model_connections_workspace_idx
    ON workspace_model_connections (workspace_id);
