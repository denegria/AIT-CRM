CREATE TABLE IF NOT EXISTS "course_class_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "section_key" text NOT NULL,
  "course_name" text NOT NULL,
  "teacher" text,
  "course_location" text,
  "modality" text DEFAULT 'in_person' NOT NULL,
  "schedule_days_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "start_time" text,
  "end_time" text,
  "scheduled_days_per_week" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "source_type" text,
  "source_reference" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "course_class_sections_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "course_class_sections_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "course_class_sections_business_unit_section_idx"
  ON "course_class_sections" USING btree ("organization_id", "business_unit_id", "section_key");
CREATE INDEX IF NOT EXISTS "course_class_sections_business_unit_status_idx"
  ON "course_class_sections" USING btree ("business_unit_id", "status");
CREATE INDEX IF NOT EXISTS "course_class_sections_org_course_idx"
  ON "course_class_sections" USING btree ("organization_id", "course_name");

ALTER TABLE "contact_course_records" ADD COLUMN IF NOT EXISTS "class_section_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_course_records_class_section_id_course_class_sections_id_fk'
  ) THEN
    ALTER TABLE "contact_course_records"
      ADD CONSTRAINT "contact_course_records_class_section_id_course_class_sections_id_fk"
      FOREIGN KEY ("class_section_id") REFERENCES "public"."course_class_sections"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contact_course_records_class_section_idx"
  ON "contact_course_records" USING btree ("class_section_id");
CREATE UNIQUE INDEX IF NOT EXISTS "contact_course_records_active_section_enrollment_idx"
  ON "contact_course_records" USING btree ("organization_id", "contact_id", "class_section_id")
  WHERE "status" = 'active' AND "class_section_id" IS NOT NULL;
