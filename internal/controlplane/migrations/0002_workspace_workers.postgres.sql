CREATE TABLE workspace_workers (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id),
    credential_hash BYTEA NOT NULL,
    credential_ciphertext BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'disconnected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enrolled_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX workspace_workers_credential_hash_idx ON workspace_workers (credential_hash);
