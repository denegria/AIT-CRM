CREATE UNIQUE INDEX "contact_course_records_billing_scope_idx"
  ON "contact_course_records" ("id", "organization_id", "business_unit_id");
CREATE UNIQUE INDEX "contacts_billing_scope_idx"
  ON "contacts" ("id", "organization_id", "primary_business_unit_id");
CREATE UNIQUE INDEX "financial_documents_billing_scope_idx"
  ON "financial_documents" ("id", "organization_id", "business_unit_id");

CREATE TABLE "student_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "student_contact_id" uuid NOT NULL,
  "payer_contact_id" uuid,
  "enrollment_id" uuid,
  "class_section_id" uuid,
  "charge_type" text NOT NULL,
  "description" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'due' NOT NULL,
  "service_period_start" date,
  "service_period_end" date,
  "original_due_date" date,
  "waived_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "source_type" text NOT NULL,
  "source_reference" text,
  "idempotency_key" text NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "student_charges_student_scope_fk" FOREIGN KEY ("student_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "student_charges_payer_scope_fk" FOREIGN KEY ("payer_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "student_charges_enrollment_scope_fk" FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id")
    REFERENCES "contact_course_records"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "student_charges_section_scope_fk" FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "student_charges_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "student_charges_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "student_charges_status_check" CHECK ("status" IN ('due', 'partially_paid', 'paid', 'overdue', 'waived', 'voided', 'refunded')),
  CONSTRAINT "student_charges_period_check" CHECK ("service_period_start" IS NULL OR "service_period_end" IS NULL OR "service_period_end" >= "service_period_start")
);

CREATE UNIQUE INDEX "student_charges_scope_idx"
  ON "student_charges" ("id", "organization_id", "business_unit_id");
CREATE UNIQUE INDEX "student_charges_idempotency_idx"
  ON "student_charges" ("organization_id", "business_unit_id", "idempotency_key");
CREATE INDEX "student_charges_student_status_idx"
  ON "student_charges" ("organization_id", "business_unit_id", "student_contact_id", "status");
CREATE INDEX "student_charges_due_idx"
  ON "student_charges" ("business_unit_id", "status", "original_due_date");

CREATE TABLE "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "student_contact_id" uuid NOT NULL,
  "payer_contact_id" uuid,
  "enrollment_id" uuid,
  "class_section_id" uuid,
  "charge_id" uuid,
  "requested_amount" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'created' NOT NULL,
  "provider" text,
  "provider_environment" text,
  "provider_request_id" text,
  "merchant_reference" text NOT NULL,
  "expires_at" timestamp with time zone,
  "source_type" text NOT NULL,
  "source_reference" text,
  "idempotency_key" text NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_requests_student_scope_fk" FOREIGN KEY ("student_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_requests_payer_scope_fk" FOREIGN KEY ("payer_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_requests_charge_scope_fk" FOREIGN KEY ("charge_id", "organization_id", "business_unit_id")
    REFERENCES "student_charges"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_requests_enrollment_scope_fk" FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id")
    REFERENCES "contact_course_records"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_requests_section_scope_fk" FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_requests_amount_check" CHECK ("requested_amount" > 0),
  CONSTRAINT "payment_requests_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payment_requests_status_check" CHECK ("status" IN ('created', 'pending', 'completed', 'failed', 'expired', 'canceled'))
);

CREATE UNIQUE INDEX "payment_requests_scope_idx"
  ON "payment_requests" ("id", "organization_id", "business_unit_id");
CREATE UNIQUE INDEX "payment_requests_idempotency_idx"
  ON "payment_requests" ("organization_id", "business_unit_id", "idempotency_key");
CREATE UNIQUE INDEX "payment_requests_merchant_reference_idx"
  ON "payment_requests" ("organization_id", "business_unit_id", "merchant_reference");
CREATE UNIQUE INDEX "payment_requests_provider_request_idx"
  ON "payment_requests" ("organization_id", "provider", "provider_environment", "provider_request_id")
  WHERE "provider_request_id" IS NOT NULL;
CREATE INDEX "payment_requests_student_status_idx"
  ON "payment_requests" ("organization_id", "business_unit_id", "student_contact_id", "status");

