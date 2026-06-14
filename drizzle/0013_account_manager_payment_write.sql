CREATE TABLE IF NOT EXISTS "financial_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "business_unit_id" uuid NOT NULL REFERENCES "business_units"("id") ON DELETE cascade,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE set null,
  "work_order_id" uuid REFERENCES "work_orders"("id") ON DELETE set null,
  "estimate_id" uuid REFERENCES "estimates"("id") ON DELETE set null,
  "document_number" text,
  "document_type" text NOT NULL,
  "status" text DEFAULT 'Draft' NOT NULL,
  "subtotal" numeric(12, 2),
  "tax" numeric(12, 2),
  "total" numeric(12, 2),
  "paid_amount" numeric(12, 2),
  "balance_due" numeric(12, 2),
  "issue_date" date,
  "due_date" date,
  "items_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "financial_documents_org_created_idx"
  ON "financial_documents" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "financial_documents_contact_idx"
  ON "financial_documents" ("contact_id");
CREATE INDEX IF NOT EXISTS "financial_documents_work_order_idx"
  ON "financial_documents" ("work_order_id");
CREATE INDEX IF NOT EXISTS "financial_documents_type_idx"
  ON "financial_documents" ("document_type");

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'financials:write'
WHERE r.key = 'account_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
