CREATE TABLE mission_schedules (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mission_name TEXT NOT NULL,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    run_as_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    run_as_service_principal_id UUID REFERENCES service_principals(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT CHECK (last_run_status IS NULL OR last_run_status IN ('started', 'failed', 'skipped')),
    last_error TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, name),
    CHECK ((run_as_user_id IS NOT NULL)::INTEGER + (run_as_service_principal_id IS NOT NULL)::INTEGER = 1)
);

CREATE INDEX mission_schedules_due_idx
    ON mission_schedules (next_run_at)
    WHERE status = 'active';

CREATE INDEX mission_schedules_mission_idx
    ON mission_schedules (workspace_id, mission_name);
