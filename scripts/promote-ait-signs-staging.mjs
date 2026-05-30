#!/usr/bin/env node

import process from 'node:process';
import { Client } from 'pg';

const BUSINESS_UNIT_NAME = 'AIT Signs';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    batchId: null,
    limit: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--batch-id') {
      options.batchId = argv[i + 1];
      i += 1;
    } else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function proposalFor(record) {
  return (
    record.proposed_contact_json ||
    record.proposed_lead_json ||
    record.proposed_estimate_json ||
    record.proposed_work_order_json ||
    record.proposed_payment_json ||
    record.proposed_note_json ||
    {}
  );
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

function contactNameFromProposal(proposal) {
  const contactHint = cleanText(proposal.contactHint);
  if (contactHint) return contactHint.slice(0, 160);
  const rawValues = Array.isArray(proposal.rawValuesJson) ? proposal.rawValuesJson : [];
  for (const value of rawValues) {
    const text = cleanText(value);
    if (!text || /\d/.test(text) || text.length < 3) continue;
    if (/^(FB|SI|NO|AIT|ACTIVO)$/i.test(text)) continue;
    return text.slice(0, 160);
  }
  return 'Unknown AIT Signs Contact';
}

function amountFromProposal(proposal) {
  const value = Number(String(proposal.moneyHint || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function statusForRecord(record, proposal) {
  if (record.record_type === 'lead') return proposal.statusHint || 'new';
  if (record.record_type === 'estimate') return proposal.estimateStage || proposal.statusHint || 'estimate_review';
  if (record.record_type === 'work_order') return proposal.workOrderStage || proposal.statusHint || 'in_production';
  if (record.record_type === 'payment_snapshot') return proposal.paymentStage || proposal.statusHint || 'payment_snapshot';
  return proposal.noteStage || 'staged_note';
}

async function getLatestBatchId(client) {
  const result = await client.query(
    `
      select ib.id
      from import_batches ib
      join business_units bu on bu.id = ib.business_unit_id
      where bu.name = $1
        and ib.source_type = 'xlsx'
      order by ib.created_at desc
      limit 1
    `,
    [BUSINESS_UNIT_NAME],
  );
  return result.rows[0]?.id || null;
}

async function getAitContext(client, batchId) {
  const batch = await client.query(
    `
      select
        ib.organization_id,
        ib.business_unit_id,
        bu.name as business_unit_name
      from import_batches ib
      left join business_units bu on bu.id = ib.business_unit_id
      where ib.id = $1
      limit 1
    `,
    [batchId],
  );
  if (!batch.rowCount) throw new Error('No import batch found.');
  if (!batch.rows[0].business_unit_id) {
    throw new Error(`Import batch ${batchId} is missing a business unit. Reload staging before promotion.`);
  }
  if (batch.rows[0].business_unit_name !== BUSINESS_UNIT_NAME) {
    throw new Error(`Import batch ${batchId} targets ${batch.rows[0].business_unit_name || 'unknown'}, not ${BUSINESS_UNIT_NAME}.`);
  }

  return {
    organizationId: batch.rows[0].organization_id,
    businessUnitId: batch.rows[0].business_unit_id,
  };
}

async function getApprovedRecords(client, batchId, limit) {
  const params = [batchId];
  const limitSql = limit ? `limit $${params.push(limit)}` : '';
  const result = await client.query(
    `
      select
        nr.id,
        nr.record_type,
        nr.proposed_contact_json,
        nr.proposed_lead_json,
        nr.proposed_estimate_json,
        nr.proposed_work_order_json,
        nr.proposed_payment_json,
        nr.proposed_note_json,
        nr.confidence_score,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where nr.import_batch_id = $1
        and nr.status = 'approved'
      order by sr.source_sheet, sr.source_row_number
      ${limitSql}
    `,
    params,
  );
  return result.rows;
}

async function findOrCreateContact(client, context, proposal, sourceLabel, dryRun) {
  const phone = normalizePhone(proposal.phoneHint);
  const name = contactNameFromProposal(proposal);

  if (phone) {
    const existing = await client.query(
      `
        select id
        from contacts
        where organization_id = $1
          and phone = $2
          and primary_business_unit_id = $3
        order by created_at asc
        limit 1
      `,
      [context.organizationId, phone, context.businessUnitId],
    );
    if (existing.rowCount) return existing.rows[0].id;
  }

  if (dryRun) return `dry-contact:${phone || name}`;

  const result = await client.query(
    `
      insert into contacts (
        organization_id,
        primary_business_unit_id,
        name,
        phone,
        source_label
      )
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [context.organizationId, context.businessUnitId, name, phone, sourceLabel],
  );
  return result.rows[0].id;
}

async function promoteRecord(client, context, record, dryRun) {
  const proposal = proposalFor(record);
  const sourceLabel = proposal.sourceType || 'ait_signs_import';
  const contactId = await findOrCreateContact(client, context, proposal, sourceLabel, dryRun);
  const status = statusForRecord(record, proposal);
  const amount = amountFromProposal(proposal);

  if (dryRun) {
    return { recordType: record.record_type, contactId, status };
  }

  if (record.record_type === 'lead') {
    await client.query(
      `
        insert into leads (
          organization_id,
          business_unit_id,
          contact_id,
          source_type,
          source_name,
          status,
          current_stage,
          original_notes
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        context.organizationId,
        context.businessUnitId,
        contactId,
        proposal.sourceType || 'spreadsheet',
        proposal.sourceSheet || BUSINESS_UNIT_NAME,
        status,
        proposal.leadStage || status,
        proposal.originalText || null,
      ],
    );
  } else if (record.record_type === 'estimate') {
    await client.query(
      `
        insert into estimates (
          organization_id,
          business_unit_id,
          contact_id,
          status,
          total
        )
        values ($1, $2, $3, $4, $5)
      `,
      [context.organizationId, context.businessUnitId, contactId, status, amount],
    );
  } else if (record.record_type === 'work_order') {
    await client.query(
      `
        insert into work_orders (
          organization_id,
          business_unit_id,
          contact_id,
          status,
          priority
        )
        values ($1, $2, $3, $4, $5)
      `,
      [context.organizationId, context.businessUnitId, contactId, status, 'Medium'],
    );
  } else if (record.record_type === 'payment_snapshot') {
    await client.query(
      `
        insert into payment_snapshots (
          organization_id,
          business_unit_id,
          amount,
          source_sheet,
          source_row
        )
        values ($1, $2, $3, $4, $5)
      `,
      [
        context.organizationId,
        context.businessUnitId,
        amount,
        record.source_sheet,
        record.source_row_number,
      ],
    );
  } else {
    await client.query(
      `
        insert into notes (
          organization_id,
          business_unit_id,
          contact_id,
          body
        )
        values ($1, $2, $3, $4)
      `,
      [context.organizationId, context.businessUnitId, contactId, proposal.originalText || record.raw_text || ''],
    );
  }

  await client.query(
    `
      insert into activity_events (
        organization_id,
        business_unit_id,
        contact_id,
        event_type,
        message,
        source_sheet,
        source_row
      )
      values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      context.organizationId,
      context.businessUnitId,
      contactId,
      `import_promoted_${record.record_type}`,
      proposal.originalText || record.raw_text || null,
      record.source_sheet,
      record.source_row_number,
    ],
  );

  await client.query(
    "update import_normalized_records set status = 'imported' where id = $1",
    [record.id],
  );

  return { recordType: record.record_type, contactId, status };
}

function summarize(results) {
  const byType = {};
  for (const result of results) {
    byType[result.recordType] = (byType[result.recordType] || 0) + 1;
  }
  return byType;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const batchId = options.batchId || await getLatestBatchId(client);
    if (!batchId) throw new Error('No import batch found.');

    const context = await getAitContext(client, batchId);
    const records = await getApprovedRecords(client, batchId, options.limit);

    if (options.dryRun) {
      const results = [];
      for (const record of records) {
        results.push(await promoteRecord(client, context, record, true));
      }
      console.log(JSON.stringify({ batchId, dryRun: true, approvedRecords: records.length, byType: summarize(results) }, null, 2));
      return;
    }

    await client.query('begin');
    const results = [];
    for (const record of records) {
      results.push(await promoteRecord(client, context, record, false));
    }
    await client.query('commit');
    console.log(JSON.stringify({ batchId, promotedRecords: results.length, byType: summarize(results) }, null, 2));
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
