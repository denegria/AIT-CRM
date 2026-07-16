function clean(value = '') {
  return String(value || '').trim();
}

function latestTime(...values) {
  return values.reduce((latest, value) => {
    const time = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
}

export function latestStructuredFollowUpAt(events = []) {
  const latest = events.reduce((latestTimestamp, event) => {
    if (!/^follow_up\.[a-z_]+$/i.test(clean(event.eventType))) return latestTimestamp;
    return Math.max(latestTimestamp, latestTime(event.occurredAt, event.createdAt));
  }, 0);
  return latest ? new Date(latest).toISOString() : '';
}
