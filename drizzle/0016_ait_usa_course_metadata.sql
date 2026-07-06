ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "current_course" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "completed_course" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "ended_course" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "course_outcome" text;
