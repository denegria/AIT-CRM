CREATE TABLE "conversation_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_unit_id" uuid,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_unit_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"direction" text NOT NULL,
	"delivery_status" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_thread_id" text NOT NULL,
	"external_message_id" text,
	"idempotency_key" text NOT NULL,
	"sender_identity" text,
	"recipient_identity" text,
	"text_body" text,
	"raw_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_unit_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"channel_id" uuid,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_thread_id" text NOT NULL,
	"external_participant_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_channels" ADD CONSTRAINT "conversation_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_channels" ADD CONSTRAINT "conversation_channels_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_conversation_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conversation_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_channels_org_provider_account_idx" ON "conversation_channels" USING btree ("organization_id","provider","channel","provider_account_id");--> statement-breakpoint
CREATE INDEX "conversation_channels_business_unit_idx" ON "conversation_channels" USING btree ("business_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_provider_message_idx" ON "conversation_messages" USING btree ("organization_id","provider","channel","idempotency_key");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_occurred_idx" ON "conversation_messages" USING btree ("conversation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_contact_occurred_idx" ON "conversation_messages" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_lead_occurred_idx" ON "conversation_messages" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_business_unit_status_idx" ON "conversation_messages" USING btree ("business_unit_id","delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_provider_conversation_idx" ON "conversations" USING btree ("organization_id","provider","channel","provider_account_id","provider_thread_id","external_participant_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_last_message_idx" ON "conversations" USING btree ("contact_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_lead_last_message_idx" ON "conversations" USING btree ("lead_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_business_unit_status_idx" ON "conversations" USING btree ("business_unit_id","status");