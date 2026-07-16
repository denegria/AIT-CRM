import { deterministicImportUuid } from './manifest.js';
import { applyContactMerge } from '../contact-merge/service.js';

function cleanText(value = '') {
  return String(value || '').trim();
}

function phoneDigits(value = '') {
  const digits = cleanText(value).replace(/\D+/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function phoneForStorage(value = '') {
  const digits = phoneDigits(value);
  return digits.length === 10 ? `+1${digits}` : (digits ? `+${digits}` : '');
}

export async function resolveRosterImportScope(client, businessUnitName) {
  const result = await client.query(
    `select bu.id as business_unit_id, bu.organization_id, bu.name
       from business_units bu
      where lower(bu.name) = lower($1) or lower(coalesce(bu.label, '')) = lower($1)
      order by case when lower(bu.name) = lower($1) then 0 else 1 end
      limit 2`,
    [businessUnitName],
  );
  if (result.rows.length !== 1) throw new Error(`Expected one business unit named ${businessUnitName}; found ${result.rows.length}.`);
  return {
    organizationId: result.rows[0].organization_id,
    businessUnitId: result.rows[0].business_unit_id,
    businessUnitName: result.rows[0].name,
  };
}

export async function loadRosterImportSnapshot(client, scope) {
  const contacts = await client.query(
      `select id, name, phone, archived_at
         from contacts
        where organization_id = $1`,
      [scope.organizationId],
    );
  const leads = await client.query(
      `select distinct on (contact_id) contact_id, status
         from leads
        where organization_id = $1 and business_unit_id = $2 and contact_id is not null
        order by contact_id, updated_at desc, created_at desc`,
      [scope.organizationId, scope.businessUnitId],
    );
  const sections = await client.query(
      `select id, section_key, course_name, teacher, course_location, modality,
              schedule_days_json, start_time, end_time, scheduled_days_per_week, status
         from course_class_sections
        where organization_id = $1 and business_unit_id = $2`,
      [scope.organizationId, scope.businessUnitId],
    );
  const courses = await client.query(
      `select id, contact_id, class_section_id, course_name, status,
              start_date::text, end_date::text, metadata_json
         from contact_course_records
        where organization_id = $1 and business_unit_id = $2`,
      [scope.organizationId, scope.businessUnitId],
    );
  const actions = await client.query(
      `select idempotency_key
         from roster_import_actions
        where organization_id = $1 and status = 'applied'`,
      [scope.organizationId],
    );
  const runs = await client.query(
      `select manifest_sha256
         from roster_import_runs
        where organization_id = $1 and status = 'completed'`,
      [scope.organizationId],
    );
  return {
    contacts: contacts.rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, archivedAt: row.archived_at })),
    latestLeadStatusByContact: Object.fromEntries(leads.rows.map((row) => [row.contact_id, row.status])),
    classSections: sections.rows.map((row) => ({
      id: row.id,
      sectionKey: row.section_key,
      courseName: row.course_name,
      teacher: row.teacher,
      courseLocation: row.course_location,
      modality: row.modality,
      scheduleDays: row.schedule_days_json,
      startTime: row.start_time,
      endTime: row.end_time,
      scheduledDaysPerWeek: row.scheduled_days_per_week,
      status: row.status,
    })),
    courseRecords: courses.rows.map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      classSectionId: row.class_section_id,
      courseName: row.course_name,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      metadataJson: row.metadata_json || {},
    })),
    appliedActionKeys: actions.rows.map((row) => row.idempotency_key),
    completedManifestShas: runs.rows.map((row) => row.manifest_sha256),
  };
}

function parseList(value = '') {
  return cleanText(value).split(/[,;/|]+/).map((item) => item.trim()).filter(Boolean);
}

