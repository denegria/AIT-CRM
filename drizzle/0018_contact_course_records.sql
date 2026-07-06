CREATE TABLE IF NOT EXISTS "contact_course_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "lead_id" uuid,
  "course_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "start_date" date,
  "end_date" date,
  "outcome_reason" text,
  "notes" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "contact_course_records" ADD CONSTRAINT "contact_course_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contact_course_records" ADD CONSTRAINT "contact_course_records_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contact_course_records" ADD CONSTRAINT "contact_course_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "contact_course_records" ADD CONSTRAINT "contact_course_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "contact_course_records_contact_idx" ON "contact_course_records" ("organization_id", "contact_id");
CREATE INDEX IF NOT EXISTS "contact_course_records_contact_status_idx" ON "contact_course_records" ("contact_id", "status");
CREATE INDEX IF NOT EXISTS "contact_course_records_business_unit_status_idx" ON "contact_course_records" ("business_unit_id", "status");
CREATE INDEX IF NOT EXISTS "contact_course_records_lead_idx" ON "contact_course_records" ("lead_id");
