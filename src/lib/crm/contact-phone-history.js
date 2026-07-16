import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { activityEvents, contactPhoneNumbers, contacts } from '../../db/schema.js';

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function dateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Phone history timestamps must be valid dates.');
  return date;
}

function sameDate(left, right) {
  const leftTime = left ? new Date(left).getTime() : null;
  const rightTime = right ? new Date(right).getTime() : null;
  return leftTime === rightTime;
}

function sameObject(left, right) {
  return JSON.stringify(cleanObject(left)) === JSON.stringify(cleanObject(right));
}

export function normalizeContactPhone(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const digits = text.replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function contactPhoneIdentityKey(contactId, phone) {
  const normalizedPhone = normalizeContactPhone(phone);
  return contactId && normalizedPhone ? `${contactId}:${normalizedPhone}` : '';
}

export function contactPhoneHistoryInput(payload = {}) {
  const phone = cleanText(payload.phone);
  const normalizedPhone = normalizeContactPhone(payload.normalizedPhone || phone);
  if (!phone || !normalizedPhone) throw new Error('A valid phone number is required.');
  return {
    phone,
    normalizedPhone,
    isPrimary: Boolean(payload.isPrimary),
    isDoNotCall: Boolean(payload.isDoNotCall),
    isWrongNumber: Boolean(payload.isWrongNumber),
    channelConsentJson: cleanObject(payload.channelConsentJson),
    sourceType: cleanText(payload.sourceType) || null,
    sourceReference: cleanText(payload.sourceReference) || null,
    observedAt: dateValue(payload.observedAt),
    effectiveAt: dateValue(payload.effectiveAt),
    retiredAt: payload.isPrimary ? null : dateValue(payload.retiredAt),
    metadataJson: cleanObject(payload.metadataJson),
  };
}

export function contactPhoneHistoryPayload(row = {}) {
  return {
    id: row.id || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    phone: row.phone || '',
    normalizedPhone: row.normalizedPhone || '',
    isPrimary: Boolean(row.isPrimary),
    isDoNotCall: Boolean(row.isDoNotCall),
    isWrongNumber: Boolean(row.isWrongNumber),
    channelConsent: cleanObject(row.channelConsentJson),
    sourceType: row.sourceType || '',
    sourceReference: row.sourceReference || '',
    observedAt: row.observedAt?.toISOString?.() || row.observedAt || '',
    effectiveAt: row.effectiveAt?.toISOString?.() || row.effectiveAt || '',
    retiredAt: row.retiredAt?.toISOString?.() || row.retiredAt || '',
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || '',
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || '',
  };
}

export function planContactPhoneHistoryUpsert(existing, incoming) {
  if (!existing) return { action: 'insert', patch: incoming };
  const patch = {};
  for (const key of ['phone', 'isPrimary', 'isDoNotCall', 'isWrongNumber', 'sourceType', 'sourceReference']) {
    if ((existing[key] ?? null) !== (incoming[key] ?? null)) patch[key] = incoming[key];
  }
  for (const key of ['observedAt', 'effectiveAt', 'retiredAt']) {
    if (!sameDate(existing[key], incoming[key])) patch[key] = incoming[key];
  }
  for (const key of ['channelConsentJson', 'metadataJson']) {
    if (!sameObject(existing[key], incoming[key])) patch[key] = incoming[key];
  }
  return Object.keys(patch).length
    ? { action: 'update', patch }
    : { action: 'unchanged', patch: {} };
}

export async function listContactPhoneHistory({ db, organizationId, contactId }) {
  const rows = await db
    .select()
    .from(contactPhoneNumbers)
    .where(and(
      eq(contactPhoneNumbers.organizationId, organizationId),
      eq(contactPhoneNumbers.contactId, contactId),
    ))
    .orderBy(desc(contactPhoneNumbers.isPrimary), desc(contactPhoneNumbers.effectiveAt), desc(contactPhoneNumbers.observedAt), asc(contactPhoneNumbers.createdAt));
  return rows.map(contactPhoneHistoryPayload);
}

async function auditPhoneHistoryChange({
  tx,
  organizationId,
  businessUnitId,
  contactId,
  actorUserId,
  row,
  action,
}) {
  await tx.insert(activityEvents).values({
    organizationId,
    businessUnitId: businessUnitId || null,
    contactId,
    eventType: row.isPrimary ? 'contact.phone.primary_changed' : `contact.phone_history.${action}`,
    message: row.isPrimary ? 'Updated the primary Contact phone.' : 'Recorded Contact phone history.',
    metadataJson: {
      phoneNumberId: row.id,
      normalizedPhone: row.normalizedPhone,
      lastFour: row.normalizedPhone.slice(-4),
      isPrimary: Boolean(row.isPrimary),
      isDoNotCall: Boolean(row.isDoNotCall),
      isWrongNumber: Boolean(row.isWrongNumber),
      sourceType: row.sourceType || '',
      sourceReference: row.sourceReference || '',
    },
    actorUserId: actorUserId || null,
    occurredAt: row.observedAt || row.effectiveAt || new Date(),
  });
}

export async function upsertContactPhoneHistory({
  tx,
  organizationId,
  businessUnitId = null,
  contactId,
  actorUserId = null,
  payload,
}) {
  if (!tx || !organizationId || !contactId) {
    throw new Error('Phone history writes require an explicit transaction, organization, and Contact.');
  }
  const incoming = contactPhoneHistoryInput(payload);
  const [contact] = await tx
    .select({
      id: contacts.id,
      phone: contacts.phone,
      isDoNotCall: contacts.isDoNotCall,
      isWrongNumber: contacts.isWrongNumber,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!contact) throw new Error('Contact not found for phone history write.');

  const [existing] = await tx
    .select()
    .from(contactPhoneNumbers)
    .where(and(
      eq(contactPhoneNumbers.organizationId, organizationId),
      eq(contactPhoneNumbers.contactId, contactId),
      eq(contactPhoneNumbers.normalizedPhone, incoming.normalizedPhone),
    ))
    .limit(1);

  if (incoming.isPrimary) {
    await tx
      .update(contactPhoneNumbers)
      .set({ isPrimary: false, retiredAt: incoming.effectiveAt || incoming.observedAt || new Date(), updatedAt: new Date() })
      .where(and(
        eq(contactPhoneNumbers.organizationId, organizationId),
        eq(contactPhoneNumbers.contactId, contactId),
        eq(contactPhoneNumbers.isPrimary, true),
        ne(contactPhoneNumbers.normalizedPhone, incoming.normalizedPhone),
      ));
  }

  const plan = planContactPhoneHistoryUpsert(existing, incoming);
  let row = existing;
  if (plan.action === 'insert') {
    [row] = await tx.insert(contactPhoneNumbers).values({
      organizationId,
      businessUnitId,
      contactId,
      createdByUserId: actorUserId,
      ...incoming,
    }).returning();
  } else if (plan.action === 'update') {
    [row] = await tx
      .update(contactPhoneNumbers)
      .set({
        ...plan.patch,
        ...(businessUnitId ? { businessUnitId } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(contactPhoneNumbers.id, existing.id),
        eq(contactPhoneNumbers.organizationId, organizationId),
        eq(contactPhoneNumbers.contactId, contactId),
      ))
      .returning();
  }

  let primaryContactChanged = false;
  if (incoming.isPrimary) {
    const contactPatch = {};
    if (contact.phone !== incoming.phone) contactPatch.phone = incoming.phone;
    if (contact.isDoNotCall !== incoming.isDoNotCall) contactPatch.isDoNotCall = incoming.isDoNotCall;
    if (contact.isWrongNumber !== incoming.isWrongNumber) contactPatch.isWrongNumber = incoming.isWrongNumber;
    if (Object.keys(contactPatch).length) {
      primaryContactChanged = true;
      await tx
        .update(contacts)
        .set({ ...contactPatch, updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
    }
  }

  if (plan.action !== 'unchanged' || primaryContactChanged) {
    await auditPhoneHistoryChange({
      tx,
      organizationId,
      businessUnitId,
      contactId,
      actorUserId,
      row: { ...row, ...incoming },
      action: plan.action === 'unchanged' ? 'updated' : plan.action,
    });
  }

  return {
    action: plan.action,
    primaryContactChanged,
    phone: contactPhoneHistoryPayload({ ...row, ...incoming }),
  };
}
