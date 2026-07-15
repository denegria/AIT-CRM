function clean(value = '') {
  return String(value || '').trim();
}

function firstPresent(values = []) {
  return values.map(clean).find(Boolean) || '';
}

function contactTouchDate(contact = {}) {
  return firstPresent([
    contact.lastTouch,
    contact.lastContact,
    contact.lastEdited,
    contact.sourceActivityDate,
  ]);
}

function sourceValue(contact = {}) {
  return firstPresent([
    contact.inquirySource,
    contact.sourceCategoryText,
    contact.sourceLabel,
    contact.source,
  ]) || 'Unknown Source';
}

function dayKey(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysSince(value, now = new Date()) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((dayKey(now) - dayKey(date)) / 86400000));
}

export function mobilePipelineOwnerLabel(contact = {}) {
  const label = clean(contact.assignedLabel);
  if (label) return label;
  return clean(contact.assignedTo) ? 'Assigned user' : 'Unassigned';
}

export function mobilePipelineSourceLabel(contact = {}) {
  return sourceValue(contact);
}

export function mobilePipelineTouchContext(contact = {}, now = new Date()) {
  const rawTouch = contactTouchDate(contact);
  if (!rawTouch) {
    return {
      label: 'No touch recorded',
      tone: 'stale',
    };
  }

  const age = daysSince(rawTouch, now);
  if (!Number.isFinite(age)) {
    return {
      label: `Last touch ${rawTouch}`,
      tone: 'neutral',
    };
  }

  if (age === 0) {
    return {
      label: 'Touched today',
      tone: 'recent',
    };
  }

  if (age === 1) {
    return {
      label: 'Touched yesterday',
      tone: 'recent',
    };
  }

  return {
    label: age > 30 ? `Stale ${age}d` : `Touched ${age}d ago`,
    tone: age > 30 ? 'stale' : 'neutral',
  };
}

export function mobilePipelineTriageItems(contact = {}, now = new Date()) {
  const touch = mobilePipelineTouchContext(contact, now);
  return [
    {
      label: 'Owner',
      value: mobilePipelineOwnerLabel(contact),
      tone: mobilePipelineOwnerLabel(contact) === 'Unassigned' ? 'stale' : 'neutral',
    },
    {
      label: 'Source',
      value: mobilePipelineSourceLabel(contact),
      tone: mobilePipelineSourceLabel(contact) === 'Unknown Source' ? 'stale' : 'neutral',
    },
    {
      label: 'Touch',
      value: touch.label,
      tone: touch.tone,
    },
  ];
}
