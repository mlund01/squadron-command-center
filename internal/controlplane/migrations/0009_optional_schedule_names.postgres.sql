ALTER TABLE mission_schedules
    DROP CONSTRAINT IF EXISTS mission_schedules_workspace_id_name_key;

CREATE UNIQUE INDEX mission_schedules_named_unique_idx
    ON mission_schedules (workspace_id, mission_name, LOWER(name))
    WHERE name <> '';
