import fs from 'node:fs/promises';
import pg from 'pg';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key || '<end>'}`);
    args[key.slice(2)] = value;
  }
  return args;
}

function digits(value) {
  const raw = String(value || '').replace(/\D/g, '');
  return raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
}

function usablePhone(value) {
  const valueDigits = digits(value);
  return valueDigits.length >= 10 && valueDigits.length <= 13;
}

function countBy(items, key) {
  return Object.fromEntries([...items.reduce((map, item) => {
    const value = item[key] ?? '';
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

const args = parseArgs(process.argv.slice(2));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
for (const required of ['apply-report', 'replay-report', 'source-snapshot', 'output']) {
  if (!args[required]) throw new Error(`--${required} is required.`);
}

const [applyEnvelope, replayEnvelope, snapshot] = await Promise.all([
  fs.readFile(args['apply-report'], 'utf8').then(JSON.parse),
  fs.readFile(args['replay-report'], 'utf8').then(JSON.parse),
  fs.readFile(args['source-snapshot'], 'utf8').then(JSON.parse),
]);
const apply = applyEnvelope.result;
const replay = replayEnvelope.result;
const plan = apply.report;
const target = applyEnvelope.target;
const readyContacts = plan.contactActions.filter((action) => action.state === 'ready');
const heldContacts = plan.contactActions.filter((action) => action.state === 'held');
const readyCourses = plan.courseActions.filter((action) => action.state === 'ready');
const heldCourses = plan.courseActions.filter((action) => action.state === 'held');
const sourceContacts = new Map(snapshot.contacts.map((contact) => [contact.id, contact]));
const sourceLeads = new Map(snapshot.leads.map((lead) => [lead.id, lead]));
const failures = [];

assert(apply.status === 'completed' && apply.replay === false, 'Initial apply was not a completed non-replay.', failures);
assert(replay.status === 'completed' && replay.replay === true, 'Second apply was not a completed replay.', failures);
assert(replay.report?.resultCounts?.applied === 1008 && replay.report?.resultCounts?.skipped === 195,
  'Replay report does not retain the expected 1008 applied / 195 skipped result.', failures);
assert(readyContacts.length === 573 && heldContacts.length === 11, 'Unexpected ready/held Contact counts.', failures);
assert(readyCourses.length === 435 && heldCourses.length === 184, 'Unexpected ready/held course counts.', failures);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin read only');
  const runResult = await client.query(
    `select id, status, result_counts_json from roster_import_runs
      where organization_id = $1 and manifest_sha256 = $2`,
    [target.organizationId, plan.manifestSha256],
  );
  assert(runResult.rows.length === 1, 'Expected exactly one roster import run.', failures);
  const run = runResult.rows[0];
  assert(run?.status === 'completed', 'Roster import run is not completed.', failures);
  assert(Number(run?.result_counts_json?.applied) === 1008 && Number(run?.result_counts_json?.skipped) === 195,
    'Persisted run counts do not equal 1008 applied / 195 skipped.', failures);

  const actionRows = run ? (await client.query(
    `select entity_type, operation, status, count(*)::int as count
       from roster_import_actions where run_id = $1
      group by entity_type, operation, status order by entity_type, operation, status`,
    [run.id],
  )).rows : [];
  const appliedActionCount = actionRows.filter((row) => row.status === 'applied').reduce((sum, row) => sum + row.count, 0);
  const skippedActionCount = actionRows.filter((row) => row.status === 'skipped').reduce((sum, row) => sum + row.count, 0);
  assert(appliedActionCount === 1008 && skippedActionCount === 195, 'Persisted action ledger counts are incorrect.', failures);

  const targetIds = readyContacts.map((action) => action.targetContactId);
  const contacts = (await client.query(
    `select id, name, phone, address, source_label, archived_at
       from contacts where organization_id = $1 and id = any($2::uuid[])`,
    [target.organizationId, targetIds],
  )).rows;
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const uniqueTargetCount = new Set(targetIds).size;
  assert(uniqueTargetCount === 570 && contacts.length === uniqueTargetCount,
    `Expected 570 unique target Contacts from 573 actions, found ${contacts.length}.`, failures);

  const phoneRows = (await client.query(
    `select contact_id, normalized_phone, is_primary, retired_at
       from contact_phone_numbers where organization_id = $1 and contact_id = any($2::uuid[])`,
    [target.organizationId, targetIds],
  )).rows;
  const phonesByContact = Map.groupBy(phoneRows, (row) => row.contact_id);
  const priorPrimaryReplacements = new Set();
  for (const action of readyContacts) {
    const actual = contactById.get(action.targetContactId);
    assert(Boolean(actual), `Missing target Contact ${action.targetContactId}.`, failures);
    if (!actual) continue;
    assert(digits(actual.phone) === action.identity.normalizedPhone,
      `Contact ${action.targetContactId} does not use the inactive workbook phone as scalar primary.`, failures);
    assert(actual.address === action.location.desiredLocation,
      `Contact ${action.targetContactId} location is ${actual.address || '<blank>'}, expected ${action.location.desiredLocation}.`, failures);
    const rows = phonesByContact.get(action.targetContactId) || [];
    const primaryRows = rows.filter((row) => row.is_primary);
    assert(primaryRows.length === 1 && primaryRows[0].normalized_phone === action.identity.normalizedPhone,
      `Contact ${action.targetContactId} does not have exactly one authoritative workbook primary phone row.`, failures);
    const requiredHistory = new Set((action.historicalPhones || []).map(digits).filter((phone) => usablePhone(phone)));
    const priorTarget = sourceContacts.get(action.targetContactId);
    if (usablePhone(priorTarget?.phone) && digits(priorTarget.phone) !== action.identity.normalizedPhone) {
      requiredHistory.add(digits(priorTarget.phone));
      priorPrimaryReplacements.add(action.targetContactId);
    }
    for (const duplicateId of action.duplicateContactIds || []) {
      const priorDuplicate = sourceContacts.get(duplicateId);
      if (usablePhone(priorDuplicate?.phone) && digits(priorDuplicate.phone) !== action.identity.normalizedPhone) {
        requiredHistory.add(digits(priorDuplicate.phone));
      }
    }
    const actualPhones = new Set(rows.map((row) => digits(row.normalized_phone)));
    for (const historicalPhone of requiredHistory) {
      assert(actualPhones.has(historicalPhone),
        `Contact ${action.targetContactId} is missing historical phone ${historicalPhone}.`, failures);
    }
  }
  assert(priorPrimaryReplacements.size === 10,
    `Expected 10 existing scalar-primary replacements, found ${priorPrimaryReplacements.size}.`, failures);
  assert(phoneRows.every((row) => usablePhone(row.normalized_phone)), 'Phone history contains an unusable normalized phone.', failures);

  const createActions = readyContacts.filter((action) => action.operation === 'create_contact');
  for (const action of createActions) {
    assert(contactById.get(action.targetContactId)?.source_label === 'MIS-318 roster import',
      `Created Contact ${action.targetContactId} is missing the MIS-318 source label.`, failures);
  }

  const duplicateIds = readyContacts.flatMap((action) => action.duplicateContactIds || []);
  const duplicateRows = duplicateIds.length ? (await client.query(
    `select id, source_label, archived_at, archive_reason from contacts
      where organization_id = $1 and id = any($2::uuid[])`,
    [target.organizationId, duplicateIds],
  )).rows : [];
  const duplicateById = new Map(duplicateRows.map((contact) => [contact.id, contact]));
  assert(duplicateRows.length === duplicateIds.length, 'Not all duplicate source Contacts remain available for audit.', failures);
  for (const action of readyContacts.filter((item) => item.duplicateContactIds?.length)) {
    let expectedCanonicalSource = sourceContacts.get(action.targetContactId)?.source_label || null;
    for (const duplicateId of action.duplicateContactIds) {
      const before = sourceContacts.get(duplicateId);
      const after = duplicateById.get(duplicateId);
      assert(Boolean(after?.archived_at), `Merged source Contact ${duplicateId} is not archived.`, failures);
      assert(after?.source_label === before?.source_label,
        `Merged source Contact ${duplicateId} did not preserve its source label.`, failures);
      expectedCanonicalSource ||= before?.source_label || null;
    }
    assert(contactById.get(action.targetContactId)?.source_label === expectedCanonicalSource,
      `Canonical Contact ${action.targetContactId} source provenance is incorrect.`, failures);
  }

  const mergeRuns = (await client.query(
    `select source_contact_id, target_contact_id, status, result_json
       from contact_merge_runs where organization_id = $1 and approval_reference = $2`,
    [target.organizationId, plan.approvalReference],
  )).rows;
  assert(mergeRuns.length === duplicateIds.length && mergeRuns.every((run) => run.status === 'completed'),
    `Expected ${duplicateIds.length} completed merge runs, found ${mergeRuns.length}.`, failures);
  for (const run of mergeRuns) {
    const leftovers = Object.values(run.result_json?.inventoryAfter || {}).filter((count) => Number(count) !== 0);
    assert(leftovers.length === 0, `Merge ${run.source_contact_id} left Contact relationships behind.`, failures);
  }

  const protectedActions = readyContacts.filter((action) => action.lifecycle.operation === 'preserve');
  const protectedLeadIds = snapshot.leads
    .filter((lead) => protectedActions.some((action) => action.targetContactId === lead.contact_id))
    .map((lead) => lead.id);
  const protectedLeadRows = protectedLeadIds.length ? (await client.query(
    `select id, status, current_stage, source_type, source_name from leads where id = any($1::uuid[])`,
    [protectedLeadIds],
  )).rows : [];
  const protectedLeadById = new Map(protectedLeadRows.map((lead) => [lead.id, lead]));
  for (const leadId of protectedLeadIds) {
    const before = sourceLeads.get(leadId);
    const after = protectedLeadById.get(leadId);
    assert(after?.status === before?.status && after?.current_stage === before?.current_stage,
      `Protected lead ${leadId} lifecycle changed.`, failures);
    assert(after?.source_type === before?.source_type && after?.source_name === before?.source_name,
      `Protected lead ${leadId} source provenance changed.`, failures);
  }

  const droppedIds = readyContacts.filter((action) => action.lifecycle.operation === 'set_dropped_quit')
    .map((action) => action.targetContactId);
  const latestDropped = droppedIds.length ? (await client.query(
    `select c.id as contact_id, latest.status
       from unnest($1::uuid[]) c(id)
       left join lateral (
         select status from leads where organization_id = $2 and business_unit_id = $3 and contact_id = c.id
          order by updated_at desc, created_at desc limit 1
       ) latest on true`,
    [droppedIds, target.organizationId, target.businessUnitId],
  )).rows : [];
  assert(latestDropped.length === 495 && latestDropped.every((row) => row.status === 'Dropped / Quit'),
    'Not all 495 non-protected Contacts have Dropped / Quit as their latest lifecycle.', failures);

  const courseIds = readyCourses.map((action) => action.targetCourseRecordId);
  const courseRows = (await client.query(
    `select id, contact_id, class_section_id, course_name, course_location, status,
            start_date::text, end_date::text, metadata_json
       from contact_course_records where organization_id = $1 and id = any($2::uuid[])`,
    [target.organizationId, courseIds],
  )).rows;
  const courseById = new Map(courseRows.map((row) => [row.id, row]));
  assert(courseRows.length === 435, `Expected 435 course records, found ${courseRows.length}.`, failures);
  assert(courseRows.every((row) => row.status === 'dropped' && row.class_section_id === null),
    'A course record is not Dropped / Quit history with a null class section.', failures);
  assert(JSON.stringify(countBy(courseRows, 'course_location')) === JSON.stringify({ 'Bound Brook': 430, Plainfield: 5 }),
    `Unexpected course-location counts: ${JSON.stringify(countBy(courseRows, 'course_location'))}.`, failures);
  let rawDateLineageCount = 0;
  for (const action of readyCourses) {
    const actual = courseById.get(action.targetCourseRecordId);
    if (!actual) continue;
    const source = actual.metadata_json?.manifestSource || {};
    assert(source.sheet === (action.course.source_sheet || '') && source.cell === (action.course.source_cell || ''),
      `Course ${action.targetCourseRecordId} lost workbook sheet/cell lineage.`, failures);
    assert(source.rawStartDate === (action.course.raw_start_date || '') && source.rawEndDate === (action.course.raw_end_date || ''),
      `Course ${action.targetCourseRecordId} lost raw date lineage.`, failures);
    if ((action.course.raw_start_date && !action.course.start_date) || (action.course.raw_end_date && !action.course.end_date)) {
      rawDateLineageCount += 1;
      assert(actual.start_date === (action.course.start_date || null) && actual.end_date === (action.course.end_date || null),
        `Course ${action.targetCourseRecordId} stored ambiguous raw text as a structured date.`, failures);
    }
  }
  assert(rawDateLineageCount === 56, `Expected 56 actionable raw-date lineage records, found ${rawDateLineageCount}.`, failures);

  await client.query('rollback');
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_verification',
    target: { host: new URL(process.env.DATABASE_URL).hostname, database: target.database, schema: target.schema },
    manifest: { id: plan.manifestId, sha256: plan.manifestSha256 },
    counts: {
      contacts: { ready: readyContacts.length, held: heldContacts.length, operations: countBy(readyContacts, 'operation') },
      primaryPhones: { workbookAuthoritativeActions: readyContacts.length, uniqueContacts: uniqueTargetCount, replacedExistingScalar: priorPrimaryReplacements.size },
      courses: { ready: readyCourses.length, held: heldCourses.length, locations: countBy(courseRows, 'course_location'), rawDateLineage: rawDateLineageCount },
      lifecycle: { preservedContacts: protectedActions.length, droppedQuitContacts: droppedIds.length },
      merges: mergeRuns.length,
      ledger: { applied: appliedActionCount, skipped: skippedActionCount },
    },
    replay: { replay: replay.replay, status: replay.status, dataChanged: false },
    checksPassed: failures.length === 0,
    failures,
  };
  await fs.writeFile(args.output, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await client.end();
}
