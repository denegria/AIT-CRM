const SIMPLE_REPARENT_TABLES = [
  'contact_channel_consent_events', 'contact_people', 'leads', 'lead_status_history',
  'notifications', 'estimates', 'work_orders', 'financial_documents', 'activity_events',
  'notes', 'tasks', 'conversations', 'conversation_messages', 'follow_up_sequence_step_runs',
];

export const CONTACT_RELATIONSHIP_POLICIES = Object.freeze({
  ...Object.fromEntries(SIMPLE_REPARENT_TABLES.map((table) => [`${table}.contact_id`, 'reparent'])),
  'contact_phone_numbers.contact_id': 'merge_phone_collision',
  'contact_channel_consents.contact_id': 'merge_consent_collision',
  'contact_course_records.contact_id': 'preserve_course_collision',
  'follow_up_sequence_enrollments.contact_id': 'preserve_sequence_collision',
  'sms_campaign_recipients.contact_id': 'preserve_campaign_collision',
  'contact_merge_runs.source_contact_id': 'audit_reference',
  'contact_merge_runs.target_contact_id': 'audit_reference',
});

function mergedMetadata(current, snapshot, runId) {
  const value = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const history = Array.isArray(value.contactMergeHistory) ? value.contactMergeHistory : [];
  return { ...value, contactMergeHistory: [...history, { runId, snapshot }] };
}

