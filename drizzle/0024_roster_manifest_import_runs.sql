CREATE TABLE IF NOT EXISTS "roster_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "manifest_id" text NOT NULL,
  "manifest_sha256" text NOT NULL,
  "lane" text NOT NULL,
  "approval_reference" text NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'applying' NOT NULL,
  "expected_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_counts_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "report_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "roster_import_runs_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "roster_import_runs_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "roster_import_runs_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "roster_import_runs_manifest_idx"
  ON "roster_import_runs" USING btree ("organization_id", "manifest_sha256");
CREATE INDEX IF NOT EXISTS "roster_import_runs_business_unit_created_idx"
  ON "roster_import_runs" USING btree ("business_unit_id", "created_at");

CREATE TABLE IF NOT EXISTS "roster_import_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "entity_type" text NOT NULL,
  "operation" text NOT NULL,
  "status" text NOT NULL,
  "target_id" uuid,
  "source_reference" text,
  "before_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "after_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "roster_import_actions_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "roster_import_actions_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "roster_import_actions_run_id_roster_import_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."roster_import_runs"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "roster_import_actions_org_idempotency_idx"
  ON "roster_import_actions" USING btree ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "roster_import_actions_run_status_idx"
  ON "roster_import_actions" USING btree ("run_id", "status");
