-- MIS-431 follow-up: additive heterogeneous weekday times.
-- No backfill: empty slots mean the existing days/start/end are the legacy schedule.
-- Apply to staging before deploying code that reads schedule_slots_json.
ALTER TABLE "course_class_sections"
  ADD COLUMN "schedule_slots_json" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "class_section_versions"
  ADD COLUMN "schedule_slots_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
