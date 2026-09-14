ALTER TABLE service_principals
    DROP CONSTRAINT IF EXISTS service_principals_status_check;

ALTER TABLE service_principals
    ADD CONSTRAINT service_principals_status_check
    CHECK (status IN ('active', 'disabled', 'suspended', 'deactivated'));
