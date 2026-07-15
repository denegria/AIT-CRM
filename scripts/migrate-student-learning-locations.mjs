import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const APPROVED_LEARNING_LOCATIONS = [
  'Bound Brook',
  'Plainfield',
  'Piscataway',
  'Flemington',
  'Online',
];

function safeFingerprint(databaseUrl, baseUrl, row) {
  const parsed = new URL(databaseUrl);
  return {
    targetBaseUrl: baseUrl || '(not provided)',
    hostSuffix: parsed.hostname.split('.').slice(-4).join('.'),
    database: row.database,
    schema: row.schema,
    neonBranchId: row.neon_branch_id,
    neonProjectId: row.neon_project_id,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.AIT_CRM_BASE_URL || '';
  const expectedBranchId = process.env.EXPECTED_NEON_BRANCH_ID || '';
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (apply && !expectedBranchId) {
    throw new Error('EXPECTED_NEON_BRANCH_ID is required for --apply.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const fingerprintResult = await client.query(`
      select current_database() as database,
        current_schema() as schema,
        current_setting('neon.branch_id', true) as neon_branch_id,
        current_setting('neon.project_id', true) as neon_project_id
    `);
    const fingerprint = safeFingerprint(databaseUrl, baseUrl, fingerprintResult.rows[0]);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', fingerprint }, null, 2));
    if (apply && fingerprint.neonBranchId !== expectedBranchId) {
      throw new Error(`Refusing write: expected Neon branch ${expectedBranchId}, received ${fingerprint.neonBranchId || '(unknown)'}.`);
    }

    await client.query(apply ? 'begin' : 'begin read only');
    const candidatesResult = await client.query(`
      select c.id,
        c.address as legacy_location,
        latest_lead.id as lead_id,
        latest_lead.location_preference as student_location
      from contacts c
      join business_units bu on bu.id = c.primary_business_unit_id
      left join lateral (
        select l.id, l.location_preference
        from leads l
        where l.contact_id = c.id
          and l.business_unit_id = c.primary_business_unit_id
        order by l.created_at desc nulls last, l.id desc
        limit 1
      ) latest_lead on true
      where c.archived_at is null
        and (
          lower(coalesce(bu.name, '')) like '%ait usa%'
          or lower(coalesce(bu.label, '')) like '%ait usa%'
          or lower(coalesce(bu.name, '')) like '%institute%'
          or lower(coalesce(bu.label, '')) like '%institute%'
        )
        and nullif(trim(c.address), '') is not null
        and lower(trim(c.address)) <> all($1::text[])
      order by c.id
    `, [APPROVED_LEARNING_LOCATIONS.map((value) => value.toLowerCase())]);

    const candidates = candidatesResult.rows;
    const missingLead = candidates.filter((row) => !row.lead_id);
    const conflicts = candidates.filter((row) => (
      row.lead_id &&
      String(row.student_location || '').trim() &&
      String(row.student_location).trim().toLowerCase() !== String(row.legacy_location).trim().toLowerCase()
    ));
    const copyRequired = candidates.filter((row) => row.lead_id && !String(row.student_location || '').trim());
    const alreadyPreserved = candidates.filter((row) => (
      row.lead_id &&
      String(row.student_location || '').trim().toLowerCase() === String(row.legacy_location).trim().toLowerCase()
    ));
    console.log(JSON.stringify({
      candidateCount: candidates.length,
      copyRequiredCount: copyRequired.length,
      alreadyPreservedCount: alreadyPreserved.length,
      missingLeadCount: missingLead.length,
      conflictCount: conflicts.length,
    }, null, 2));

    if (!apply) {
      await client.query('rollback');
      return;
    }
    if (missingLead.length || conflicts.length) {
      throw new Error('Refusing write: every legacy location must have one safe preservation target with no conflicting Student Location.');
    }

    let copiedCount = 0;
    for (const row of copyRequired) {
      const result = await client.query(`
        update leads
        set location_preference = $2, updated_at = now()
        where id = $1 and nullif(trim(location_preference), '') is null
      `, [row.lead_id, row.legacy_location]);
      copiedCount += result.rowCount;
    }
    if (copiedCount !== copyRequired.length) {
      throw new Error(`Copy assertion failed: expected ${copyRequired.length}, updated ${copiedCount}.`);
    }

    const safeContactIds = candidates.map((row) => row.id);
    const clearedResult = safeContactIds.length
      ? await client.query(`
          update contacts
          set address = null, updated_at = now()
          where id = any($1::uuid[])
            and nullif(trim(address), '') is not null
        `, [safeContactIds])
      : { rowCount: 0 };
    if (clearedResult.rowCount !== candidates.length) {
      throw new Error(`Clear assertion failed: expected ${candidates.length}, updated ${clearedResult.rowCount}.`);
    }

    await client.query('commit');
    console.log(JSON.stringify({ applied: true, copiedCount, clearedCount: clearedResult.rowCount }, null, 2));
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
