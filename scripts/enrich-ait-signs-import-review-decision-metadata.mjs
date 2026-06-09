import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const PACKET_PATH = 'docs/mis-171-ait-signs-import-review-page-set-aside.json';
const REPORT_BASENAME = 'docs/mis-174-ait-signs-import-review-metadata-enrichment';
const METADATA_KEY = 'mis171ReviewMetadata';
const AIT_SIGNS_DECISION_TYPES = ['misc_text', 'note'];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    idempotence: argv.includes('--idempotence'),
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stable(value));
}

function parseSourceKey(sourceKey) {
  const match = String(sourceKey || '').match(/^(.*)#(\d+)$/);
  if (!match) throw new Error(`Invalid sourceKey: ${sourceKey}`);
  return {
    sourceSheet: match[1],
    sourceRowNumber: Number(match[2]),
  };
}

function metadataForPacketRow(row, packet) {
  return {
    source: packet.issue || 'MIS-171',
    sourceGeneratedAt: packet.generatedAt,
    decision: row.decision,
    sourceKey: row.sourceKey,
    sourceClientNames: row.sourceClientNames || [],
    sourcePhones: row.sourcePhones || [],
    sourceEmails: row.sourceEmails || [],
    roughMatchBucket: row.roughMatchBucket || '',
    topRoughMatch: row.topRoughMatch || '',
    exactClientMatches: row.exactClientMatches || [],
    exactEmailMatches: row.exactEmailMatches || [],
    workbookOriginalText: row.workbookOriginalText || '',
    futureAction: row.futureAction || '',
  };
}

function nextResolution(current, metadata) {
  return {
    ...(current || {}),
    [METADATA_KEY]: metadata,
  };
}

async function loadReviewItems(client, packetRows) {
  const result = await client.query(
    `
      select
        iri.id,
        iri.review_status,
        iri.review_type,
        iri.proposed_resolution_json,
        ib.id as import_batch_id,
        ib.source_name,
        ib.file_name,
        bu.name as business_unit_name,
        sr.source_sheet,
        sr.source_row_number
      from import_review_items iri
      join import_source_rows sr on sr.id = iri.source_row_id
      join import_batches ib on ib.id = iri.import_batch_id
      left join business_units bu on bu.id = ib.business_unit_id
      where bu.name = 'AIT Signs'
        and (sr.source_sheet, sr.source_row_number) in (
          select source_sheet, source_row_number
          from jsonb_to_recordset($1::jsonb) as packet(source_sheet text, source_row_number int)
        )
      order by sr.source_sheet asc, sr.source_row_number asc, iri.created_at desc
    `,
    [JSON.stringify(packetRows.map((row) => {
      const parsed = parseSourceKey(row.sourceKey);
      return {
        source_sheet: parsed.sourceSheet,
        source_row_number: parsed.sourceRowNumber,
      };
    }))],
  );

  const bySourceKey = new Map();
  for (const row of result.rows) {
    const sourceKey = `${row.source_sheet}#${row.source_row_number}`;
    const list = bySourceKey.get(sourceKey) || [];
    list.push(row);
    bySourceKey.set(sourceKey, list);
  }
  return bySourceKey;
}

async function planEnrichment(client, packet) {
  const bySourceKey = await loadReviewItems(client, packet.rows);
  const plans = [];
  const missing = [];
  const ambiguous = [];
  const skipped = [];

  for (const packetRow of packet.rows) {
    const matches = bySourceKey.get(packetRow.sourceKey) || [];
    if (!matches.length) {
      missing.push(packetRow.sourceKey);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push(packetRow.sourceKey);
      continue;
    }

    const current = matches[0];
    if (current.review_status !== 'pending') {
      skipped.push({
        sourceKey: packetRow.sourceKey,
        reason: `review_status=${current.review_status}`,
      });
      continue;
    }
    if (!AIT_SIGNS_DECISION_TYPES.includes(current.review_type)) {
      skipped.push({
        sourceKey: packetRow.sourceKey,
        reason: `review_type=${current.review_type}`,
      });
      continue;
    }

    const metadata = metadataForPacketRow(packetRow, packet);
    const next = nextResolution(current.proposed_resolution_json, metadata);
    const changed = stableStringify(current.proposed_resolution_json || {}) !== stableStringify(next);
    plans.push({
      sourceKey: packetRow.sourceKey,
      reviewItemId: current.id,
      importBatchId: current.import_batch_id,
      currentStatus: current.review_status,
      changed,
      metadata,
      nextResolution: next,
    });
  }

  return {
    packetRows: packet.rows.length,
    plannedUpdates: plans.filter((plan) => plan.changed).length,
    alreadyEnriched: plans.filter((plan) => !plan.changed).length,
    missing,
    ambiguous,
    skipped,
    plans,
  };
}

async function applyPlan(client, plan) {
  const updates = plan.plans.filter((item) => item.changed);
  await client.query('begin');
  try {
    for (const item of updates) {
      const result = await client.query(
        `
          update import_review_items
          set proposed_resolution_json = $2::jsonb
          where id = $1
            and review_status = 'pending'
        `,
        [item.reviewItemId, JSON.stringify(item.nextResolution)],
      );
      if (result.rowCount !== 1) {
        throw new Error(`Expected exactly one update for ${item.sourceKey}, got ${result.rowCount}.`);
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return updates.length;
}

function reportPath({ apply, idempotence }) {
  const suffix = idempotence ? 'idempotence' : apply ? 'apply' : 'dry-run';
  return `${REPORT_BASENAME}-${suffix}.json`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const fingerprintResult = await client.query('select current_database() as database');
    const plan = await planEnrichment(client, packet);
    if (plan.missing.length || plan.ambiguous.length || plan.skipped.length) {
      throw new Error(`Unsafe enrichment plan: missing=${plan.missing.length}, ambiguous=${plan.ambiguous.length}, skipped=${plan.skipped.length}`);
    }

    const appliedUpdates = options.apply ? await applyPlan(client, plan) : 0;
    const report = {
      issue: 'MIS-174',
      mode: options.idempotence ? 'idempotence' : options.apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      safeFingerprint: {
        database: fingerprintResult.rows[0]?.database,
      },
      packetPath: PACKET_PATH,
      packetRows: plan.packetRows,
      plannedUpdates: plan.plannedUpdates,
      alreadyEnriched: plan.alreadyEnriched,
      appliedUpdates,
      missing: plan.missing,
      ambiguous: plan.ambiguous,
      skipped: plan.skipped,
      sourceKeys: plan.plans.map((item) => item.sourceKey),
    };

    const outputPath = reportPath(options);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
