-- MIS-431: immutable section snapshots. Apply before deploying readers/writers.
-- The rollout baseline records only the section state at migration time; it does not
-- assert any teacher, location, or schedule for meetings before this date.
CREATE TABLE "class_section_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "class_section_id" uuid NOT NULL,
  "effective_date" date NOT NULL,
  "revision" integer NOT NULL,
  "is_baseline" boolean DEFAULT false NOT NULL,
  "course_name" text NOT NULL,
  "teacher" text,
  "course_location" text,
  "modality" text NOT NULL,
  "schedule_days_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "start_time" text,
  "end_time" text,
  "scheduled_days_per_week" integer,
  "status" text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "audit_summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "class_section_versions_scope_fk" FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "class_section_versions_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "class_section_versions_status_check" CHECK ("status" IN ('planned', 'active', 'inactive'))
);
CREATE UNIQUE INDEX "class_section_versions_section_date_idx" ON "class_section_versions" ("class_section_id", "effective_date");
CREATE UNIQUE INDEX "class_section_versions_section_revision_idx" ON "class_section_versions" ("class_section_id", "revision");

INSERT INTO "class_section_versions" (
  "organization_id", "business_unit_id", "class_section_id", "effective_date", "revision", "is_baseline",
  "course_name", "teacher", "course_location", "modality", "schedule_days_json", "start_time",
  "end_time", "scheduled_days_per_week", "status", "audit_summary_json"
)
SELECT "organization_id", "business_unit_id", "id", (now() AT TIME ZONE 'America/New_York')::date,
       1, true, "course_name", "teacher", "course_location", "modality", "schedule_days_json",
       "start_time", "end_time", "scheduled_days_per_week", "status",
       jsonb_build_object('kind', 'rollout_baseline', 'historyBeforeRollout', 'not_recorded')
FROM "course_class_sections";

-- All enrollment writers (including approved imports) serialize on the section row.
-- This is a backstop for application checks: no active enrollment may newly span
-- a pending deactivation, and no enrollment is silently canceled or detached.
CREATE FUNCTION "reject_spanning_class_deactivation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pending_date date;
BEGIN
  IF NEW."class_section_id" IS NULL OR NEW."status" <> 'active' THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "course_class_sections" s
   WHERE s."id" = NEW."class_section_id"
     AND s."organization_id" = NEW."organization_id"
     AND s."business_unit_id" = NEW."business_unit_id"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class section is outside this enrollment business unit' USING ERRCODE = '23514';
  END IF;
  SELECT v."effective_date" INTO pending_date
    FROM "class_section_versions" v
   WHERE v."class_section_id" = NEW."class_section_id"
     AND v."effective_date" > (now() AT TIME ZONE 'America/New_York')::date
     AND v."status" = 'inactive'
     AND (NEW."start_date" IS NULL OR NEW."start_date" <= v."effective_date")
     AND (NEW."end_date" IS NULL OR NEW."end_date" >= v."effective_date")
   ORDER BY v."effective_date" LIMIT 1;
  IF pending_date IS NOT NULL THEN
    RAISE EXCEPTION 'Active enrollment spans scheduled class deactivation on %', pending_date
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "contact_course_records_class_deactivation_guard"
  BEFORE INSERT OR UPDATE OF "class_section_id", "status", "start_date", "end_date", "organization_id", "business_unit_id"
  ON "contact_course_records" FOR EACH ROW
  EXECUTE FUNCTION "reject_spanning_class_deactivation"();
