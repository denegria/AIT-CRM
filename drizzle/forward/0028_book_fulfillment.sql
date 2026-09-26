CREATE TABLE "book_fulfillments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "student_contact_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "payment_request_id" uuid NOT NULL,
  "provider_transaction_id" uuid,
  "delivery_mode" text NOT NULL,
  "status" text DEFAULT 'payment_pending' NOT NULL,
  "digital_status" text DEFAULT 'not_required' NOT NULL,
  "physical_status" text DEFAULT 'not_required' NOT NULL,
  "shipping_address_snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "assigned_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "carrier" text,
  "tracking_reference" text,
  "notes" text,
  "ready_at" timestamp with time zone,
  "digital_sent_at" timestamp with time zone,
  "shipped_at" timestamp with time zone,
  "picked_up_at" timestamp with time zone,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "book_fulfillments_student_scope_fk" FOREIGN KEY ("student_contact_id", "organization_id", "business_unit_id")
    REFERENCES "contacts"("id", "organization_id", "primary_business_unit_id") ON DELETE restrict,
  CONSTRAINT "book_fulfillments_enrollment_scope_fk" FOREIGN KEY ("enrollment_id", "organization_id", "business_unit_id")
    REFERENCES "contact_course_records"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "book_fulfillments_request_scope_fk" FOREIGN KEY ("payment_request_id", "organization_id", "business_unit_id")
    REFERENCES "payment_requests"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "book_fulfillments_transaction_scope_fk" FOREIGN KEY ("provider_transaction_id", "organization_id", "business_unit_id")
    REFERENCES "provider_transactions"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "book_fulfillments_mode_check" CHECK ("delivery_mode" IN ('pickup', 'shipment', 'digital')),
  CONSTRAINT "book_fulfillments_status_check" CHECK ("status" IN ('payment_pending', 'pending', 'in_progress', 'completed')),
  CONSTRAINT "book_fulfillments_digital_status_check" CHECK ("digital_status" IN ('not_required', 'pending', 'delivered')),
  CONSTRAINT "book_fulfillments_physical_status_check" CHECK ("physical_status" IN ('not_required', 'pending', 'ready', 'picked_up', 'shipped')),
  CONSTRAINT "book_fulfillments_component_check" CHECK (
    ("delivery_mode" = 'pickup' AND "digital_status" = 'not_required' AND "physical_status" IN ('pending', 'ready', 'picked_up'))
    OR ("delivery_mode" = 'shipment' AND "digital_status" IN ('pending', 'delivered') AND "physical_status" IN ('pending', 'shipped'))
    OR ("delivery_mode" = 'digital' AND "digital_status" IN ('pending', 'delivered') AND "physical_status" = 'not_required')
  ),
  CONSTRAINT "book_fulfillments_address_check" CHECK (
    ("delivery_mode" = 'shipment'
      AND jsonb_typeof("shipping_address_snapshot_json") = 'object'
      AND "shipping_address_snapshot_json" ?& ARRAY['recipientName', 'addressLine1', 'city', 'state', 'postalCode', 'countryCode']
      AND "shipping_address_snapshot_json"->>'countryCode' = 'US')
    OR ("delivery_mode" <> 'shipment' AND "shipping_address_snapshot_json" = '{}'::jsonb)
  )
);

CREATE UNIQUE INDEX "book_fulfillments_scope_idx"
  ON "book_fulfillments" ("id", "organization_id", "business_unit_id");
CREATE UNIQUE INDEX "book_fulfillments_idempotency_idx"
  ON "book_fulfillments" ("organization_id", "business_unit_id", "idempotency_key");
CREATE UNIQUE INDEX "book_fulfillments_payment_request_idx"
  ON "book_fulfillments" ("organization_id", "business_unit_id", "payment_request_id");
CREATE INDEX "book_fulfillments_queue_idx"
  ON "book_fulfillments" ("organization_id", "business_unit_id", "status", "created_at");
