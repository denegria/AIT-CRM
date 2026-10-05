-- Apply only after 0030 and its manifest are present in the accepted forward lineage.
CREATE UNIQUE INDEX "student_charges_tuition_period_unique_idx"
  ON "student_charges" ("organization_id", "business_unit_id", "enrollment_id", "service_period_start", "service_period_end")
  WHERE "charge_type" = 'tuition_four_week' AND "enrollment_id" IS NOT NULL
    AND "service_period_start" IS NOT NULL AND "service_period_end" IS NOT NULL
    AND "status" <> 'voided';

CREATE TABLE "charge_pricing_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "charge_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "event_type" text NOT NULL,
  "standard_amount" numeric(12,2) NOT NULL,
  "old_amount" numeric(12,2),
  "new_amount" numeric(12,2) NOT NULL,
  "reason" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "charge_pricing_audit_charge_scope_fk" FOREIGN KEY ("charge_id", "organization_id", "business_unit_id")
    REFERENCES "student_charges"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "charge_pricing_audit_amount_check" CHECK ("standard_amount" > 0 AND "new_amount" > 0 AND "new_amount" <= "standard_amount"),
  CONSTRAINT "charge_pricing_audit_event_check" CHECK ("event_type" IN ('created', 'adjusted')),
  CONSTRAINT "charge_pricing_audit_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "charge_pricing_audit_idempotency_unique" UNIQUE ("organization_id", "business_unit_id", "idempotency_key")
);
CREATE INDEX "charge_pricing_audit_charge_idx" ON "charge_pricing_audit" ("organization_id", "business_unit_id", "charge_id", "created_at");
CREATE OR REPLACE FUNCTION reject_charge_pricing_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'charge_pricing_audit is append-only';
END;
$$;
CREATE TRIGGER "charge_pricing_audit_append_only" BEFORE UPDATE OR DELETE ON "charge_pricing_audit"
  FOR EACH ROW EXECUTE FUNCTION reject_charge_pricing_audit_mutation();

CREATE TABLE "registration_pricing_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "payment_request_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "reason" text NOT NULL,
  "standard_total" numeric(12,2) NOT NULL,
  "discount_total" numeric(12,2) NOT NULL,
  "final_total" numeric(12,2) NOT NULL,
  "line_adjustments" jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "registration_pricing_audit_request_scope_fk" FOREIGN KEY ("payment_request_id", "organization_id", "business_unit_id")
    REFERENCES "payment_requests"("id", "organization_id", "business_unit_id") ON DELETE restrict,
  CONSTRAINT "registration_pricing_audit_amount_check" CHECK ("standard_total" > 0 AND "discount_total" > 0 AND "final_total" > 0 AND "standard_total" = "discount_total" + "final_total"),
  CONSTRAINT "registration_pricing_audit_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "registration_pricing_audit_idempotency_unique" UNIQUE ("organization_id", "business_unit_id", "idempotency_key")
);
CREATE TRIGGER "registration_pricing_audit_append_only" BEFORE UPDATE OR DELETE ON "registration_pricing_audit"
  FOR EACH ROW EXECUTE FUNCTION reject_charge_pricing_audit_mutation();
