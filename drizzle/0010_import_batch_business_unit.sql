ALTER TABLE "import_batches" ADD COLUMN "business_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "import_batches" ib
SET "business_unit_id" = bu."id"
FROM "business_units" bu
WHERE ib."organization_id" = bu."organization_id"
  AND bu."name" = 'AIT Signs'
  AND ib."business_unit_id" IS NULL
  AND ib."source_type" = 'xlsx'
  AND (
    ib."source_name" ILIKE '%sign%'
    OR ib."file_name" ILIKE '%sign%'
    OR ib."file_name" ILIKE '%work-estimates%'
  );--> statement-breakpoint
CREATE INDEX "import_batches_business_unit_idx" ON "import_batches" USING btree ("business_unit_id");--> statement-breakpoint
