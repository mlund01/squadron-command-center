ALTER TABLE workspace_workers
    ADD COLUMN IF NOT EXISTS credential_ciphertext BYTEA;
