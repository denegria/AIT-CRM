import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { allTables } from '../src/db/schema.js';
import { upsertContactPhoneHistory } from '../src/lib/crm/contact-phone-history.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. This verifier always rolls back.');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  await client.query(fs.readFileSync(new URL('../drizzle/0022_contact_phone_history.sql', import.meta.url), 'utf8'));
  const db = drizzle(client, { schema: allTables });
  const suffix = crypto.randomUUID();
  const organization = await client.query(
    'insert into organizations (name, slug) values ($1, $2) returning id',
    [`MIS-319 rollback verification ${suffix}`, `mis-319-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const unit = await client.query(
    'insert into business_units (organization_id, name, label) values ($1, $2, $3) returning id',
    [organizationId, 'AIT USA', 'Division'],
  );
  const businessUnitId = unit.rows[0].id;
  const firstContact = await client.query(
    'insert into contacts (organization_id, primary_business_unit_id, name, phone) values ($1, $2, $3, $4) returning id',
    [organizationId, businessUnitId, 'First Student', '(908) 555-0100'],
  );
  const secondContact = await client.query(
    'insert into contacts (organization_id, primary_business_unit_id, name, phone) values ($1, $2, $3, $4) returning id',
    [organizationId, businessUnitId, 'Second Student', '(908) 555-0100'],
  );
  const sharedPayload = {
    phone: '(908) 555-0100',
    sourceType: 'verification',
    sourceReference: 'MIS-319',
    observedAt: '2026-07-16T12:00:00Z',
  };

  const firstInsert = await upsertContactPhoneHistory({
    tx: db,
    organizationId,
    businessUnitId,
    contactId: firstContact.rows[0].id,
    payload: sharedPayload,
  });
  const replay = await upsertContactPhoneHistory({
    tx: db,
    organizationId,
    businessUnitId,
    contactId: firstContact.rows[0].id,
    payload: sharedPayload,
  });
  await upsertContactPhoneHistory({
    tx: db,
    organizationId,
    businessUnitId,
    contactId: secondContact.rows[0].id,
    payload: sharedPayload,
  });
  await upsertContactPhoneHistory({
    tx: db,
    organizationId,
    businessUnitId,
    contactId: firstContact.rows[0].id,
    payload: { ...sharedPayload, isPrimary: true, effectiveAt: '2026-07-01T12:00:00Z' },
  });
  await upsertContactPhoneHistory({
    tx: db,
    organizationId,
    businessUnitId,
    contactId: firstContact.rows[0].id,
    payload: {
      phone: '(908) 555-0199',
      isPrimary: true,
      sourceType: 'verification',
      sourceReference: 'MIS-319:newer',
      observedAt: '2026-07-16T12:00:00Z',
      effectiveAt: '2026-07-15T12:00:00Z',
    },
  });

  const history = await client.query(
    `select contact_id, normalized_phone, is_primary, retired_at
       from contact_phone_numbers
      where organization_id = $1
      order by contact_id, normalized_phone`,
    [organizationId],
  );
  const firstRows = history.rows.filter((row) => row.contact_id === firstContact.rows[0].id);
  const secondRows = history.rows.filter((row) => row.contact_id === secondContact.rows[0].id);
  const currentContact = await client.query('select phone from contacts where id = $1', [firstContact.rows[0].id]);
  const auditCount = await client.query(
    `select count(*)::int as count
       from activity_events
      where organization_id = $1
        and contact_id = $2
        and event_type like 'contact.phone%'`,
    [organizationId, firstContact.rows[0].id],
  );

  assert.equal(firstInsert.action, 'insert');
  assert.equal(replay.action, 'unchanged');
  assert.equal(firstRows.length, 2);
  assert.equal(firstRows.filter((row) => row.is_primary).length, 1);
  assert.ok(firstRows.find((row) => row.normalized_phone === '+19085550100')?.retired_at);
  assert.equal(secondRows.length, 1, 'the same phone may belong to a separate Contact');
  assert.equal(currentContact.rows[0].phone, '(908) 555-0199');
  assert.equal(auditCount.rows[0].count, 3, 'the replay must not create an audit event');

  console.log(JSON.stringify({
    status: 'passed',
    firstContactHistoryRows: firstRows.length,
    secondContactHistoryRows: secondRows.length,
    firstContactPrimaryRows: firstRows.filter((row) => row.is_primary).length,
    auditEvents: auditCount.rows[0].count,
    transaction: 'rolled_back',
  }, null, 2));
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
