-- Persist account purpose separately from role and display name. QA identities
-- retain access and historical ownership but are not eligible for assignment.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "account_type" text NOT NULL DEFAULT 'employee';
