CREATE TABLE service_principal_user_grants (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    service_principal_id UUID NOT NULL REFERENCES service_principals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, service_principal_id, user_id),
    FOREIGN KEY (workspace_id, service_principal_id)
        REFERENCES workspace_service_principals(workspace_id, service_principal_id)
        ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspace_user_roles(workspace_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX service_principal_user_grants_user_idx
    ON service_principal_user_grants (workspace_id, user_id);

ALTER TABLE mission_run_actors
    ADD COLUMN initiated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE mission_run_actors
SET initiated_by_user_id = user_id
WHERE user_id IS NOT NULL;
