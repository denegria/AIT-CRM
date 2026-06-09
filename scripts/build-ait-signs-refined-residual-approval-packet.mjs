#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const INPUT = 'docs/mis-165-ait-signs-held-residual-review-packet.json';
const DEFAULT_OUTPUT = 'docs/mis-166-ait-signs-refined-residual-approval.csv';

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('; ') : clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function by(rows, field) {
  return rows.reduce((acc, row) => {
    const value = row[field] || '';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sourceKey(row) {
  return `${row.sourceSheet}#${Number(row.sourceRowNumber)}`;
}

function isSheet12(row) {
  return row.sourceSheet === 'Sheet12';
}

function isAitInternalNoise(row) {
  const text = `${row.workbookOriginalText} ${row.workbookIdentityFields}`.toLowerCase();
  return (
    text.includes('web page & digital ads')
    || text.includes('15 signs work order')
    || text.includes('ait signs')
    || text.includes('ait usa institute')
  );
}

function isNumericNoise(row) {
  const text = clean(row.workbookOriginalText);
  const letters = (text.match(/[a-z]/gi) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  return digits > 0 && letters < 4;
}

function isOldInfoFollowup(row) {
  const text = clean(row.workbookOriginalText).toLowerCase();
  return (
    row.sourceSheet === 'WORK ORDER TERMINADOS Y PAGADOS'
    && (text.includes('se le dio la informacion')
      || text.includes('se le envio la informacion')
      || text.includes('va a venir')
      || text.includes('sin numero'))
  );
}

function count(values) {
  return Array.isArray(values) ? values.filter(Boolean).length : 0;
}

function classify(row) {
  const exactMatches = count(row.exactContactMatches);
  const nameMatches = count(row.nameContactMatches);
  const promotedActivity = clean(row.promotedActivity);

  if (isSheet12(row)) {
    return {
      agentRecommendation: 'reject_or_ignore_sheet12_debris',
      approvalBucket: 'approve_reject_or_ignore_candidates',
      confidence: 'high',
      matchBasis: 'sheet12_non_authoritative',
      why: 'Sheet12 is non-authoritative workbook debris; do not create or attach CRM data from it.',
    };
  }

  if (row.decision === 'safe_attach_status_only_candidate') {
    return {
      agentRecommendation: 'attach_status_only_candidate',
      approvalBucket: 'approve_status_only_candidates',
      confidence: exactMatches === 1 || promotedActivity ? 'high' : 'medium',
      matchBasis: exactMatches === 1 ? 'exact_original_row_phone_or_email' : 'existing_promoted_source_activity_or_name_match',
      why: 'No CRM object creation needed; candidate only changes import/review status once approved.',
    };
  }

  if (row.decision === 'promote_note_candidate') {
    return {
      agentRecommendation: 'create_note_candidate',
      approvalBucket: 'create_note_or_record_candidates',
      confidence: promotedActivity ? 'medium' : 'low',
      matchBasis: promotedActivity ? 'existing_parent_activity' : 'source_text_only',
      why: 'Substantive note content exists beyond status cleanup; requires explicit note creation approval.',
    };
  }

  if (row.decision === 'promote_or_create_candidate') {
    return {
      agentRecommendation: 'create_record_candidate',
      approvalBucket: 'create_note_or_record_candidates',
      confidence: exactMatches === 1 ? 'medium' : 'low',
      matchBasis: exactMatches === 1 ? 'exact_original_row_phone_or_email' : nameMatches ? 'name_match_or_source_identity' : 'source_identity_no_crm_match',
      why: 'Looks like a structured source record rather than pure noise; needs a separate create/promote plan.',
    };
  }

  if (row.decision === 'hold_ambiguous_attach_target') {
    return {
      agentRecommendation: 'hold_ambiguous_attach_target',
      approvalBucket: 'manual_review',
      confidence: 'low',
      matchBasis: nameMatches ? 'name_match_ambiguous_or_name_only' : 'no_exact_match',
      why: 'Possible target exists, but not enough exact evidence for status-only attach.',
    };
  }

  if (row.decision === 'true_human_hold') {
    return {
      agentRecommendation: 'hold_for_human_direction',
      approvalBucket: 'manual_review',
      confidence: 'low',
      matchBasis: promotedActivity ? 'conflicting_existing_activity' : nameMatches ? 'name_match_or_context' : 'no_exact_match',
      why: 'Existing packet already identified a conflict or no safe target.',
    };
  }

  if (row.decision === 'identity_bearing_reject_blocked_review') {
    if (isAitInternalNoise(row) || isNumericNoise(row)) {
      return {
        agentRecommendation: 'reject_noise_candidate',
        approvalBucket: 'approve_reject_or_ignore_candidates',
        confidence: 'medium',
        matchBasis: isAitInternalNoise(row) ? 'internal_ait_or_header_noise' : 'numeric_noise',
        why: 'Original row has identity-like fields, but they are internal/header/numeric noise rather than client follow-up content.',
      };
    }
    if (promotedActivity) {
      return {
        agentRecommendation: 'ignore_or_status_clean_existing_activity',
        approvalBucket: 'approve_status_only_candidates',
        confidence: 'medium',
        matchBasis: 'existing_promoted_source_activity',
        why: 'A promoted activity already exists for this source row; any action should be status-only.',
      };
    }
    if (exactMatches === 1) {
      return {
        agentRecommendation: 'attach_status_only_candidate',
        approvalBucket: 'approve_status_only_candidates',
        confidence: 'high',
        matchBasis: 'exact_original_row_phone_or_email',
        why: 'Original row has an exact single contact match; no CRM object creation needed.',
      };
    }
    if (exactMatches > 1) {
      return {
        agentRecommendation: 'hold_multiple_exact_matches',
        approvalBucket: 'manual_review',
        confidence: 'low',
        matchBasis: 'multiple_exact_matches',
        why: 'Multiple exact matches require human target choice.',
      };
    }
    if (isOldInfoFollowup(row)) {
      return {
        agentRecommendation: 'hold_legacy_info_followup_no_exact_match',
        approvalBucket: 'manual_review',
        confidence: 'low',
        matchBasis: nameMatches === 1 ? 'single_name_match_no_phone' : nameMatches > 1 ? 'ambiguous_name_matches' : 'no_crm_match',
        why: 'Looks like old follow-up/info text; do not create or reject until target/value is approved.',
      };
    }
    if (nameMatches === 1) {
      return {
        agentRecommendation: 'hold_name_only_match_candidate',
        approvalBucket: 'manual_review',
        confidence: 'low',
        matchBasis: 'single_name_match_no_exact_phone_or_email',
        why: 'Single name match exists, but name-only evidence is not enough for automatic attach.',
      };
    }
    if (nameMatches > 1) {
      return {
        agentRecommendation: 'hold_ambiguous_name_matches',
        approvalBucket: 'manual_review',
        confidence: 'low',
        matchBasis: 'ambiguous_name_matches',
        why: 'Multiple possible name targets exist.',
      };
    }
    return {
      agentRecommendation: 'hold_identity_bearing_no_crm_match',
      approvalBucket: 'manual_review',
      confidence: 'low',
      matchBasis: 'source_identity_no_crm_match',
      why: 'Original workbook row contains identity-like content but no confident CRM match.',
    };
  }

  return {
    agentRecommendation: 'hold_unclassified',
    approvalBucket: 'manual_review',
    confidence: 'low',
    matchBasis: 'unclassified',
    why: 'Needs manual review before any write.',
  };
}

function toApprovalRow(row) {
  const refined = classify(row);
  return {
    alvaro_decision: '',
    ...refined,
    sourceKey: sourceKey(row),
    sourceSheet: row.sourceSheet,
    sourceRowNumber: row.sourceRowNumber,
    currentStatus: row.currentStatus,
    oldDecision: row.decision,
    oldRecommendation: row.oldRecommendation,
    crosscheckVerdict: row.crosscheckVerdict,
    target: row.target,
    exactContactMatches: row.exactContactMatches || [],
    nameContactMatches: row.nameContactMatches || [],
    promotedActivity: row.promotedActivity || '',
    workbookIdentityFields: row.workbookIdentityFields || '',
    workbookOriginalText: row.workbookOriginalText || '',
    workbookPreviousRowText: row.workbookPreviousRowText || '',
    workbookNextRowText: row.workbookNextRowText || '',
    reason: row.reason || '',
    evidence: row.evidence || '',
  };
}

function toCsv(rows) {
  const columns = [
    'alvaro_decision',
    'agentRecommendation',
    'approvalBucket',
    'confidence',
    'matchBasis',
    'why',
    'sourceKey',
    'sourceSheet',
    'sourceRowNumber',
    'currentStatus',
    'target',
    'exactContactMatches',
    'nameContactMatches',
    'promotedActivity',
    'workbookIdentityFields',
    'workbookOriginalText',
    'workbookPreviousRowText',
    'workbookNextRowText',
    'oldDecision',
    'oldRecommendation',
    'crosscheckVerdict',
    'reason',
    'evidence',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-166 AIT Signs Refined Residual Approval Packet',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Input: \`${INPUT}\``,
    '- DB writes: none',
    '- CRM/source/schema changes: none',
    '- First CSV column is intentionally blank: `alvaro_decision`.',
    '',
    '## Summary',
    '',
    `- Total rows: ${report.summary.totalRows}`,
    '',
    '### By Approval Bucket',
    '',
    ...Object.entries(report.summary.byApprovalBucket).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '### By Recommendation',
    '',
    ...Object.entries(report.summary.byAgentRecommendation).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Notes',
    '',
    '- Sheet12 rows are treated as non-authoritative debris and should not create CRM records.',
    '- Exact phone/email matches can become status-only attach candidates, but name-only matches stay manual review.',
    '- Create-note/create-record candidates are separated from status-only cleanup candidates.',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const input = JSON.parse(await readFile(INPUT, 'utf8'));
  const rows = input.rows.map(toApprovalRow);
  const report = {
    issue: 'MIS-166',
    generatedAt: new Date().toISOString(),
    input: INPUT,
    summary: {
      totalRows: rows.length,
      byApprovalBucket: by(rows, 'approvalBucket'),
      byAgentRecommendation: by(rows, 'agentRecommendation'),
      byConfidence: by(rows, 'confidence'),
      byMatchBasis: by(rows, 'matchBasis'),
    },
    rows,
  };

  const jsonPath = options.output.replace(/\.csv$/, '.json');
  const mdPath = options.output.replace(/\.csv$/, '.md');
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${toCsv(rows)}\n`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(report));
  for (const bucket of Object.keys(report.summary.byApprovalBucket).sort()) {
    const bucketRows = rows.filter((row) => row.approvalBucket === bucket);
    await writeFile(
      options.output.replace(/\.csv$/, `-${bucket}.csv`),
      `${toCsv(bucketRows)}\n`,
    );
  }
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
