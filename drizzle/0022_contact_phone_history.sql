CREATE TABLE IF NOT EXISTS "contact_phone_numbers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "contact_id" uuid NOT NULL,
  "phone" text NOT NULL,
  "normalized_phone" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "is_do_not_call" boolean DEFAULT false NOT NULL,
  "is_wrong_number" boolean DEFAULT false NOT NULL,
  "channel_consent_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_type" text,
  "source_reference" text,
  "observed_at" timestamp with time zone,
  "effective_at" timestamp with time zone,
  "retired_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_phone_numbers_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_phone_numbers_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "contact_phone_numbers_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "contact_phone_numbers_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_phone_numbers_contact_phone_idx"
  ON "contact_phone_numbers" USING btree ("organization_id", "contact_id", "normalized_phone");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_phone_numbers_contact_primary_idx"
  ON "contact_phone_numbers" USING btree ("organization_id", "contact_id")
  WHERE "is_primary" = true;
CREATE INDEX IF NOT EXISTS "contact_phone_numbers_org_phone_idx"
  ON "contact_phone_numbers" USING btree ("organization_id", "normalized_phone");
CREATE INDEX IF NOT EXISTS "contact_phone_numbers_business_unit_idx"
  ON "contact_phone_numbers" USING btree ("business_unit_id");
