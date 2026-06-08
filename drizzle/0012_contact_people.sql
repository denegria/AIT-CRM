CREATE TABLE IF NOT EXISTS "contact_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "contact_id" uuid NOT NULL,
  "name" text NOT NULL,
  "role" text,
  "phone" text,
  "email" text,
  "notes" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source_label" text,
  "source_sheet" text,
  "source_row" integer,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_people_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "contact_people_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "contact_people_contact_idx" ON "contact_people" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "contact_people_org_name_idx" ON "contact_people" USING btree ("organization_id","name");
CREATE INDEX IF NOT EXISTS "contact_people_source_idx" ON "contact_people" USING btree ("source_sheet","source_row");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_people_primary_contact_idx" ON "contact_people" USING btree ("contact_id") WHERE "is_primary" = true;
