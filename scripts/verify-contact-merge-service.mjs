import assert from 'node:assert/strict';
import pg from 'pg';
import { applyContactMerge, inspectContactMerge } from '../src/lib/contact-merge/service.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. This verifier always rolls back.');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const suffix = crypto.randomUUID();
await client.connect();
try {
  await client.query('begin');
  const organization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-324 verification ${suffix}`, `mis-324-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const unit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT USA', 'Division'],
  );
  const businessUnitId = unit.rows[0].id;
  const contacts = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name, phone, is_do_not_call, is_wrong_number)
     values ($1, $2, 'Canonical Student', '+19085550100', false, false),
            ($1, $2, 'Duplicate Student', '+19085550101', true, true)
     returning id, name`,
    [organizationId, businessUnitId],
  );
  const targetContactId = contacts.rows.find((row) => row.name === 'Canonical Student').id;
  const sourceContactId = contacts.rows.find((row) => row.name === 'Duplicate Student').id;
  await client.query(
    `insert into contact_phone_numbers
      (organization_id, business_unit_id, contact_id, phone, normalized_phone, is_primary)
     values ($1, $2, $3, '+19085550100', '+19085550100', true),
            ($1, $2, $4, '+19085550100', '+19085550100', true),
            ($1, $2, $4, '+19085550101', '+19085550101', false)`,
    [organizationId, businessUnitId, targetContactId, sourceContactId],
  );
  await client.query(
    `insert into contact_channel_consents
      (organization_id, business_unit_id, contact_id, scope_key, channel, consent_status, opt_out_reason)
     values ($1, $2, $3, 'organization', 'sms', 'opted_in', null),
            ($1, $2, $4, 'organization', 'sms', 'opted_out', 'STOP')`,
    [organizationId, businessUnitId, targetContactId, sourceContactId],
  );
  await client.query(
    `insert into contact_people (organization_id, business_unit_id, contact_id, name)
     values ($1, $2, $3, 'Preserved Related Person')`,
    [organizationId, businessUnitId, sourceContactId],
  );
  const section = await client.query(
    `insert into course_class_sections
      (organization_id, business_unit_id, section_key, course_name, modality)
     values ($1, $2, $3, 'Computer', 'in_person') returning id`,
    [organizationId, businessUnitId, `mis-324-${suffix}`],
  );
  await client.query(
    `insert into contact_course_records
      (organization_id, business_unit_id, contact_id, class_section_id, course_name, status)
     values ($1, $2, $3, $5, 'Computer', 'active'), ($1, $2, $4, $5, 'Computer', 'active')`,
    [organizationId, businessUnitId, targetContactId, sourceContactId, section.rows[0].id],
  );
  const sequence = await client.query(
    `insert into follow_up_sequences (organization_id, business_unit_id, key, name)
     values ($1, $2, $3, 'Verifier') returning id`,
    [organizationId, businessUnitId, `mis-324-${suffix}`],
  );
  await client.query(
    `insert into follow_up_sequence_enrollments
      (organization_id, business_unit_id, sequence_id, contact_id, status, channel, next_step_due_at)
     values ($1, $2, $5, $3, 'active', 'sms', now()), ($1, $2, $5, $4, 'active', 'sms', now())`,
    [organizationId, businessUnitId, targetContactId, sourceContactId, sequence.rows[0].id],
  );
  const campaign = await client.query(
    `insert into sms_campaigns (organization_id, business_unit_id, name, message_body)
     values ($1, $2, 'Verifier', 'Verification only') returning id`,
    [organizationId, businessUnitId],
  );
  await client.query(
    `insert into sms_campaign_recipients
      (campaign_id, organization_id, business_unit_id, contact_id, phone, normalized_phone, eligibility_status)
     values ($5, $1, $2, $3, '+19085550100', '+19085550100', 'eligible'),
            ($5, $1, $2, $4, '+19085550101', '+19085550101', 'blocked')`,
    [organizationId, businessUnitId, targetContactId, sourceContactId, campaign.rows[0].id],
  );
  await client.query(
    `insert into tasks (organization_id, business_unit_id, contact_id, title, task_type)
     values ($1, $2, $3, 'Preserved task', 'follow_up')`,
    [organizationId, businessUnitId, sourceContactId],
  );

  const inspection = await inspectContactMerge(client, { organizationId, sourceContactId, targetContactId });
  assert.equal(inspection.approvalEligible, true);
  assert.equal(inspection.inventory['contact_course_records.contact_id'], 1);
  const first = await applyContactMerge(client, {
    organizationId,
    sourceContactId,
    targetContactId,
    idempotencyKey: `mis-324:${suffix}`,
    approvalReference: 'MIS-324 rollback verifier',
    manageTransaction: false,
  });
  assert.equal(first.replay, false);
  const replay = await applyContactMerge(client, {
    organizationId,
    sourceContactId,
    targetContactId,
    idempotencyKey: `mis-324:${suffix}`,
    approvalReference: 'MIS-324 rollback verifier',
    manageTransaction: false,
  });
  assert.equal(replay.replay, true);
  const result = await client.query(
    `select
       (select archived_at is not null from contacts where id = $2) as source_archived,
       (select is_do_not_call and is_wrong_number from contacts where id = $1) as safety_flags_preserved,
       (select count(*)::int from contact_phone_numbers where contact_id = $1) as target_phones,
       (select consent_status from contact_channel_consents where contact_id = $1 and channel = 'sms') as consent,
       (select count(*)::int from contact_people where contact_id = $1) as people,
       (select count(*)::int from contact_course_records where contact_id = $1) as courses,
       (select count(*)::int from contact_course_records where contact_id = $1 and status = 'merged_duplicate') as course_collisions,
       (select count(*)::int from follow_up_sequence_enrollments where contact_id = $1) as enrollments,
       (select count(*)::int from sms_campaign_recipients where campaign_id = $3 and contact_id is null) as preserved_recipients,
       (select count(*)::int from tasks where contact_id = $1) as tasks`,
    [targetContactId, sourceContactId, campaign.rows[0].id],
  );
  assert.deepEqual(result.rows[0], {
    source_archived: true,
    safety_flags_preserved: true,
    target_phones: 2,
    consent: 'opted_out',
    people: 1,
    courses: 2,
    course_collisions: 1,
    enrollments: 2,
    preserved_recipients: 1,
    tasks: 1,
  });
  console.log(JSON.stringify({ status: 'passed', replay: 'no-op', ...result.rows[0], transaction: 'rolled_back' }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