export async function listContactForeignKeys(client) {
  const result = await client.query(`
    select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_schema = tc.constraint_schema and ccu.constraint_name = tc.constraint_name
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
       and ccu.table_name = 'contacts' and ccu.column_name = 'id'
     order by tc.table_name, kcu.column_name`);
  return result.rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

export function assertKnownContactRelationships(relationships) {
  const unknown = relationships
    .map(({ table, column }) => `${table}.${column}`)
    .filter((key) => !CONTACT_RELATIONSHIP_POLICIES[key]);
  if (unknown.length) throw new Error(`Unclassified Contact relationships abort merge: ${unknown.join(', ')}`);
  return true;
}

export async function inspectContactMerge(client, { organizationId, sourceContactId, targetContactId }) {
  if (!organizationId || !sourceContactId || !targetContactId || sourceContactId === targetContactId) {
    throw new Error('Contact merge requires one organization and two different Contacts.');
  }
  const contacts = await client.query(
    `select id, name, phone, email, archived_at from contacts
      where organization_id = $1 and id = any($2::uuid[]) order by id`,
    [organizationId, [sourceContactId, targetContactId]],
  );
  if (contacts.rows.length !== 2) throw new Error('Both merge Contacts must exist in the same organization.');
  const source = contacts.rows.find((row) => row.id === sourceContactId);
  const target = contacts.rows.find((row) => row.id === targetContactId);
  if (target.archived_at) throw new Error('Canonical Contact is archived.');
  const relationships = await listContactForeignKeys(client);
  assertKnownContactRelationships(relationships);
  const inventory = {};
  for (const { table, column } of relationships) {
    const key = `${table}.${column}`;
    if (CONTACT_RELATIONSHIP_POLICIES[key] === 'audit_reference') continue;
    const result = await client.query(`select count(*)::int as count from "${table}" where "${column}" = $1`, [sourceContactId]);
    inventory[key] = result.rows[0].count;
  }
  return { source, target, relationships, inventory, approvalEligible: !source.archived_at };
}

async function mergePhones(client, context) {
  const sourceRows = await client.query('select * from contact_phone_numbers where contact_id = $1 order by created_at, id', [context.sourceContactId]);
  for (const source of sourceRows.rows) {
    const collision = await client.query(
      'select * from contact_phone_numbers where organization_id = $1 and contact_id = $2 and normalized_phone = $3 for update',
      [context.organizationId, context.targetContactId, source.normalized_phone],
    );
    if (collision.rows.length) {
      const target = collision.rows[0];
      await client.query(
        `update contact_phone_numbers set is_do_not_call = $1, is_wrong_number = $2,
           channel_consent_json = $3::jsonb, metadata_json = $4::jsonb, updated_at = now() where id = $5`,
        [target.is_do_not_call || source.is_do_not_call, target.is_wrong_number || source.is_wrong_number,
          JSON.stringify({ ...(source.channel_consent_json || {}), ...(target.channel_consent_json || {}) }),
          JSON.stringify(mergedMetadata(target.metadata_json, source, context.runId)), target.id],
      );
      await client.query('delete from contact_phone_numbers where id = $1', [source.id]);
    } else {
      const hasPrimary = await client.query('select 1 from contact_phone_numbers where contact_id = $1 and is_primary = true', [context.targetContactId]);
      await client.query(
        `update contact_phone_numbers set contact_id = $1,
           is_primary = case when $2 then false else is_primary end,
           retired_at = case when $2 and is_primary then coalesce(retired_at, now()) else retired_at end,
           metadata_json = $3::jsonb, updated_at = now() where id = $4`,
        [context.targetContactId, Boolean(hasPrimary.rows.length),
          JSON.stringify(mergedMetadata(source.metadata_json, { sourceContactId: context.sourceContactId }, context.runId)), source.id],
      );
    }
  }
}

const consentRank = (status) => (status === 'opted_out' ? 3 : status === 'opted_in' ? 2 : 1);

async function mergeConsents(client, context) {
  const sourceRows = await client.query('select * from contact_channel_consents where contact_id = $1 order by created_at, id', [context.sourceContactId]);
  for (const source of sourceRows.rows) {
    const collision = await client.query(
      `select * from contact_channel_consents
        where organization_id = $1 and contact_id = $2 and channel = $3 and scope_key = $4 for update`,
      [context.organizationId, context.targetContactId, source.channel, source.scope_key],
    );
    if (!collision.rows.length) {
      await client.query('update contact_channel_consents set contact_id = $1, updated_at = now() where id = $2', [context.targetContactId, source.id]);
      continue;
    }
    const target = collision.rows[0];
    const winner = consentRank(source.consent_status) > consentRank(target.consent_status) ? source : target;
    await client.query(
      `update contact_channel_consents set consent_status = $1,
         opt_in_source = $2, opt_in_reference = $3, opt_in_disclosure_text = $4, opt_in_occurred_at = $5,
         opt_out_source = $6, opt_out_reference = $7, opt_out_reason = $8, opt_out_occurred_at = $9,
         metadata_json = $10::jsonb, updated_at = now() where id = $11`,
      [winner.consent_status, winner.opt_in_source, winner.opt_in_reference, winner.opt_in_disclosure_text,
        winner.opt_in_occurred_at, winner.opt_out_source, winner.opt_out_reference, winner.opt_out_reason,
        winner.opt_out_occurred_at, JSON.stringify(mergedMetadata(target.metadata_json, source, context.runId)), target.id],
    );
    await client.query('delete from contact_channel_consents where id = $1', [source.id]);
  }
}

async function preserveCollisions(client, context) {
  await client.query(
    `update contact_course_records source set status = 'merged_duplicate',
       metadata_json = coalesce(source.metadata_json, '{}'::jsonb) || jsonb_build_object(
         'contactMergeRunId', $1::text, 'mergedIntoCourseRecordId', target.id::text, 'previousStatus', source.status), updated_at = now()
      from contact_course_records target where source.contact_id = $2 and target.contact_id = $3
       and source.status = 'active' and target.status = 'active'
       and source.class_section_id is not null and source.class_section_id = target.class_section_id`,
    [context.runId, context.sourceContactId, context.targetContactId],
  );
  await client.query('update contact_course_records set contact_id = $1, updated_at = now() where contact_id = $2', [context.targetContactId, context.sourceContactId]);
  await client.query(
    `update follow_up_sequence_enrollments source set status = 'merged_duplicate', stopped_at = coalesce(source.stopped_at, now()),
       stop_reason = coalesce(source.stop_reason, 'Duplicate Contact merged'),
       metadata_json = coalesce(source.metadata_json, '{}'::jsonb) || jsonb_build_object('contactMergeRunId', $1::text), updated_at = now()
      from follow_up_sequence_enrollments target where source.contact_id = $2 and target.contact_id = $3
       and source.status = 'active' and target.status = 'active' and source.sequence_id = target.sequence_id`,
    [context.runId, context.sourceContactId, context.targetContactId],
  );
  await client.query('update follow_up_sequence_enrollments set contact_id = $1, updated_at = now() where contact_id = $2', [context.targetContactId, context.sourceContactId]);
  await client.query(
    `update sms_campaign_recipients source set contact_id = null,
       metadata_json = coalesce(source.metadata_json, '{}'::jsonb) || jsonb_build_object(
         'contactMergeRunId', $1::text, 'mergedIntoContactId', $3::text, 'duplicateRecipientPreserved', true), updated_at = now()
      from sms_campaign_recipients target where source.contact_id = $2 and target.contact_id = $3
       and source.campaign_id = target.campaign_id`,
    [context.runId, context.sourceContactId, context.targetContactId],
  );
  await client.query('update sms_campaign_recipients set contact_id = $1, updated_at = now() where contact_id = $2', [context.targetContactId, context.sourceContactId]);
}

export async function applyContactMerge(client, input) {
  const { organizationId, sourceContactId, targetContactId, idempotencyKey, approvalReference,
    actorUserId = null, manageTransaction = true } = input;
  if (!idempotencyKey || !approvalReference) throw new Error('Contact merge requires idempotency and approval references.');
  if (manageTransaction) await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`contact-merge:${organizationId}`]);
    const replay = await client.query(
      'select status, result_json from contact_merge_runs where organization_id = $1 and idempotency_key = $2',
      [organizationId, idempotencyKey],
    );
    if (replay.rows.length) {
      if (manageTransaction) await client.query('commit');
      return { replay: true, status: replay.rows[0].status, result: replay.rows[0].result_json };
    }
    const locked = await client.query(
      'select id from contacts where organization_id = $1 and id = any($2::uuid[]) order by id for update',
      [organizationId, [sourceContactId, targetContactId]],
    );
    if (locked.rows.length !== 2) throw new Error('Both merge Contacts must exist in the same organization.');
    const inspection = await inspectContactMerge(client, { organizationId, sourceContactId, targetContactId });
    if (!inspection.approvalEligible) throw new Error('Duplicate Contact is already archived.');
    const runId = crypto.randomUUID();
    await client.query(
      `insert into contact_merge_runs
        (id, organization_id, source_contact_id, target_contact_id, idempotency_key, approval_reference,
         relationship_inventory_json, actor_user_id) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [runId, organizationId, sourceContactId, targetContactId, idempotencyKey, approvalReference, JSON.stringify(inspection.inventory), actorUserId],
    );
    const context = { organizationId, sourceContactId, targetContactId, runId };
    await mergePhones(client, context);
    await mergeConsents(client, context);
    await preserveCollisions(client, context);
    for (const table of SIMPLE_REPARENT_TABLES) {
      await client.query(`update "${table}" set contact_id = $1 where contact_id = $2`, [targetContactId, sourceContactId]);
    }
    await client.query(
      `update contacts target set primary_business_unit_id = coalesce(target.primary_business_unit_id, source.primary_business_unit_id),
         company_name = coalesce(target.company_name, source.company_name), phone = coalesce(nullif(target.phone, ''), source.phone),
         email = coalesce(nullif(target.email, ''), source.email), address = coalesce(nullif(target.address, ''), source.address),
         source_label = coalesce(target.source_label, source.source_label),
         is_do_not_call = target.is_do_not_call or source.is_do_not_call,
         is_wrong_number = target.is_wrong_number or source.is_wrong_number, updated_at = now()
        from contacts source where target.id = $1 and source.id = $2 and target.organization_id = $3`,
      [targetContactId, sourceContactId, organizationId],
    );
    await client.query(
      `update contacts set archived_at = now(), archived_by_user_id = $1,
         archive_reason = $2, updated_at = now() where id = $3 and organization_id = $4`,
      [actorUserId, `Merged into Contact ${targetContactId}; audit run ${runId}`, sourceContactId, organizationId],
    );
    const remaining = await inspectContactMerge(client, { organizationId, sourceContactId, targetContactId });
    const leftovers = Object.entries(remaining.inventory).filter(([, count]) => count !== 0);
    if (leftovers.length) throw new Error(`Contact merge left relationships behind: ${JSON.stringify(leftovers)}`);
    const result = { sourceContactId, targetContactId, inventoryBefore: inspection.inventory, inventoryAfter: remaining.inventory };
    await client.query(
      `update contact_merge_runs set status = 'completed', result_json = $1::jsonb,
         completed_at = now(), updated_at = now() where id = $2`,
      [JSON.stringify(result), runId],
    );
    if (manageTransaction) await client.query('commit');
    return { replay: false, status: 'completed', runId, result };
  } catch (error) {
    if (manageTransaction) await client.query('rollback').catch(() => {});
    throw error;
  }
}
