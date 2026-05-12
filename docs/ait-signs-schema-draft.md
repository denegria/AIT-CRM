# AIT Signs normalized schema draft

This is the first backend-oriented draft based on the workbook profile and migration notes.

Goal: preserve the messy source truth, normalize the operational CRM data, and keep staged imports reviewable.

## Core tenancy model

### `organizations`

- `id`
- `name`
- `slug`
- `created_at`
- `updated_at`

### `business_units`

- `id`
- `organization_id`
- `name`
- `label`
- `color`
- `is_active`
- `created_at`
- `updated_at`

### `business_unit_memberships`

- `id`
- `business_unit_id`
- `user_id`
- `role_id`
- `is_primary`
- `created_at`
- `updated_at`

## Identity and access

### `users`

- `id`
- `organization_id`
- `name`
- `email`
- `phone`
- `is_active`
- `created_at`
- `updated_at`

### `roles`

- `id`
- `organization_id`
- `key`
- `name`
- `description`

### `permissions`

- `id`
- `key`
- `description`

### `user_roles`

- `id`
- `user_id`
- `role_id`

## CRM core

### `contacts`

- `id`
- `organization_id`
- `primary_business_unit_id`
- `name`
- `company_name`
- `phone`
- `email`
- `address`
- `source_label`
- `is_do_not_call`
- `is_wrong_number`
- `created_at`
- `updated_at`

### `leads`

- `id`
- `organization_id`
- `business_unit_id`
- `contact_id`
- `source_type`
- `source_name`
- `status`
- `current_stage`
- `assigned_user_id`
- `original_notes`
- `created_at`
- `updated_at`

### `estimates`

- `id`
- `organization_id`
- `business_unit_id`
- `lead_id`
- `contact_id`
- `estimate_number`
- `status`
- `subtotal`
- `tax`
- `total`
- `advance_paid`
- `balance_due`
- `approved_at`
- `rejected_at`
- `created_at`
- `updated_at`

### `work_orders`

- `id`
- `organization_id`
- `business_unit_id`
- `lead_id`
- `estimate_id`
- `contact_id`
- `work_order_number`
- `status`
- `priority`
- `assigned_user_id`
- `designer_user_id`
- `chief_user_id`
- `delivery_date`
- `created_at`
- `updated_at`

### `payment_snapshots`

- `id`
- `organization_id`
- `business_unit_id`
- `estimate_id`
- `work_order_id`
- `payment_number`
- `payment_method`
- `check_number`
- `amount`
- `paid_at`
- `balance_after`
- `source_sheet`
- `source_row`

### `activity_events`

- `id`
- `organization_id`
- `business_unit_id`
- `contact_id`
- `lead_id`
- `estimate_id`
- `work_order_id`
- `event_type`
- `message`
- `actor_user_id`
- `source_sheet`
- `source_row`
- `occurred_at`
- `created_at`

### `notes`

- `id`
- `organization_id`
- `business_unit_id`
- `contact_id`
- `lead_id`
- `estimate_id`
- `work_order_id`
- `body`
- `author_user_id`
- `created_at`

### `files`

- `id`
- `organization_id`
- `business_unit_id`
- `record_type`
- `record_id`
- `storage_key`
- `filename`
- `mime_type`
- `size_bytes`
- `created_at`

## Import staging

### `import_batches`

- `id`
- `organization_id`
- `source_name`
- `source_type`
- `file_name`
- `file_hash`
- `sheet_name`
- `status`
- `created_by_user_id`
- `created_at`

### `import_source_rows`

- `id`
- `import_batch_id`
- `source_sheet`
- `source_row_number`
- `raw_values_json`
- `raw_text`
- `parse_status`
- `created_at`

### `import_normalized_records`

- `id`
- `import_batch_id`
- `source_row_id`
- `record_type`
- `proposed_contact_json`
- `proposed_lead_json`
- `proposed_estimate_json`
- `proposed_work_order_json`
- `proposed_payment_json`
- `confidence_score`
- `status`
- `created_at`

### `import_review_items`

- `id`
- `import_batch_id`
- `source_row_id`
- `review_type`
- `reason`
- `proposed_resolution_json`
- `review_status`
- `reviewed_by_user_id`
- `reviewed_at`

## Lifecycle mapping

Suggested source to target mapping:

- `INTERESADOS` -> `contacts`, `leads`, `activity_events`
- `ESTIMADOS` -> `contacts`, `leads`, `estimates`, `activity_events`
- `15 SIGNS WORK ORDER` -> `contacts`, `leads`, `estimates`, `work_orders`, `payment_snapshots`, `activity_events`
- `WORK ORDER TERMINADOS Y PAGADOS` -> `contacts`, `work_orders`, `payment_snapshots`, `activity_events`

## Normalized status buckets

- `new`
- `contacted`
- `follow_up`
- `quote_sent`
- `approved`
- `in_production`
- `ready_for_delivery`
- `delivered`
- `paid`
- `on_hold`
- `do_not_call`
- `lost`
- `wrong_number`

## Import rules

- Keep source data immutable in staging.
- Preserve original Spanish notes.
- Normalize phone numbers, dates, currency, and check fields.
- Review duplicate phones and conflicting names before merging.
- Promote only approved records to production tables.

## Open implementation questions

- Should `estimates` and `work_orders` share a common `orders` parent table, or stay separate for clarity?
- Do we want a single `activity_events` table for all timeline items, or split calls/messages/tasks later?
- Should financial snapshots be able to stand alone without an estimate/work order link when the source row is incomplete?