function parseTimeRange(value = '') {
  const matches = cleanText(value).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!matches) return { startTime: null, endTime: null };
  const convert = (hourText, minuteText, meridiem) => {
    let hour = Number(hourText);
    const suffix = cleanText(meridiem).toUpperCase();
    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(Number(minuteText || 0)).padStart(2, '0')}`;
  };
  return {
    startTime: convert(matches[1], matches[2], matches[3] || matches[6]),
    endTime: convert(matches[4], matches[5], matches[6] || matches[3]),
  };
}

async function applySection(client, scope, action) {
  const section = action.section;
  const times = parseTimeRange(section.classTime);
  const result = await client.query(
    `insert into course_class_sections
      (id, organization_id, business_unit_id, section_key, course_name, teacher, course_location,
       modality, schedule_days_json, start_time, end_time, scheduled_days_per_week, status,
       source_type, source_reference, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, 'active', $13, $14, $15::jsonb)
     on conflict (organization_id, business_unit_id, section_key) do update set
       course_name = excluded.course_name,
       teacher = excluded.teacher,
       course_location = excluded.course_location,
       modality = excluded.modality,
       schedule_days_json = excluded.schedule_days_json,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       scheduled_days_per_week = excluded.scheduled_days_per_week,
       source_type = excluded.source_type,
       source_reference = excluded.source_reference,
       metadata_json = excluded.metadata_json,
       updated_at = now()
     returning id`,
    [
      action.targetSectionId,
      scope.organizationId,
      scope.businessUnitId,
      section.sectionKey,
      section.courseName,
      section.teacher || null,
      section.courseLocation || null,
      cleanText(section.modality).toLowerCase().startsWith('pres') ? 'in_person' : cleanText(section.modality).toLowerCase().replace(/\s+/g, '_'),
      JSON.stringify(parseList(section.classDays)),
      times.startTime,
      times.endTime,
      Number(section.scheduledDaysPerWeek) || null,
      section.sourceType || 'student_roster',
      section.sourceReference || null,
      JSON.stringify({ importIdempotencyKey: action.idempotencyKey, sourceSectionKey: section.sourceSectionKey || section.sectionKey }),
    ],
  );
  return result.rows[0].id;
}

async function ensureContact(client, scope, action) {
  if (action.operation === 'create_contact') {
    await client.query(
      `insert into contacts (id, organization_id, primary_business_unit_id, name, phone, source_label)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [action.targetContactId, scope.organizationId, scope.businessUnitId, action.identity.name, action.identity.phone, 'MIS-318 roster import'],
    );
  }
  const current = await client.query(
    'select phone, is_do_not_call, is_wrong_number from contacts where id = $1 and organization_id = $2 for update',
    [action.targetContactId, scope.organizationId],
  );
  if (current.rows.length !== 1) throw new Error(`Contact ${action.targetContactId} is unavailable during apply.`);
  const existingPhone = cleanText(current.rows[0].phone);
  const phones = [...new Set([existingPhone, ...action.historicalPhones, action.identity.phone].filter(Boolean))];
  for (const phone of phones) {
    const normalized = phoneForStorage(phone);
    if (!normalized) continue;
    const isPrimary = phoneDigits(phone) === phoneDigits(action.identity.phone);
    if (isPrimary) {
      await client.query(
        `update contact_phone_numbers set is_primary = false, retired_at = coalesce(retired_at, now()), updated_at = now()
          where organization_id = $1 and contact_id = $2 and normalized_phone <> $3 and is_primary = true`,
        [scope.organizationId, action.targetContactId, normalized],
      );
    }
    await client.query(
      `insert into contact_phone_numbers
        (organization_id, business_unit_id, contact_id, phone, normalized_phone, is_primary,
         is_do_not_call, is_wrong_number, source_type, source_reference, observed_at, metadata_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'roster_manifest', $9, now(), $10::jsonb)
       on conflict (organization_id, contact_id, normalized_phone) do update set
         phone = excluded.phone,
         is_primary = excluded.is_primary,
         source_type = excluded.source_type,
         source_reference = excluded.source_reference,
         updated_at = now()`,
      [
        scope.organizationId,
        scope.businessUnitId,
        action.targetContactId,
        phone,
        normalized,
        isPrimary,
        current.rows[0].is_do_not_call,
        current.rows[0].is_wrong_number,
        action.idempotencyKey,
        JSON.stringify({ importIdempotencyKey: action.idempotencyKey }),
      ],
    );
  }
  if (phoneDigits(existingPhone) !== action.identity.normalizedPhone) {
    await client.query('update contacts set phone = $1, updated_at = now() where id = $2 and organization_id = $3', [action.identity.phone, action.targetContactId, scope.organizationId]);
  }
}

