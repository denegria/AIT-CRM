CREATE TABLE "follow_up_sequences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'draft' NOT NULL,
  "default_channel" text DEFAULT 'messenger' NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "max_touches" integer DEFAULT 3 NOT NULL,
  "settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequence_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sequence_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "step_key" text NOT NULL,
  "position" integer NOT NULL,
  "delay_minutes" integer DEFAULT 1440 NOT NULL,
  "channel" text DEFAULT 'messenger' NOT NULL,
  "template_id" uuid,
  "action_type" text DEFAULT 'task_and_draft' NOT NULL,
  "task_title" text NOT NULL,
  "task_description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequence_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "sequence_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "lead_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "channel" text NOT NULL,
  "owner_user_id" uuid,
  "enrolled_by_user_id" uuid,
  "trigger_type" text DEFAULT 'manual' NOT NULL,
  "next_step_position" integer DEFAULT 1 NOT NULL,
  "next_step_due_at" timestamp with time zone NOT NULL,
  "touch_count" integer DEFAULT 0 NOT NULL,
  "max_touches" integer DEFAULT 3 NOT NULL,
  "paused_until" timestamp with time zone,
  "stopped_at" timestamp with time zone,
  "stop_reason" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_up_sequence_step_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "sequence_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "step_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "lead_id" uuid,
  "task_id" uuid,
  "status" text NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "executed_at" timestamp with time zone,
  "idempotency_key" text NOT NULL,
  "draft_message_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "blocked_reason" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequences" ADD CONSTRAINT "follow_up_sequences_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_steps" ADD CONSTRAINT "follow_up_sequence_steps_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_steps" ADD CONSTRAINT "follow_up_sequence_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_steps" ADD CONSTRAINT "follow_up_sequence_steps_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_enrollments" ADD CONSTRAINT "follow_up_sequence_enrollments_enrolled_by_user_id_users_id_fk" FOREIGN KEY ("enrolled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_sequence_id_follow_up_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."follow_up_sequences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_enrollment_id_follow_up_sequence_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."follow_up_sequence_enrollments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_step_id_follow_up_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."follow_up_sequence_steps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follow_up_sequence_step_runs" ADD CONSTRAINT "follow_up_sequence_step_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_sequences_org_key_idx" ON "follow_up_sequences" USING btree ("organization_id","key");
--> statement-breakpoint
CREATE INDEX "follow_up_sequences_business_unit_idx" ON "follow_up_sequences" USING btree ("business_unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_sequence_steps_sequence_position_idx" ON "follow_up_sequence_steps" USING btree ("sequence_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_sequence_steps_sequence_key_idx" ON "follow_up_sequence_steps" USING btree ("sequence_id","step_key");
--> statement-breakpoint
CREATE INDEX "follow_up_sequence_enrollments_org_status_due_idx" ON "follow_up_sequence_enrollments" USING btree ("organization_id","status","next_step_due_at");
--> statement-breakpoint
CREATE INDEX "follow_up_sequence_enrollments_contact_status_idx" ON "follow_up_sequence_enrollments" USING btree ("contact_id","status");
--> statement-breakpoint
CREATE INDEX "follow_up_sequence_enrollments_business_unit_status_idx" ON "follow_up_sequence_enrollments" USING btree ("business_unit_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_sequence_step_runs_idempotency_idx" ON "follow_up_sequence_step_runs" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "follow_up_sequence_step_runs_enrollment_step_idx" ON "follow_up_sequence_step_runs" USING btree ("enrollment_id","step_id");
--> statement-breakpoint
CREATE INDEX "follow_up_sequence_step_runs_org_status_idx" ON "follow_up_sequence_step_runs" USING btree ("organization_id","status");
