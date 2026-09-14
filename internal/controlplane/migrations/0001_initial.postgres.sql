CREATE TABLE control_plane (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    claimed_at TIMESTAMPTZ NOT NULL,
    claimed_by UUID NOT NULL
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    password_hash BYTEA,
    auth_subject TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));

CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    repository_url TEXT,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
