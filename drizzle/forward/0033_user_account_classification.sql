-- Persist account purpose separately from role and display name. QA identities
-- retain access and historical ownership but are not eligible for assignment.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "account_type" text NOT NULL DEFAULT 'employee';

ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_account_type_check";

ALTER TABLE "users"
  ADD CONSTRAINT "users_account_type_check"
  CHECK ("account_type" IN ('employee', 'qa'));

CREATE INDEX IF NOT EXISTS "users_org_account_type_idx"
  ON "users" ("organization_id", "account_type", "is_active");
