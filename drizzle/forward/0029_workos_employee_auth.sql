ALTER TABLE "users" ADD COLUMN "workos_user_id" text;
ALTER TABLE "users" ADD COLUMN "auth_migrated_at" timestamp with time zone;

CREATE UNIQUE INDEX "users_workos_user_id_idx"
  ON "users" ("workos_user_id")
  WHERE "workos_user_id" IS NOT NULL;

CREATE TABLE "employee_auth_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "intended_email" text NOT NULL,
  "intended_name" text NOT NULL,
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE restrict,
  "provider_invitation_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_sent_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "accepted_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "replaced_by_invitation_id" uuid,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employee_auth_invitations_replacement_fk"
    FOREIGN KEY ("replaced_by_invitation_id") REFERENCES "employee_auth_invitations"("id") ON DELETE set null,
  CONSTRAINT "employee_auth_invitations_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'revoked', 'expired', 'failed')),
  CONSTRAINT "employee_auth_invitations_email_check"
    CHECK ("intended_email" = lower(btrim("intended_email")) AND length("intended_email") > 3),
  CONSTRAINT "employee_auth_invitations_name_check"
    CHECK (length(btrim("intended_name")) > 0)
);

CREATE UNIQUE INDEX "employee_auth_invitations_provider_idx"
  ON "employee_auth_invitations" ("provider_invitation_id")
  WHERE "provider_invitation_id" IS NOT NULL;

CREATE UNIQUE INDEX "employee_auth_invitations_pending_email_idx"
  ON "employee_auth_invitations" ("organization_id", "intended_email")
  WHERE "status" = 'pending';

CREATE INDEX "employee_auth_invitations_org_status_idx"
  ON "employee_auth_invitations" ("organization_id", "status", "created_at");

CREATE TABLE "employee_auth_invitation_business_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invitation_id" uuid NOT NULL REFERENCES "employee_auth_invitations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE restrict,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "employee_auth_invitation_business_units_unique_idx"
  ON "employee_auth_invitation_business_units" ("invitation_id", "business_unit_id");

CREATE TABLE "employee_auth_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "outcome" text DEFAULT 'succeeded' NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "subject_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "invitation_id" uuid REFERENCES "employee_auth_invitations"("id") ON DELETE set null,
  "provider_reference" text,
  "failure_code" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employee_auth_events_outcome_check"
    CHECK ("outcome" IN ('succeeded', 'denied', 'failed'))
);

CREATE INDEX "employee_auth_events_org_occurred_idx"
  ON "employee_auth_events" ("organization_id", "occurred_at");
CREATE INDEX "employee_auth_events_subject_occurred_idx"
  ON "employee_auth_events" ("subject_user_id", "occurred_at");
