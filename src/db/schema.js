import {
  bigint,
  boolean,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt,
  updatedAt,
});

export const businessUnits = pgTable('business_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  label: text('label').notNull().default('Divisions'),
  color: text('color'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt,
  updatedAt,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').unique(),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt,
  updatedAt,
});

export const userPasswordCredentials = pgTable('user_password_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordIterations: integer('password_iterations').notNull().default(310000),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => ({
  userIdx: uniqueIndex('user_password_credentials_user_idx').on(table.userId),
}));

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt,
  updatedAt,
}, (table) => ({
  orgKeyIdx: uniqueIndex('roles_org_key_idx').on(table.organizationId, table.key),
}));

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  description: text('description'),
  createdAt,
  updatedAt,
});

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt,
  updatedAt,
}, (table) => ({
  rolePermissionIdx: uniqueIndex('role_permissions_role_permission_idx').on(table.roleId, table.permissionId),
}));

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt,
  updatedAt,
}, (table) => ({
  userRoleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),
}));

export const businessUnitMemberships = pgTable('business_unit_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt,
  updatedAt,
}, (table) => ({
  membershipIdx: uniqueIndex('business_unit_memberships_unique_idx').on(table.businessUnitId, table.userId),
}));

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  primaryBusinessUnitId: uuid('primary_business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  companyName: text('company_name'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  sourceLabel: text('source_label'),
  isDoNotCall: boolean('is_do_not_call').notNull().default(false),
  isWrongNumber: boolean('is_wrong_number').notNull().default(false),
  createdAt,
  updatedAt,
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull(),
  sourceName: text('source_name'),
  status: text('status').notNull(),
  currentStage: text('current_stage'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  originalNotes: text('original_notes'),
  createdAt,
  updatedAt,
});

export const estimates = pgTable('estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  estimateNumber: text('estimate_number'),
  status: text('status').notNull(),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }),
  tax: numeric('tax', { precision: 12, scale: 2 }),
  total: numeric('total', { precision: 12, scale: 2 }),
  advancePaid: numeric('advance_paid', { precision: 12, scale: 2 }),
  balanceDue: numeric('balance_due', { precision: 12, scale: 2 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  estimateId: uuid('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  workOrderNumber: text('work_order_number'),
  title: text('title'),
  status: text('status').notNull(),
  priority: text('priority'),
  description: text('description'),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 2 }),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  designerUserId: uuid('designer_user_id').references(() => users.id, { onDelete: 'set null' }),
  chiefUserId: uuid('chief_user_id').references(() => users.id, { onDelete: 'set null' }),
  deliveryDate: date('delivery_date'),
  createdAt,
  updatedAt,
});

export const paymentSnapshots = pgTable('payment_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  estimateId: uuid('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  paymentNumber: integer('payment_number'),
  paymentMethod: text('payment_method'),
  checkNumber: text('check_number'),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  paidAt: date('paid_at'),
  balanceAfter: numeric('balance_after', { precision: 12, scale: 2 }),
  sourceSheet: text('source_sheet'),
  sourceRow: integer('source_row'),
  createdAt,
  updatedAt,
});

export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  estimateId: uuid('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  message: text('message'),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  sourceSheet: text('source_sheet'),
  sourceRow: integer('source_row'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  createdAt,
});

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  estimateId: uuid('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt,
  updatedAt,
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  taskType: text('task_type').notNull(),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('medium'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  sourceLabel: text('source_label'),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  createdAt,
  updatedAt,
}, (table) => ({
  orgStatusDueIdx: index('tasks_org_status_due_idx').on(table.organizationId, table.status, table.dueAt),
  businessUnitStatusDueIdx: index('tasks_business_unit_status_due_idx').on(table.businessUnitId, table.status, table.dueAt),
  ownerStatusDueIdx: index('tasks_owner_status_due_idx').on(table.ownerUserId, table.status, table.dueAt),
  contactIdx: index('tasks_contact_idx').on(table.contactId),
  leadIdx: index('tasks_lead_idx').on(table.leadId),
  workOrderIdx: index('tasks_work_order_idx').on(table.workOrderId),
}));

export const taskEvents = pgTable('task_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').notNull().references(() => businessUnits.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  fromOwnerUserId: uuid('from_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  toOwnerUserId: uuid('to_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  fromDueAt: timestamp('from_due_at', { withTimezone: true }),
  toDueAt: timestamp('to_due_at', { withTimezone: true }),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  message: text('message'),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt,
}, (table) => ({
  taskOccurredIdx: index('task_events_task_occurred_idx').on(table.taskId, table.occurredAt),
  orgOccurredIdx: index('task_events_org_occurred_idx').on(table.organizationId, table.occurredAt),
}));

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  businessUnitId: uuid('business_unit_id').references(() => businessUnits.id, { onDelete: 'set null' }),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id').notNull(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt,
});

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sourceName: text('source_name').notNull(),
  sourceType: text('source_type').notNull(),
  fileName: text('file_name').notNull(),
  fileHash: text('file_hash'),
  sheetName: text('sheet_name'),
  status: text('status').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt,
});

export const importSourceRows = pgTable('import_source_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  sourceSheet: text('source_sheet').notNull(),
  sourceRowNumber: integer('source_row_number').notNull(),
  rawValuesJson: jsonb('raw_values_json').notNull(),
  rawText: text('raw_text'),
  parseStatus: text('parse_status').notNull().default('pending'),
  createdAt,
});

export const importNormalizedRecords = pgTable('import_normalized_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  sourceRowId: uuid('source_row_id').notNull().references(() => importSourceRows.id, { onDelete: 'cascade' }),
  recordType: text('record_type').notNull(),
  proposedContactJson: jsonb('proposed_contact_json'),
  proposedLeadJson: jsonb('proposed_lead_json'),
  proposedEstimateJson: jsonb('proposed_estimate_json'),
  proposedWorkOrderJson: jsonb('proposed_work_order_json'),
  proposedPaymentJson: jsonb('proposed_payment_json'),
  proposedNoteJson: jsonb('proposed_note_json'),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 2 }),
  status: text('status').notNull().default('pending'),
  createdAt,
});

export const importReviewItems = pgTable('import_review_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  sourceRowId: uuid('source_row_id').references(() => importSourceRows.id, { onDelete: 'cascade' }),
  reviewType: text('review_type').notNull(),
  reason: text('reason').notNull(),
  proposedResolutionJson: jsonb('proposed_resolution_json'),
  reviewStatus: text('review_status').notNull().default('pending'),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt,
  updatedAt,
});

export const allTables = {
  organizations,
  businessUnits,
  users,
  userPasswordCredentials,
  userSessions,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  businessUnitMemberships,
  contacts,
  leads,
  estimates,
  workOrders,
  paymentSnapshots,
  activityEvents,
  notes,
  tasks,
  taskEvents,
  files,
  importBatches,
  importSourceRows,
  importNormalizedRecords,
  importReviewItems,
};
