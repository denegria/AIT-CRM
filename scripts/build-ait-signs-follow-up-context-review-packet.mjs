#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT = 'docs/mis-160-ait-signs-import-review-residual-after-noise-cleanup.json';
const DEFAULT_BASENAME = 'docs/mis-160-ait-signs-follow-up-context-review';

function parseArgs(argv) {
  const options = { input: DEFAULT_INPUT, outputBase: DEFAULT_BASENAME };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === '--output-base') {
      options.outputBase = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function key(sheet, rowNumber) {
  return `${sheet}#${rowNumber}`;
}

const overrides = new Map([
  [key('3. 15 SIGNS WORK ORDER', 122), ['promote_note', 'PHT CONTRACTOR / AIT-WO-ACT-122', 'Useful operational note beyond parent work order: payment/contact follow-up and design-send instruction.']],
  [key('WORK ORDER TERMINADOS Y PAGADOS', 1538), ['hold_for_human', 'BLUE MOUNTAIN (7328038578)', 'Operational instruction text says to match the sent photo but add pool-services copy; hold for attach-vs-ignore direction.']],
  [key('1. INTERESADOS', 10), ['attach_to_existing_contact', 'ISRAEL (9736874166)', 'Continuation/follow-up context for adjacent lead row 9.']],
  [key('1. INTERESADOS', 12), ['attach_to_existing_contact', 'Unknown AIT Signs Contact (9732247702)', 'Continuation/follow-up context for adjacent lead row 11.']],
  [key('1. INTERESADOS', 14), ['attach_to_existing_contact', 'HACEN BANDERAS (6098024421)', 'Continuation/follow-up context for adjacent lead row 13.']],
  [key('1. INTERESADOS', 16), ['attach_to_existing_contact', 'WINSTON (9143809852)', 'Continuation/follow-up context for adjacent lead row 15.']],
  [key('1. INTERESADOS', 19), ['attach_to_existing_contact', 'OMAR (5512503071)', 'Continuation/follow-up context for adjacent lead row 18.']],
  [key('1. INTERESADOS', 21), ['attach_to_existing_contact', 'JUAN (5512025140)', 'Continuation/follow-up context for adjacent lead row 20.']],
  [key('1. INTERESADOS', 25), ['attach_to_existing_contact', 'VALDECI (9084563940)', 'Continuation/follow-up context for adjacent lead row 24.']],
  [key('1. INTERESADOS', 28), ['attach_to_existing_contact', 'FULL WRAP DE UN SEDAN (2014668465)', 'Continuation/follow-up context for adjacent lead row 27.']],
  [key('1. INTERESADOS', 32), ['attach_to_existing_contact', 'RONY (9739360165)', 'Continuation/follow-up context for adjacent lead row 31.']],
  [key('1. INTERESADOS', 35), ['attach_to_existing_contact', 'ITALO (9299338450)', 'Continuation/follow-up context for adjacent lead row 34.']],
  [key('3. 15 SIGNS WORK ORDER', 109), ['attach_to_existing_contact', '4 BROTHER', 'Structured work text likely belongs to existing 4 BROTHER contact.']],
  [key('3. 15 SIGNS WORK ORDER', 130), ['attach_to_existing_contact', 'IGLESIA NUEVO NACIMIENTO (8624130511)', 'Structured work text matches existing contact and phone.']],
  [key('3. 15 SIGNS WORK ORDER', 135), ['attach_to_existing_contact', 'JAIME ARRIAGA HOME IMPROVEMENT', 'Structured work text matches existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 141), ['attach_to_existing_contact', 'GREEN 714', 'Structured work text likely belongs to existing GREEN 714 contact.']],
  [key('3. 15 SIGNS WORK ORDER', 142), ['attach_to_existing_contact', 'PINAS LOCAS', 'Structured work text matches existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 208), ['attach_to_existing_contact', 'FONSE', 'Structured work text matches existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 235), ['attach_to_existing_contact', 'CENTRAL FRESH SUPERMARKET', 'Structured work text matches existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 258), ['attach_to_existing_contact', 'PATRICIA SABOR CASERO', 'Structured work text matches existing contact.']],
  [key('2. ESTIMADOS', 52), ['hold_for_human', 'Possible PAVEMENT SPECIALISTS vs DOWN TOWN PLAINFIELD', 'Promoted parent evidence points to DOWN TOWN PLAINFIELD, while row text says PAVEMENT SPECIAL / JHON.']],
  [key('1. INTERESADOS', 41), ['hold_for_human', 'Phone-only 2156816461', 'Phone-only row with no staging DB phone match.']],
  [key('1. INTERESADOS', 42), ['hold_for_human', 'Phone-only 6098478395', 'Phone-only row with no staging DB phone match.']],
  [key('1. INTERESADOS', 55), ['hold_for_human', 'MARIA JOSE (9082558983)', 'Useful wrong-number/contact clue, but no staging DB phone match.']],
  [key('2. ESTIMADOS', 85), ['hold_for_human', 'JBP CONSTRUCTION / JAIME', 'Possible JBP CONTRACTOR or JBP CONST.; ambiguous target.']],
  [key('WORK ORDER TERMINADOS Y PAGADOS', 20), ['hold_for_human', 'FERNANDO VASQUEZ / jerseyoutlets@yahoo.com', 'Useful email and work clue, but no confident existing target.']],
  [key('2. ESTIMADOS', 83), ['record_candidate_needs_promotion_review', 'XTREEM KLEEN / MIKE / PROPUESTA 1', 'Structured estimate candidate with no confident existing target.']],
  [key('2. ESTIMADOS', 84), ['record_candidate_needs_promotion_review', 'XTREEM KLEEN / MIKE / PROPUESTA 2', 'Structured estimate candidate with no confident existing target.']],
  [key('3. 15 SIGNS WORK ORDER', 86), ['record_candidate_needs_promotion_review', 'TRIM KING / WAYNE', 'Structured work row with no confident existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 107), ['record_candidate_needs_promotion_review', 'JUANITA / LETRAS DORADAS', 'Structured work row with no confident existing contact.']],
  [key('3. 15 SIGNS WORK ORDER', 127), ['record_candidate_needs_promotion_review', 'AUTO CHIP CORP / HENRI VALENCIA (9082964306)', 'Structured work row; phone not currently matched.']],
  [key('3. 15 SIGNS WORK ORDER', 171), ['record_candidate_needs_promotion_review', 'AUTO CHIP CORP / HENRY VALENCIA (9082964306)', 'Second structured work/payment row; phone not currently matched.']],
  [key('WORK ORDER TERMINADOS Y PAGADOS', 1701), ['record_candidate_needs_promotion_review', 'TAROT', 'Structured paid row with loose possible TAROT SERVICE target, not confident.']],
]);

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function csvCell(value) {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function classify(row) {
  const override = overrides.get(key(row.sourceSheet, row.sourceRowNumber));
  if (override) {
    const [recommendation, target, evidence] = override;
    return { recommendation, target, evidence };
  }
  return {
    recommendation: 'reject_noise',
    target: '',
    evidence: 'Read-only audit found no reliable customer/contact identity, no confident adjacent parent, and no substantive structured record worth promotion review.',
  };
}

function toCsv(rows) {
  const columns = [
    'recommendation',
    'sourceSheet',
    'sourceRowNumber',
    'reviewType',
    'target',
    'evidence',
    'customerName',
    'contactName',
    'workDescription',
    'residualBucket',
    'reason',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function renderMd(report) {
  return `# MIS-160 AIT Signs Follow-up Context Review

- Generated at: ${report.generatedAt}
- Source rows reviewed: ${report.summary.total}
- DB writes: none

## Summary

- Reject noise: ${report.summary.byRecommendation.reject_noise || 0}
- Attach to existing contact: ${report.summary.byRecommendation.attach_to_existing_contact || 0}
- Promote note: ${report.summary.byRecommendation.promote_note || 0}
- Hold for human: ${report.summary.byRecommendation.hold_for_human || 0}
- Record candidate needs promotion review: ${report.summary.byRecommendation.record_candidate_needs_promotion_review || 0}

## Recommendation

- Reject the ${report.summary.byRecommendation.reject_noise || 0} audited noise rows only after approval.
- Treat the ${report.summary.byRecommendation.attach_to_existing_contact || 0} attach rows as useful follow-up/context rows, not parser junk.
- Promote the ${report.summary.byRecommendation.promote_note || 0} useful normalized note only after an explicit note-creation/attachment write plan.
- Keep the ${report.summary.byRecommendation.hold_for_human || 0} human holds and ${report.summary.byRecommendation.record_candidate_needs_promotion_review || 0} promotion-review candidates pending for a separate write plan.
`;
}

async function main() {
  const options = parseArgs(process.argv);
  const residual = JSON.parse(await readFile(options.input, 'utf8'));
  const rows = residual.rows
    .filter((row) => row.recommendedBucket !== 'identityless_financial_line')
    .map((row) => {
      const decision = classify(row);
      return {
        ...decision,
        sourceSheet: row.sourceSheet,
        sourceRowNumber: row.sourceRowNumber,
        reviewType: row.reviewType,
        customerName: row.customerName,
        contactName: row.contactName,
        workDescription: row.workDescription,
        residualBucket: row.recommendedBucket,
        reason: row.reason,
      };
    });

  const byRecommendation = {};
  for (const row of rows) {
    byRecommendation[row.recommendation] = (byRecommendation[row.recommendation] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: options.input,
    businessUnit: residual.businessUnit,
    safeFingerprint: residual.safeFingerprint,
    summary: {
      total: rows.length,
      byRecommendation,
    },
    rows,
  };

  await mkdir(path.dirname(options.outputBase), { recursive: true });
  await writeFile(`${options.outputBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${options.outputBase}.csv`, `${toCsv(rows)}\n`);
  await writeFile(`${options.outputBase}.md`, renderMd(report));
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
