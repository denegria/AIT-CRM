ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "archived_by_user_id" uuid;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "archive_reason" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_archived_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "contacts"
      ADD CONSTRAINT "contacts_archived_by_user_id_users_id_fk"
      FOREIGN KEY ("archived_by_user_id")
      REFERENCES "public"."users"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "contacts_org_archived_created_idx"
  ON "contacts" USING btree ("organization_id", "archived_at", "created_at");
