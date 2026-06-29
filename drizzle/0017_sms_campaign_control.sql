CREATE TABLE IF NOT EXISTS "sms_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "audience_filter_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "message_body" text NOT NULL,
  "sender_provider" text DEFAULT 'telnyx' NOT NULL,
  "sender_account_id" text,
  "send_window_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "throttle_per_hour" integer DEFAULT 120 NOT NULL,
  "provider_readiness_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "compliance_readiness_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "scheduled_at" timestamp with time zone,
  "launched_at" timestamp with time zone,
  "paused_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_campaigns_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaigns_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaigns_approved_by_user_id_users_id_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "sms_campaigns_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "sms_campaigns_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "sms_campaigns_org_status_idx"
  ON "sms_campaigns" USING btree ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "sms_campaigns_business_unit_status_idx"
  ON "sms_campaigns" USING btree ("business_unit_id", "status");
CREATE INDEX IF NOT EXISTS "sms_campaigns_scheduled_idx"
  ON "sms_campaigns" USING btree ("organization_id", "scheduled_at");

CREATE TABLE IF NOT EXISTS "sms_campaign_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "contact_id" uuid,
  "lead_id" uuid,
  "phone" text NOT NULL,
  "normalized_phone" text NOT NULL,
  "eligibility_status" text NOT NULL,
  "blocked_reasons_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "message_preview" text,
  "delivery_status" text DEFAULT 'not_queued' NOT NULL,
  "provider" text,
  "provider_account_id" text,
  "provider_message_id" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_campaign_recipients_campaign_id_sms_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "public"."sms_campaigns"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaign_recipients_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaign_recipients_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaign_recipients_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "sms_campaign_recipients_lead_id_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_campaign_recipients_campaign_contact_idx"
  ON "sms_campaign_recipients" USING btree ("campaign_id", "contact_id");
CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_campaign_phone_idx"
  ON "sms_campaign_recipients" USING btree ("campaign_id", "normalized_phone");
CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_campaign_status_idx"
  ON "sms_campaign_recipients" USING btree ("campaign_id", "eligibility_status");

CREATE TABLE IF NOT EXISTS "sms_campaign_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "actor_user_id" uuid,
  "message" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_campaign_events_campaign_id_sms_campaigns_id_fk"
    FOREIGN KEY ("campaign_id") REFERENCES "public"."sms_campaigns"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaign_events_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sms_campaign_events_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "sms_campaign_events_campaign_created_idx"
  ON "sms_campaign_events" USING btree ("campaign_id", "created_at");
CREATE INDEX IF NOT EXISTS "sms_campaign_events_org_event_idx"
  ON "sms_campaign_events" USING btree ("organization_id", "event_type");
