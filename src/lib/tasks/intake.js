import { TASK_PRIORITIES, TASK_SOURCE_TYPES, TASK_STATUSES, TASK_TYPES } from './constants.js';

function cleanText(value) {
  return String(value || '').trim();
}

function intakeDescription({ sourceName, detail }) {
  const source = cleanText(sourceName) || 'Inbound lead';
  const summary = cleanText(detail);
  return summary ? `${source}: ${summary}` : `${source}: Review the new lead and log the first follow-up outcome.`;
}

export async function createInboundLeadIntakeTask(client, {
  organizationId,
  businessUnitId,
  contactId,
  leadId,
  sourceType,
  sourceName,
  contactName,
  detail,
  idempotencyKey,
  metadata = {},
} = {}) {
  if (!organizationId || !businessUnitId || !contactId || !leadId || !idempotencyKey) {
    return { inserted: false, reason: 'invalid_intake_task' };
  }

  const title = `Review new lead follow-up${cleanText(contactName) ? ` - ${cleanText(contactName)}` : ''}`;
  const metadataJson = {
    sourceName: cleanText(sourceName) || null,
    sourceType: cleanText(sourceType) || null,
    requiresFollowUpNote: true,
    ...metadata,
  };

  const inserted = await client.query(
    `
      with new_task as (
        insert into tasks
        (organization_id, business_unit_id, contact_id, lead_id, title, description, task_type, status, priority, due_at, owner_user_id, created_by_user_id, source_type, source_id, source_label, metadata_json)
        select $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), null, null, $10, $11, $12, $13::jsonb
        where not exists (
          select 1
          from tasks
          where organization_id = $1
            and source_type = $10
            and source_id = $11
        )
        returning *
      ),
      task_event as (
        insert into task_events
        (task_id, organization_id, business_unit_id, event_type, to_status, to_owner_user_id, to_due_at, actor_user_id, message, metadata_json)
        select id, organization_id, business_unit_id, 'created', status, owner_user_id, due_at, null, 'Created new lead follow-up task.', $13::jsonb
        from new_task
        returning id
      )
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, metadata_json, actor_user_id, occurred_at)
      select organization_id, business_unit_id, contact_id, lead_id, 'task.created', 'Created new lead follow-up task.', $13::jsonb, null, now()
      from new_task
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      title,
      intakeDescription({ sourceName, detail }),
      TASK_TYPES.FOLLOW_UP,
      TASK_STATUSES.OPEN,
      TASK_PRIORITIES.HIGH,
      TASK_SOURCE_TYPES.AUTOMATION,
      idempotencyKey,
      'New lead follow-up',
      JSON.stringify(metadataJson),
    ],
  );

  return {
    inserted: Boolean(inserted.rows[0]?.id),
    taskActivityEventId: inserted.rows[0]?.id || null,
  };
}