async function applyLifecycle(client, scope, action) {
  if (!action.lifecycle || action.lifecycle.operation === 'preserve') return null;
  const desiredStatus = action.lifecycle.operation === 'set_enrolled' ? 'Enrolled' : 'Dropped / Quit';
  const existing = await client.query(
    `select id, status from leads
      where organization_id = $1 and business_unit_id = $2 and contact_id = $3
      order by updated_at desc, created_at desc limit 1 for update`,
    [scope.organizationId, scope.businessUnitId, action.targetContactId],
  );
  let leadId;
  if (!existing.rows.length) {
    leadId = deterministicImportUuid(`${action.idempotencyKey}:lead`);
    await client.query(
      `insert into leads (id, organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, source_detail)
       values ($1, $2, $3, $4, 'historical_import', 'MIS-318 roster manifest', $5, $5, $6)`,
      [leadId, scope.organizationId, scope.businessUnitId, action.targetContactId, desiredStatus, action.idempotencyKey],
    );
  } else {
    leadId = existing.rows[0].id;
    if (existing.rows[0].status === desiredStatus) return leadId;
    await client.query('update leads set status = $1, current_stage = $1, updated_at = now() where id = $2', [desiredStatus, leadId]);
    await client.query(
      `insert into lead_status_history
        (organization_id, business_unit_id, contact_id, lead_id, from_status, to_status, reason, metadata_json)
       values ($1, $2, $3, $4, $5, $6, 'Approved roster manifest import', $7::jsonb)`,
      [scope.organizationId, scope.businessUnitId, action.targetContactId, leadId, existing.rows[0].status, desiredStatus, JSON.stringify({ importIdempotencyKey: action.idempotencyKey })],
    );
  }
  return leadId;
}

async function applyCourse(client, scope, action) {
  const row = action.course;
  const lead = await client.query(
    `select id from leads where organization_id = $1 and business_unit_id = $2 and contact_id = $3
      order by updated_at desc, created_at desc limit 1`,
    [scope.organizationId, scope.businessUnitId, action.targetContactId],
  );
  await client.query(
    `insert into contact_course_records
      (id, organization_id, business_unit_id, contact_id, lead_id, class_section_id, course_name,
       course_location, teacher, status, start_date, end_date, outcome_reason, notes, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, nullif($11, '')::date,
             nullif($12, '')::date, $13, $14, $15::jsonb)
     on conflict (id) do nothing`,
    [
      action.targetCourseRecordId,
      scope.organizationId,
      scope.businessUnitId,
      action.targetContactId,
      lead.rows[0]?.id || null,
      action.targetSectionId,
      row.mapped_course,
      row.course_location || row.location || null,
      row.teacher || null,
      row.course_status,
      cleanText(row.start_date),
      cleanText(row.end_date),
      row.outcome_reason || null,
      row.notes || null,
      JSON.stringify({
        importIdempotencyKey: action.idempotencyKey,
        manifestSource: { sheet: row.source_sheet || '', cell: row.source_cell || '' },
      }),
    ],
  );
  return action.targetCourseRecordId;
}

