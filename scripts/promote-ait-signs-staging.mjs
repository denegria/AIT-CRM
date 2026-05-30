#!/usr/bin/env node

import process from 'node:process';
import { Client } from 'pg';

const BUSINESS_UNIT_NAME = 'AIT Signs';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    approvePending: false,
    batchId: null,
    limit: null,
    recordType: null,
    sheet: null,
    statusHint: null,
    excludeStatusHints: [],
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--approve-pending') {
      options.approvePending = true;
    } else if (arg === '--batch-id') {
      options.batchId = argv[i + 1];
      i += 1;
    } else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--record-type') {
      options.recordType = argv[i + 1];
      i += 1;
    } else if (arg === '--sheet') {
      options.sheet = argv[i + 1];
      i += 1;
    } else if (arg === '--status-hint') {
      options.statusHint = argv[i + 1];
      i += 1;
    } else if (arg === '--exclude-status-hint') {
      options.excludeStatusHints.push(argv[i + 1]);
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

function nullableAmount(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function compactParts(parts) {
  return parts.map(cleanText).filter(Boolean).join(' · ');
}

function sourceRowNumber(record) {
  return Number(record.source_row_number || proposalFor(record).sourceRowNumber || 0) || null;
}

function statusHintFor(record) {
  return cleanText(proposalFor(record).statusHint || statusForRecord(record, proposalFor(record)));
}

function workOrderNumberFor(record, sourceRow) {
  if (!sourceRow) return null;
  const sheet = String(record.source_sheet || '').toLowerCase();
  if (sheet.includes('termin') || sheet.includes('pagad')) return `AIT-WO-ARCH-${sourceRow}`;
  if (sheet.includes('15 signs')) return `AIT-WO-ACT-${sourceRow}`;
  return `AIT-WO-${sourceRow}`;
}

function statusForRecord(record, proposal) {
  if (record.record_type === 'lead') return proposal.statusHint || 'new';
  if (record.record_type === 'estimate') return proposal.estimateStage || proposal.statusHint || 'estimate_review';
  if (record.record_type === 'work_order') return proposal.workOrderStage || proposal.statusHint || 'in_production';
  if (record.record_type === 'payment_snapshot') return proposal.paymentStage || proposal.statusHint || 'payment_snapshot';
  return proposal.noteStage || 'staged_note';
}

function crmStatusFor(record, proposal) {
  const hint = statusForRecord(record, proposal);
  if (record.record_type === 'work_order') {
    if (hint === 'delivered_paid') return 'Completed';
    if (hint === 'pending_collection') return 'Completed';
    if (hint === 'ready_to_deliver') return 'In Progress';
    if (hint === 'not_started') return 'Pending';
    if (hint === 'canceled' || hint === 'lost') return 'Canceled';
    return 'In Progress';
  }
  if (record.record_type === 'estimate') {
    if (hint === 'lost' || hint === 'not_approved') return 'Rejected';
    if (hint === 'converted_to_work_order') return 'Approved';
    return 'Pending';
  }
  return hint;
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
        ib.source_type,
        bu.name as business_unit_name
      from import_batches ib
      left join business_units bu on bu.id = ib.business_unit_id
      where ib.id = $1
      limit 1
    `,
    [batchId],
  );
  if (!batch.rowCount) throw new Error('No import batch found.');
  if (batch.rows[0].source_type !== 'xlsx') {
    throw new Error(`Import batch ${batchId} is ${batch.rows[0].source_type || 'unknown'}, not an AIT Signs XLSX batch.`);
  }
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

async function getRecordsForPromotion(client, batchId, options) {
  const params = [batchId];
  const clauses = ['nr.import_batch_id = $1'];
  clauses.push(options.approvePending ? "nr.status in ('approved', 'pending')" : "nr.status = 'approved'");
  if (options.recordType) {
    params.push(options.recordType);
    clauses.push(`nr.record_type = $${params.length}`);
  }
  if (options.sheet) {
    params.push(options.sheet);
    clauses.push(`sr.source_sheet = $${params.length}`);
  }
  const limitSql = options.limit ? `limit $${params.push(options.limit)}` : '';
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
        nr.status as import_status,
        sr.source_sheet,
        sr.source_row_number,
        sr.raw_text
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      where ${clauses.join(' and ')}
      order by sr.source_sheet, sr.source_row_number
      ${limitSql}
    `,
    params,
  );
  return result.rows.filter((record) => {
    const hint = statusHintFor(record);
    if (options.statusHint && hint !== options.statusHint) return false;
    if (options.excludeStatusHints.includes(hint)) return false;
    return true;
  });
}

async function findOrCreateContact(client, context, proposal, sourceLabel, dryRun) {
  const phone = normalizePhone(proposal.phoneHint);
  const companyName = cleanText(proposal.customerName || proposal.contactHint);
  const personName = cleanText(proposal.contactName);
  const name = (personName || companyName || contactNameFromProposal(proposal)).slice(0, 160);

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
        company_name,
        phone,
        source_label
      )
      values ($1, $2, $3, $4, $5, $6)
      returning id
    `,
    [context.organizationId, context.businessUnitId, name, companyName || null, phone, sourceLabel],
  );
  return result.rows[0].id;
}

async function approvePendingRecords(client, batchId, records) {
  const pendingIds = records.filter((record) => record.import_status === 'pending').map((record) => record.id);
  if (!pendingIds.length) return 0;
  const result = await client.query(
    `
      update import_normalized_records
      set status = 'approved'
      where import_batch_id = $1
        and id = any($2::uuid[])
        and status = 'pending'
    `,
    [batchId, pendingIds],
  );
  return result.rowCount || 0;
}

async function promoteRecord(client, context, record, dryRun) {
  const proposal = proposalFor(record);
  if (proposal.businessUnit !== BUSINESS_UNIT_NAME) {
    throw new Error(`Record ${record.id} targets ${proposal.businessUnit || 'unknown'}, not ${BUSINESS_UNIT_NAME}.`);
  }
  const sourceLabel = proposal.sourceType || 'ait_signs_import';
  const contactId = await findOrCreateContact(client, context, proposal, sourceLabel, dryRun);
  const status = crmStatusFor(record, proposal);
  const amount = amountFromProposal(proposal);
  const sourceRow = sourceRowNumber(record);
  const importRef = compactParts([record.source_sheet, sourceRow ? `row ${sourceRow}` : '', proposal.statusHint]);

  if (dryRun) {
    return { recordType: record.record_type, contactId, status, sheet: record.source_sheet, row: sourceRow, amount };
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
    const result = await client.query(
      `
        insert into estimates (
          organization_id,
          business_unit_id,
          contact_id,
          estimate_number,
          status,
          subtotal,
          tax,
          advance_paid,
          balance_due,
          total
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id
      `,
      [
        context.organizationId,
        context.businessUnitId,
        contactId,
        sourceRow ? `AIT-EST-${sourceRow}` : null,
        status,
        nullableAmount(proposal.netAmountHint),
        nullableAmount(proposal.taxAmountHint),
        nullableAmount(proposal.advanceAmountHint),
        nullableAmount(proposal.balanceAmountHint),
        amount,
      ],
    );
    record.promoted_estimate_id = result.rows[0]?.id || null;
  } else if (record.record_type === 'work_order') {
    const title = cleanText(proposal.workDescription || proposal.customerName || proposal.contactHint || `AIT Signs work order ${sourceRow || record.id}`).slice(0, 220);
    const description = compactParts([
      proposal.workDescription,
      proposal.observationText,
      proposal.originalText,
      importRef ? `Import: ${importRef}` : '',
    ]);
    const result = await client.query(
      `
        insert into work_orders (
          organization_id,
          business_unit_id,
          contact_id,
          work_order_number,
          title,
          status,
          priority,
          description,
          estimated_cost
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id
      `,
      [
        context.organizationId,
        context.businessUnitId,
        contactId,
        workOrderNumberFor(record, sourceRow),
        title,
        status,
        'Medium',
        description || null,
        amount,
      ],
    );
    record.promoted_work_order_id = result.rows[0]?.id || null;
  } else if (record.record_type === 'payment_snapshot') {
    const result = await client.query(
      `
        insert into payment_snapshots (
          organization_id,
          business_unit_id,
          amount,
          balance_after,
          source_sheet,
          source_row
        )
        values ($1, $2, $3, $4, $5, $6)
        returning id
      `,
      [
        context.organizationId,
        context.businessUnitId,
        amount,
        nullableAmount(proposal.balanceAmountHint),
        record.source_sheet,
        sourceRow,
      ],
    );
    record.promoted_payment_snapshot_id = result.rows[0]?.id || null;
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
        estimate_id,
        work_order_id,
        source_sheet,
        source_row
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      context.organizationId,
      context.businessUnitId,
      contactId,
      `import_promoted_${record.record_type}`,
      proposal.originalText || record.raw_text || null,
      record.promoted_estimate_id || null,
      record.promoted_work_order_id || null,
      record.source_sheet,
      sourceRow,
    ],
  );

  await client.query(
    "update import_normalized_records set status = 'imported' where id = $1",
    [record.id],
  );

  return { recordType: record.record_type, contactId, status, sheet: record.source_sheet, row: sourceRow, amount };
}

function summarize(results) {
  const byType = {};
  const byTypeStatus = {};
  for (const result of results) {
    byType[result.recordType] = (byType[result.recordType] || 0) + 1;
    const key = `${result.recordType}:${result.status}`;
    byTypeStatus[key] = (byTypeStatus[key] || 0) + 1;
  }
  return { byType, byTypeStatus };
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
    const records = await getRecordsForPromotion(client, batchId, options);

    if (options.dryRun) {
      const results = [];
      for (const record of records) {
        results.push(await promoteRecord(client, context, record, true));
      }
      console.log(JSON.stringify({
        batchId,
        dryRun: true,
        approvePending: options.approvePending,
        selectedRecords: records.length,
        summary: summarize(results),
        samples: results.slice(0, 10),
      }, null, 2));
      return;
    }

    await client.query('begin');
    const approvedNow = options.approvePending ? await approvePendingRecords(client, batchId, records) : 0;
    const results = [];
    for (const record of records) {
      results.push(await promoteRecord(client, context, record, false));
    }
    await client.query('commit');
    console.log(JSON.stringify({ batchId, approvedNow, promotedRecords: results.length, summary: summarize(results) }, null, 2));
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
