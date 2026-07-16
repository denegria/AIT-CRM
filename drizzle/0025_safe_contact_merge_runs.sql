CREATE TABLE IF NOT EXISTS "contact_merge_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "source_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "target_contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE restrict,
  "idempotency_key" text NOT NULL,
  "approval_reference" text NOT NULL,
  "status" text DEFAULT 'applying' NOT NULL,
  "relationship_inventory_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "contact_merge_runs_org_idempotency_idx"
  ON "contact_merge_runs" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "contact_merge_runs_source_target_idx"
  ON "contact_merge_runs" ("source_contact_id", "target_contact_id");