async function recordAction(client, scope, runId, action, status, targetId = null, errorText = null) {
  await client.query(
    `insert into roster_import_actions
      (organization_id, business_unit_id, run_id, idempotency_key, entity_type, operation, status,
       target_id, source_reference, before_json, after_json, error_text)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10::jsonb, $11)
     on conflict (organization_id, idempotency_key) do nothing`,
    [scope.organizationId, scope.businessUnitId, runId, action.idempotencyKey, action.entity, action.operation, status, targetId, action.reason || null, JSON.stringify(action), errorText],
  );
}

export async function applyRosterImportPlan(client, {
  scope,
  manifest,
  approval,
  plan,
  actorUserId = null,
  manageTransaction = true,
}) {
  if (!plan.approvalEligible) throw new Error('Roster import plan has blockers and cannot be applied.');
  if (manageTransaction) await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`roster-import:${scope.organizationId}`]);
    const runId = deterministicImportUuid(`${manifest.contentSha256}:run`);
    const inserted = await client.query(
      `insert into roster_import_runs
        (id, organization_id, business_unit_id, manifest_id, manifest_sha256, lane,
         approval_reference, approved_at, status, expected_counts_json, created_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'applying', $9::jsonb, $10)
       on conflict (organization_id, manifest_sha256) do nothing returning id`,
      [runId, scope.organizationId, scope.businessUnitId, manifest.manifestId, manifest.contentSha256, manifest.lane, approval.approvalRef, approval.approvedAt, JSON.stringify(manifest.expectedCounts), actorUserId],
    );
    if (!inserted.rows.length) {
      const existing = await client.query('select status, report_json from roster_import_runs where organization_id = $1 and manifest_sha256 = $2', [scope.organizationId, manifest.contentSha256]);
      if (manageTransaction) await client.query('rollback');
      return { replay: true, status: existing.rows[0]?.status || 'unknown', report: existing.rows[0]?.report_json || {} };
    }

    for (const action of plan.classSectionActions.filter((item) => item.state === 'ready')) {
      const targetId = await applySection(client, scope, action);
      await recordAction(client, scope, runId, action, 'applied', targetId);
    }
    for (const action of plan.contactActions) {
      if (action.state === 'ready') {
        for (const duplicateContactId of action.duplicateContactIds || []) {
          await applyContactMerge(client, {
            organizationId: scope.organizationId,
            sourceContactId: duplicateContactId,
            targetContactId: action.targetContactId,
            idempotencyKey: `${action.idempotencyKey}:merge:${duplicateContactId}`,
            approvalReference: approval.approvalRef,
            actorUserId,
            manageTransaction: false,
          });
        }
        await ensureContact(client, scope, action);
        await applyLifecycle(client, scope, action);
        await recordAction(client, scope, runId, action, 'applied', action.targetContactId);
      } else if (action.state === 'held') {
        await recordAction(client, scope, runId, action, 'skipped');
      }
    }
    for (const action of plan.courseActions) {
      if (action.state === 'ready') {
        const targetId = await applyCourse(client, scope, action);
        await recordAction(client, scope, runId, action, 'applied', targetId);
      } else if (action.state === 'held') {
        await recordAction(client, scope, runId, action, 'skipped');
      }
    }
    const counts = await client.query(
      `select status, count(*)::int as count from roster_import_actions where run_id = $1 group by status`,
      [runId],
    );
    const resultCounts = Object.fromEntries(counts.rows.map((row) => [row.status, row.count]));
    const report = { ...plan, dryRun: false, approvalReference: approval.approvalRef, resultCounts };
    await client.query(
      `update roster_import_runs set status = 'completed', result_counts_json = $1::jsonb,
              report_json = $2::jsonb, completed_at = now(), updated_at = now() where id = $3`,
      [JSON.stringify(resultCounts), JSON.stringify(report), runId],
    );
    if (manageTransaction) await client.query('commit');
    return { replay: false, status: 'completed', runId, report };
  } catch (error) {
    if (manageTransaction) await client.query('rollback').catch(() => {});
    throw error;
  }
}