CREATE TABLE "provider_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "payment_request_id" uuid,
  "student_contact_id" uuid NOT NULL,
  "payer_contact_id" uuid,
  "enrollment_id" uuid,
  "class_section_id" uuid,
  "parent_transaction_id" uuid,
  "receipt_document_id" uuid,
  "provider" text NOT NULL,
  "provider_environment" text NOT NULL,
  "provider_transaction_id" text NOT NULL,
  "merchant_reference" text NOT NULL,
  "transaction_kind" text DEFAULT 'payment' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "occurred_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "source_type" text NOT NULL,
  "source_reference" text,
  "idempotency_key" text NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provider_transactions_student_scope_fk" FOREIGN KEY ("student_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_payer_scope_fk" FOREIGN KEY ("payer_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_receipt_scope_fk" FOREIGN KEY ("receipt_document_id", "organization_id", "business_unit_id")
    REFERENCES "financial_documents"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_request_scope_fk" FOREIGN KEY ("payment_request_id", "organization_id", "business_unit_id")
    REFERENCES "payment_requests"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_enrollment_scope_fk" FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id")
    REFERENCES "contact_course_records"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_section_scope_fk" FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "provider_transactions_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "provider_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "provider_transactions_kind_check" CHECK ("transaction_kind" IN ('payment', 'refund')),
  CONSTRAINT "provider_transactions_status_check" CHECK ("status" IN ('pending', 'verified', 'failed', 'voided')),
  CONSTRAINT "provider_transactions_verified_check" CHECK ("status" <> 'verified' OR "verified_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "provider_transactions_scope_idx"
  ON "provider_transactions" ("id", "organization_id", "business_unit_id");
ALTER TABLE "provider_transactions"
  ADD CONSTRAINT "provider_transactions_parent_scope_fk"
  FOREIGN KEY ("parent_transaction_id", "organization_id", "business_unit_id")
  REFERENCES "provider_transactions"("id", "organization_id", "business_unit_id") ON DELETE restrict;
CREATE UNIQUE INDEX "provider_transactions_idempotency_idx"
  ON "provider_transactions" ("organization_id", "business_unit_id", "idempotency_key");
CREATE UNIQUE INDEX "provider_transactions_provider_transaction_idx"
  ON "provider_transactions" ("organization_id", "provider", "provider_environment", "provider_transaction_id");
CREATE INDEX "provider_transactions_merchant_reference_idx"
  ON "provider_transactions" ("business_unit_id", "provider", "merchant_reference");
CREATE INDEX "provider_transactions_student_status_idx"
  ON "provider_transactions" ("organization_id", "business_unit_id", "student_contact_id", "status");

CREATE TABLE "payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "charge_id" uuid NOT NULL,
  "transaction_id" uuid NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "idempotency_key" text NOT NULL,
  "allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_allocations_charge_scope_fk" FOREIGN KEY ("charge_id", "organization_id", "business_unit_id")
    REFERENCES "student_charges"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_allocations_transaction_scope_fk" FOREIGN KEY ("transaction_id", "organization_id", "business_unit_id")
    REFERENCES "provider_transactions"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_allocations_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payment_allocations_idempotency_idx"
  ON "payment_allocations" ("organization_id", "business_unit_id", "idempotency_key");
CREATE INDEX "payment_allocations_charge_idx"
  ON "payment_allocations" ("charge_id", "allocated_at");
CREATE INDEX "payment_allocations_transaction_idx"
  ON "payment_allocations" ("transaction_id", "allocated_at");

CREATE TABLE "payment_provider_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "payment_request_id" uuid,
  "transaction_id" uuid,
  "student_contact_id" uuid NOT NULL,
  "payer_contact_id" uuid,
  "enrollment_id" uuid,
  "class_section_id" uuid,
  "provider" text NOT NULL,
  "provider_environment" text NOT NULL,
  "provider_event_id" text,
  "event_type" text NOT NULL,
  "processing_status" text DEFAULT 'received' NOT NULL,
  "payload_sha256" text NOT NULL,
  "safe_payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "occurred_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_provider_events_student_scope_fk" FOREIGN KEY ("student_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_payer_scope_fk" FOREIGN KEY ("payer_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_request_scope_fk" FOREIGN KEY ("payment_request_id", "organization_id", "business_unit_id")
    REFERENCES "payment_requests"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_transaction_scope_fk" FOREIGN KEY ("transaction_id", "organization_id", "business_unit_id")
    REFERENCES "provider_transactions"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_enrollment_scope_fk" FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id")
    REFERENCES "contact_course_records"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_section_scope_fk" FOREIGN KEY ("class_section_id", "organization_id", "business_unit_id")
    REFERENCES "course_class_sections"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "payment_provider_events_payload_hash_check" CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "payment_provider_events_status_check" CHECK ("processing_status" IN ('received', 'processed', 'ignored', 'failed')),
  CONSTRAINT "payment_provider_events_link_check" CHECK ("payment_request_id" IS NOT NULL OR "transaction_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "payment_provider_events_idempotency_idx"
  ON "payment_provider_events" ("organization_id", "business_unit_id", "idempotency_key");
CREATE UNIQUE INDEX "payment_provider_events_provider_event_idx"
  ON "payment_provider_events" ("organization_id", "provider", "provider_environment", "provider_event_id")
  WHERE "provider_event_id" IS NOT NULL;
CREATE INDEX "payment_provider_events_request_occurred_idx"
  ON "payment_provider_events" ("payment_request_id", "occurred_at");
CREATE INDEX "payment_provider_events_transaction_occurred_idx"
  ON "payment_provider_events" ("transaction_id", "occurred_at");
