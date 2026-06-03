function sourceKey(row = {}) {
  if (!row.sourceRow) return '';
  return [String(row.sourceSheet || '').trim().toLowerCase(), row.sourceRow].join(':');
}

function contactIdLookup(rows = []) {
  return new Map(
    (rows || [])
      .filter((row) => row.id && row.contactId)
      .map((row) => [row.id, row.contactId]),
  );
}

export function attachPaymentSnapshotContactLinks(
  paymentRows = [],
  eventRows = [],
  { estimateRows = [], workOrderRows = [] } = {},
) {
  const contactIdsBySource = new Map();
  for (const event of eventRows || []) {
    const key = sourceKey(event);
    if (!key || !event.contactId) continue;
    const contactIds = contactIdsBySource.get(key) || new Set();
    contactIds.add(event.contactId);
    contactIdsBySource.set(key, contactIds);
  }
  const contactIdByEstimateId = contactIdLookup(estimateRows);
  const contactIdByWorkOrderId = contactIdLookup(workOrderRows);

  return (paymentRows || []).map((row) => {
    if (row.contactId) return row;
    const contactIds = new Set();
    for (const contactId of contactIdsBySource.get(sourceKey(row)) || []) contactIds.add(contactId);
    if (contactIdByEstimateId.has(row.estimateId)) contactIds.add(contactIdByEstimateId.get(row.estimateId));
    if (contactIdByWorkOrderId.has(row.workOrderId)) contactIds.add(contactIdByWorkOrderId.get(row.workOrderId));
    if (contactIds.size !== 1) return row;
    return {
      ...row,
      contactId: [...contactIds][0],
    };
  });
}
