const SUCCESSFUL_CONTACT_EVENTS = new Set(['follow_up.reached_interested', 'follow_up.reached_not_interested']);
const ENROLLMENT_STATUSES = new Set(['enrolled', 'matriculated', 'registered']);

function dateValue(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }

export function successfulContactEvent(event, asOf = new Date()) {
  const occurredAt = dateValue(event?.occurredAt || event?.createdAt);
  const eventType = String(event?.eventType || '').toLowerCase();
  const outcome = String(event?.metadataJson?.outcome || '').toLowerCase();
  const affirmative = SUCCESSFUL_CONTACT_EVENTS.has(eventType) || (eventType === 'ait_usa.follow_up' && ['reached_interested', 'reached_not_interested'].includes(outcome));
  return affirmative && Boolean(occurredAt && occurredAt <= asOf);
}

export function enrollmentStatusEvidence(row, asOf = new Date()) {
  const occurredAt = dateValue(row?.occurredAt || row?.createdAt);
  return ENROLLMENT_STATUSES.has(String(row?.toStatus || '').trim().toLowerCase()) && Boolean(occurredAt && occurredAt <= asOf);
}
