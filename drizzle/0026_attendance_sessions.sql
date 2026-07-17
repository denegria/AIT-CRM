CREATE UNIQUE INDEX IF NOT EXISTS "course_class_sections_attendance_scope_idx"
  ON "course_class_sections" ("id", "organization_id", "business_unit_id");

CREATE UNIQUE INDEX IF NOT EXISTS "contact_course_records_attendance_scope_idx"
  ON "contact_course_records" ("id", "organization_id", "business_unit_id", "class_section_id");

CREATE TABLE "class_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "class_section_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "scheduled_start_time" text,
  "scheduled_end_time" text,
  "status" text DEFAULT 'open' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "session_note" text,
  "submitted_by_user_id" uuid,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "class_sessions_status_check" CHECK ("status" in ('open', 'submitted')),
  CONSTRAINT "class_sessions_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "class_sessions_submission_check" CHECK (
    ("status" = 'open' and "submitted_at" is null and "submitted_by_user_id" is null)
    or ("status" = 'submitted' and "submitted_at" is not null and "submitted_by_user_id" is not null)
  ),
  CONSTRAINT "class_sessions_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "class_sessions_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade,
  CONSTRAINT "class_sessions_submitted_by_user_id_users_id_fk"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "class_sessions_section_scope_fk"
    FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "public"."course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict
);

CREATE UNIQUE INDEX "class_sessions_section_date_idx"
  ON "class_sessions" ("class_section_id", "session_date");
CREATE UNIQUE INDEX "class_sessions_attendance_scope_idx"
  ON "class_sessions" ("id", "organization_id", "business_unit_id", "class_section_id");
CREATE INDEX "class_sessions_business_unit_date_idx"
  ON "class_sessions" ("business_unit_id", "session_date");

CREATE TABLE "attendance_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "class_session_id" uuid NOT NULL,
  "class_section_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "status" text NOT NULL,
  "note" text,
  "marked_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "attendance_records_status_check" CHECK ("status" in ('present', 'absent')),
  CONSTRAINT "attendance_records_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "attendance_records_business_unit_id_business_units_id_fk"
    FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade,
  CONSTRAINT "attendance_records_marked_by_user_id_users_id_fk"
    FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "attendance_records_session_scope_fk"
    FOREIGN KEY ("class_session_id", "organization_id", "business_unit_id", "class_section_id")
    REFERENCES "public"."class_sessions"("id", "organization_id", "business_unit_id", "class_section_id") ON DELETE restrict,
  CONSTRAINT "attendance_records_enrollment_scope_fk"
    FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id", "class_section_id")
    REFERENCES "public"."contact_course_records"("id", "organization_id", "business_unit_id", "class_section_id") ON DELETE restrict
);

CREATE UNIQUE INDEX "attendance_records_session_enrollment_idx"
  ON "attendance_records" ("class_session_id", "enrollment_id");
CREATE INDEX "attendance_records_session_status_idx"
  ON "attendance_records" ("class_session_id", "status");
