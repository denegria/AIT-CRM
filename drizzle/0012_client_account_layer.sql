CREATE TABLE "client_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "tags_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_accounts_org_business_unit_name_idx" ON "client_accounts" USING btree ("organization_id","business_unit_id","normalized_name");
--> statement-breakpoint
CREATE INDEX "client_accounts_business_unit_status_idx" ON "client_accounts" USING btree ("business_unit_id","status");
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "client_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contacts_client_account_idx" ON "contacts" USING btree ("client_account_id");
--> statement-breakpoint
CREATE TABLE "client_account_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_account_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "type" text DEFAULT 'source_alias' NOT NULL,
  "visibility" text DEFAULT 'hidden' NOT NULL,
  "searchable" boolean DEFAULT true NOT NULL,
  "source_label" text,
  "source_sheet" text,
  "source_row" integer,
  "confidence" numeric(5, 2),
  "verified_by_user_id" uuid,
  "verified_at" timestamp with time zone,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_account_aliases" ADD CONSTRAINT "client_account_aliases_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_account_aliases" ADD CONSTRAINT "client_account_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_account_aliases" ADD CONSTRAINT "client_account_aliases_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_account_aliases" ADD CONSTRAINT "client_account_aliases_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_account_aliases_account_idx" ON "client_account_aliases" USING btree ("client_account_id");
--> statement-breakpoint
CREATE INDEX "client_account_aliases_org_search_idx" ON "client_account_aliases" USING btree ("organization_id","normalized_value");
--> statement-breakpoint
CREATE INDEX "client_account_aliases_business_unit_visibility_idx" ON "client_account_aliases" USING btree ("business_unit_id","visibility");
--> statement-breakpoint
CREATE INDEX "client_account_aliases_source_idx" ON "client_account_aliases" USING btree ("source_sheet","source_row");
--> statement-breakpoint
CREATE TABLE "client_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_account_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "name" text NOT NULL,
  "role" text,
  "notes" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source_label" text,
  "source_sheet" text,
  "source_row" integer,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_people_account_idx" ON "client_people" USING btree ("client_account_id");
--> statement-breakpoint
CREATE INDEX "client_people_org_name_idx" ON "client_people" USING btree ("organization_id","name");
--> statement-breakpoint
CREATE INDEX "client_people_source_idx" ON "client_people" USING btree ("source_sheet","source_row");
--> statement-breakpoint
CREATE TABLE "client_contact_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_account_id" uuid NOT NULL,
  "client_person_id" uuid,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "method_type" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text,
  "label" text,
  "status" text DEFAULT 'active' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source_label" text,
  "source_sheet" text,
  "source_row" integer,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_contact_methods" ADD CONSTRAINT "client_contact_methods_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_contact_methods" ADD CONSTRAINT "client_contact_methods_client_person_id_client_people_id_fk" FOREIGN KEY ("client_person_id") REFERENCES "public"."client_people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_contact_methods" ADD CONSTRAINT "client_contact_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_contact_methods" ADD CONSTRAINT "client_contact_methods_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_contact_methods_account_idx" ON "client_contact_methods" USING btree ("client_account_id");
--> statement-breakpoint
CREATE INDEX "client_contact_methods_person_idx" ON "client_contact_methods" USING btree ("client_person_id");
--> statement-breakpoint
CREATE INDEX "client_contact_methods_org_normalized_idx" ON "client_contact_methods" USING btree ("organization_id","method_type","normalized_value");
--> statement-breakpoint
CREATE INDEX "client_contact_methods_business_unit_status_idx" ON "client_contact_methods" USING btree ("business_unit_id","status");
--> statement-breakpoint
CREATE INDEX "client_contact_methods_source_idx" ON "client_contact_methods" USING btree ("source_sheet","source_row");
--> statement-breakpoint
CREATE TABLE "client_locations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_account_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "label" text,
  "address" text,
  "city" text,
  "state" text,
  "postal_code" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source_label" text,
  "source_sheet" text,
  "source_row" integer,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_client_account_id_client_accounts_id_fk" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_locations" ADD CONSTRAINT "client_locations_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_locations_account_idx" ON "client_locations" USING btree ("client_account_id");
--> statement-breakpoint
CREATE INDEX "client_locations_org_city_idx" ON "client_locations" USING btree ("organization_id","city");
--> statement-breakpoint
CREATE INDEX "client_locations_source_idx" ON "client_locations" USING btree ("source_sheet","source_row");
