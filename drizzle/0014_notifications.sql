CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "user_id" uuid,
  "type" text NOT NULL,
  "source_type" text,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "contact_id" uuid,
  "lead_id" uuid,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "notifications_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "notifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "notifications_org_read_created_idx" ON "notifications" USING btree ("organization_id","read_at","created_at");
CREATE INDEX IF NOT EXISTS "notifications_org_business_unit_created_idx" ON "notifications" USING btree ("organization_id","business_unit_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_org_idempotency_idx" ON "notifications" USING btree ("organization_id","idempotency_key");
