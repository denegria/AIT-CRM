function sourceClassificationText(primary, secondary) {
  const leadText = String(primary || '').toLowerCase();
  // Explicit opportunity lineage wins over older contact-level import labels.
  if (/retarget|mis[-_ ]?318|roster manifest|student roster|roster import|facebook|leadgen|messenger|website|web form|wix|wordpress/.test(leadText)) return leadText;
  return `${leadText} ${String(secondary || '').toLowerCase()}`;
}

export function sourceLabel(lead = {}, contact = null) {
  const raw = sourceClassificationText(`${lead.sourceName || ''} ${lead.sourceType || ''}`, contact?.sourceLabel);
  if (!raw.trim()) return 'Manual / unknown';
  if (/retarget/.test(raw)) return 'Retargeted student records';
  if (/mis[-_ ]?318|roster manifest|student roster|roster import/.test(raw)) return 'Imported student records';
  if (/messenger/.test(raw)) return 'Facebook Messenger';
  if (/facebook|leadgen/.test(raw)) return 'Facebook lead ads';
  if (/website|web form|wix|wordpress/.test(raw)) return 'Website form';
  if (/workbook|xlsx|spreadsheet|archive|interesados|ait signs/.test(raw)) return 'Workbook import';
  return lead.sourceName || lead.sourceType || contact?.sourceLabel || 'Other source';
}

export function sourceCategoryForContact({ source = '', sourceLabel = '', workflowKey = '' } = {}) {
  const text = sourceClassificationText(source, sourceLabel).trim();
  if (/retarget/.test(text)) return 'Retargeted student records';
  if (/mis[-_ ]?318|roster manifest|student roster|roster import/.test(text)) return 'Imported student records';
  if (/facebook messenger|facebook_messenger|messenger/.test(text)) return 'Facebook Messenger';
  if (/facebook lead ads|facebook ads|facebook_lead_ads|facebook_webhook|facebook webhook|leadgen/.test(text)) return 'Facebook Lead Ads';
  if (/website|web form|wix|wordpress/.test(text)) return 'Website Form Submission';
  if (workflowKey === 'ait_signs' || /workbook|xlsx|spreadsheet|archive|work_order|estimate|interesados|ait signs/.test(text)) return 'Workbook Import';
  if (!text) return 'Manual / Unknown';
  return 'Other Source';
}

export function reportCoordinatorOptions(ownerRows = [], visibleIds = new Set()) {
  return ownerRows
    .filter((row) => row.accountType === 'employee' && visibleIds.has(row.id))
    .map((row) => ({ id: row.id, name: row.name || row.email }));
}

export function reportCoordinatorGroupLabel(owner, fallback = 'Unassigned') {
  return owner?.accountType === 'qa' ? 'Internal QA ownership' : (fallback || 'Unassigned');
}
