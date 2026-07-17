import crypto from 'node:crypto';

const SUPPORTED_LANES = new Set(['inactive', 'active']);

function cleanText(value = '') {
  return String(value || '').trim();
}

function usablePhone(value = '') {
  const raw = cleanText(value).replace(/\D+/g, '');
  const digits = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
  return digits.length >= 10 && digits.length <= 13;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalManifestJson(value) {
  return JSON.stringify(sortValue(value));
}

export function manifestContentSha256(manifest) {
  const payload = { ...manifest };
  delete payload.contentSha256;
  return crypto.createHash('sha256').update(canonicalManifestJson(payload)).digest('hex');
}

export function deterministicImportUuid(key) {
  const hex = crypto.createHash('sha256').update(cleanText(key)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertCount(actual, expected, label) {
  if (Number(expected) !== actual) {
    throw new Error(`Manifest count mismatch for ${label}: expected ${expected}, received ${actual}.`);
  }
}

export function validateRosterManifest(manifest, { now = new Date(), maxAgeMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Roster manifest must be an object.');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported roster manifest schema version.');
  if (manifest.lane === 'attendance') throw new Error('Attendance manifests are explicitly unsupported.');
  if (!SUPPORTED_LANES.has(manifest.lane)) throw new Error('Roster manifest lane is not supported.');
  if (!cleanText(manifest.manifestId)) throw new Error('Roster manifest id is required.');
  if (manifest.approvalState !== 'held') throw new Error('Roster manifest must remain held; approval is supplied separately.');
  if (manifest.sequence?.attendanceSupported !== false) throw new Error('Roster manifests must explicitly exclude attendance.');
  const generatedAt = new Date(manifest.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Roster manifest generatedAt is invalid.');
  if (now.getTime() - generatedAt.getTime() > maxAgeMs) throw new Error('Roster manifest is stale and must be regenerated.');
  const expectedHash = manifestContentSha256(manifest);
  if (!/^[a-f0-9]{64}$/.test(cleanText(manifest.contentSha256)) || manifest.contentSha256 !== expectedHash) {
    throw new Error('Roster manifest content hash does not match.');
  }

  const contactActions = Array.isArray(manifest.contactActions) ? manifest.contactActions : [];
  const classSectionActions = Array.isArray(manifest.classSectionActions) ? manifest.classSectionActions : [];
  const courseActions = Array.isArray(manifest.courseActions) ? manifest.courseActions : [];
  const allActions = [...contactActions, ...classSectionActions, ...courseActions];
  const keys = allActions.map((row) => cleanText(row.idempotencyKey));
  if (keys.some((key) => !key)) throw new Error('Every roster action needs an idempotency key.');
  if (new Set(keys).size !== keys.length) throw new Error('Roster action idempotency keys must be unique.');
  if (keys.some((key) => !key.startsWith(`mis-318:${manifest.lane}:`))) {
    throw new Error('Roster action idempotency key is outside the manifest lane.');
  }

  const counts = manifest.expectedCounts || {};
  assertCount(contactActions.length, counts.contacts, 'contacts');
  if (manifest.lane === 'inactive') {
    assertCount(courseActions.length, counts.courses, 'courses');
    assertCount(contactActions.filter((row) => !cleanText(row.final_contact_action).startsWith('defer')).length, counts.resolvedContacts, 'resolvedContacts');
    assertCount(contactActions.filter((row) => cleanText(row.final_contact_action).startsWith('defer')).length, counts.deferredContacts, 'deferredContacts');
    const actionableContacts = contactActions.filter((row) => !cleanText(row.final_contact_action).startsWith('defer'));
    if (actionableContacts.some((row) => cleanText(row.primary_phone_policy) !== 'inactive_workbook_authoritative')) {
      throw new Error('Every actionable inactive Contact must declare the workbook phone as authoritative primary.');
    }
    if (actionableContacts.some((row) => cleanText(row.phone_history_policy) !== 'preserve_all_other_valid_numbers')) {
      throw new Error('Every actionable inactive Contact must preserve all other valid numbers as phone history.');
    }
    if (actionableContacts.some((row) => !usablePhone(row.primary_phone))) {
      throw new Error('Every actionable inactive Contact must have a usable authoritative primary phone.');
    }
    if (actionableContacts.some((row) => cleanText(row.historical_phone_options).split(';').filter(Boolean).some((phone) => !usablePhone(phone)))) {
      throw new Error('Inactive Contact phone history may contain only usable phone numbers.');
    }
  } else {
    assertCount(courseActions.length, counts.enrollments, 'enrollments');
    assertCount(classSectionActions.length, counts.classSections, 'classSections');
    if (manifest.sequence?.afterLane !== 'inactive' || !/^[a-f0-9]{64}$/.test(cleanText(manifest.sequence?.requiredPriorManifestSha256))) {
      throw new Error('Active manifest must depend on the approved inactive manifest hash.');
    }
  }
  return manifest;
}

function approvalMessage(approval) {
  return [approval.manifestId, approval.manifestSha256, approval.approvedAt, approval.expiresAt, approval.approvalRef].join('\n');
}

export function signRosterManifestApproval(approval, secret) {
  if (!cleanText(secret)) throw new Error('Manifest approval secret is required.');
  return crypto.createHmac('sha256', secret).update(approvalMessage(approval)).digest('hex');
}

export function validateRosterManifestApproval(manifest, approval, secret, { now = new Date() } = {}) {
  if (!approval || approval.manifestId !== manifest.manifestId || approval.manifestSha256 !== manifest.contentSha256) {
    throw new Error('Approval does not match this roster manifest.');
  }
  if (!cleanText(approval.approvalRef)) throw new Error('Approval reference is required.');
  const approvedAt = new Date(approval.approvedAt);
  const expiresAt = new Date(approval.expiresAt);
  if (Number.isNaN(approvedAt.getTime()) || Number.isNaN(expiresAt.getTime())) throw new Error('Approval timestamps are invalid.');
  if (approvedAt.getTime() > now.getTime() || expiresAt.getTime() <= now.getTime()) throw new Error('Roster manifest approval is not currently valid.');
  const expected = signRosterManifestApproval(approval, secret);
  const received = cleanText(approval.signature);
  if (!/^[a-f0-9]{64}$/.test(received) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    throw new Error('Roster manifest approval signature is invalid.');
  }
  return approval;
}
