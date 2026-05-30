-- AIT Signs import and CRM schema draft
-- This is a design draft, not yet wired to a migration tool.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  label text not null default 'Divisions',
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  email text unique,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  unique (organization_id, key)
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  description text
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  unique (user_id, role_id)
);

create table business_unit_memberships (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid references roles(id) on delete set null,
  is_primary boolean not null default false,
  unique (business_unit_id, user_id)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  primary_business_unit_id uuid references business_units(id) on delete set null,
  name text not null,
  company_name text,
  phone text,
  email text,
  address text,
  source_label text,
  is_do_not_call boolean not null default false,
  is_wrong_number boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  source_type text not null,
  source_name text,
  status text not null,
  current_stage text,
  assigned_user_id uuid references users(id) on delete set null,
  original_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  estimate_number text,
  status text not null,
  subtotal numeric(12,2),
  tax numeric(12,2),
  total numeric(12,2),
  advance_paid numeric(12,2),
  balance_due numeric(12,2),
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  estimate_id uuid references estimates(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  work_order_number text,
  status text not null,
  priority text,
  assigned_user_id uuid references users(id) on delete set null,
  designer_user_id uuid references users(id) on delete set null,
  chief_user_id uuid references users(id) on delete set null,
  delivery_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid not null references business_units(id) on delete cascade,
  estimate_id uuid references estimates(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  payment_number integer,
  payment_method text,
  check_number text,
  amount numeric(12,2),
  paid_at date,
  balance_after numeric(12,2),
  source_sheet text,
  source_row integer
);

create table activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  estimate_id uuid references estimates(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  event_type text not null,
  message text,
  actor_user_id uuid references users(id) on delete set null,
  source_sheet text,
  source_row integer,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  estimate_id uuid references estimates(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  body text not null,
  author_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  record_type text not null,
  record_id uuid not null,
  storage_key text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  source_name text not null,
  source_type text not null,
  file_name text not null,
  file_hash text,
  sheet_name text,
  status text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table import_source_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row_number integer not null,
  raw_values_json jsonb not null,
  raw_text text,
  parse_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table import_normalized_records (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  source_row_id uuid not null references import_source_rows(id) on delete cascade,
  record_type text not null,
  proposed_contact_json jsonb,
  proposed_lead_json jsonb,
  proposed_estimate_json jsonb,
  proposed_work_order_json jsonb,
  proposed_payment_json jsonb,
  confidence_score numeric(5,2),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table import_review_items (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  source_row_id uuid references import_source_rows(id) on delete cascade,
  review_type text not null,
  reason text not null,
  proposed_resolution_json jsonb,
  review_status text not null default 'pending',
  reviewed_by_user_id uuid references users(id) on delete set null,
  reviewed_at timestamptz
);
