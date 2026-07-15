-- MIS-302: rename the regular coordinator role key from account_manager to account_coordinator.
-- This is intentionally idempotent and preserves the existing role permissions.

WITH role_pairs AS (
  SELECT
    legacy.id AS legacy_role_id,
    canonical.id AS canonical_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
INSERT INTO user_roles (user_id, role_id)
SELECT ur.user_id, role_pairs.canonical_role_id
FROM user_roles ur
JOIN role_pairs ON role_pairs.legacy_role_id = ur.role_id
ON CONFLICT (user_id, role_id) DO NOTHING;

WITH role_pairs AS (
  SELECT
    legacy.id AS legacy_role_id,
    canonical.id AS canonical_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
DELETE FROM user_roles ur
USING role_pairs
WHERE ur.role_id = role_pairs.legacy_role_id;

WITH role_pairs AS (
  SELECT
    legacy.id AS legacy_role_id,
    canonical.id AS canonical_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT role_pairs.canonical_role_id, rp.permission_id
FROM role_permissions rp
JOIN role_pairs ON role_pairs.legacy_role_id = rp.role_id
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH role_pairs AS (
  SELECT
    legacy.id AS legacy_role_id,
    canonical.id AS canonical_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
DELETE FROM role_permissions rp
USING role_pairs
WHERE rp.role_id = role_pairs.legacy_role_id;

WITH role_pairs AS (
  SELECT
    legacy.id AS legacy_role_id,
    canonical.id AS canonical_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
UPDATE business_unit_memberships bum
SET role_id = role_pairs.canonical_role_id,
    updated_at = now()
FROM role_pairs
WHERE bum.role_id = role_pairs.legacy_role_id;

WITH role_pairs AS (
  SELECT legacy.id AS legacy_role_id
  FROM roles legacy
  JOIN roles canonical
    ON canonical.organization_id = legacy.organization_id
   AND canonical.key = 'account_coordinator'
  WHERE legacy.key = 'account_manager'
)
DELETE FROM roles legacy
USING role_pairs
WHERE legacy.id = role_pairs.legacy_role_id;

UPDATE roles legacy
SET key = 'account_coordinator',
    name = 'Account Coordinator',
    updated_at = now()
WHERE legacy.key = 'account_manager'
  AND NOT EXISTS (
    SELECT 1
    FROM roles canonical
    WHERE canonical.organization_id = legacy.organization_id
      AND canonical.key = 'account_coordinator'
  );

UPDATE roles
SET name = 'Account Coordinator',
    updated_at = now()
WHERE key = 'account_coordinator'
  AND name IS DISTINCT FROM 'Account Coordinator';
