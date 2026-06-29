CREATE TABLE IF NOT EXISTS "contact_channel_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "scope_key" text DEFAULT 'organization' NOT NULL,
  "channel" text NOT NULL,
  "consent_status" text DEFAULT 'unknown' NOT NULL,
  "opt_in_source" text,
  "opt_in_reference" text,
  "opt_in_disclosure_text" text,
  "opt_in_occurred_at" timestamp with time zone,
  "opt_out_source" text,
  "opt_out_reference" text,
  "opt_out_reason" text,
  "opt_out_occurred_at" timestamp with time zone,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_channel_consents_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_channel_consents_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_channel_consents_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_channel_consents_contact_channel_scope_idx"
  ON "contact_channel_consents" USING btree ("organization_id", "contact_id", "channel", "scope_key");
CREATE INDEX IF NOT EXISTS "contact_channel_consents_org_channel_status_idx"
  ON "contact_channel_consents" USING btree ("organization_id", "channel", "consent_status");
CREATE INDEX IF NOT EXISTS "contact_channel_consents_business_unit_idx"
  ON "contact_channel_consents" USING btree ("business_unit_id");

CREATE TABLE IF NOT EXISTS "contact_channel_consent_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "scope_key" text DEFAULT 'organization' NOT NULL,
  "channel" text NOT NULL,
  "event_type" text NOT NULL,
  "consent_status" text DEFAULT 'unknown' NOT NULL,
  "source_type" text,
  "source_reference" text,
  "actor_user_id" uuid,
  "provider" text,
  "provider_event_id" text,
  "idempotency_key" text,
  "disclosure_text" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_channel_consent_events_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_channel_consent_events_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_channel_consent_events_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "contact_channel_consent_events_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_channel_consent_events_org_idempotency_idx"
  ON "contact_channel_consent_events" USING btree ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "contact_channel_consent_events_contact_occurred_idx"
  ON "contact_channel_consent_events" USING btree ("contact_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "contact_channel_consent_events_org_channel_occurred_idx"
  ON "contact_channel_consent_events" USING btree ("organization_id", "channel", "occurred_at");
