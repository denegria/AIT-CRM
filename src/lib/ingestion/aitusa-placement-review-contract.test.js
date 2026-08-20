import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateAitUsaCrmEvent } from './aitusa-crm-events.js';

const envelopeFixtureUrl = new URL('../../../docs/fixtures/aitusa-placement-review-crm-envelope-v1.json', import.meta.url);
const orderingFixtureUrl = new URL('../../../docs/fixtures/aitusa-placement-review-crm-events-out-of-order-v1.json', import.meta.url);
const provenanceUrl = new URL('../../../docs/fixtures/aitusa-placement-review-crm-envelope-v1.provenance.json', import.meta.url);

const CANONICAL_STATE_MAP = Object.freeze({
  placement_review_created: 'pending',
  placement_review_started: 'in_review',
  placement_review_confirmed: 'confirmed',
  placement_review_adjusted: 'adjusted',
  placement_review_additional_review_required: 'additional_review_required',
});

async function canonicalFixture() {
  const raw = await readFile(envelopeFixtureUrl);
  return { raw, event: JSON.parse(raw.toString('utf8')) };
}

test('vendored AIT USA placement-review fixture is present, provenance-pinned, and CRM-valid', async () => {
  const [{ raw, event }, provenance] = await Promise.all([
    canonicalFixture(),
    readFile(provenanceUrl, 'utf8').then(JSON.parse),
  ]);
  assert.equal(provenance.fixture, 'aitusa-placement-review-crm-envelope-v1.json');
  assert.equal(provenance.schemaVersion, 'aitusa-crm-event-v1');
  assert.equal(provenance.owner, 'AIT USA Institute Refresh');
  assert.equal(provenance.sourceRepository, 'aitusa-institute-refresh');
  assert.equal(provenance.sourcePath, 'docs/fixtures/aitusa-placement-review-crm-envelope-v1.json');
  assert.match(provenance.sourceCommit, /^[0-9a-f]{7,40}$/);
  assert.equal(createHash('sha256').update(raw).digest('hex'), provenance.sha256);
  assert.equal(validateAitUsaCrmEvent(event).ok, true);
  assert.equal(event.placement.revision, 3);
  assert.match(event.consent.sourceUrl, /^\/(?:[A-Za-z0-9_-]+\/?)*$/);
});

test('canonical placement-review state map and final-level constraints stay compatible with the vendored producer fixture', async () => {
  const { event: fixture } = await canonicalFixture();
  for (const [eventType, state] of Object.entries(CANONICAL_STATE_MAP)) {
    const envelope = structuredClone(fixture);
    envelope.eventType = eventType;
    envelope.placement.state = state;
    const expectedKey = `placement-review:${envelope.placement.reviewId}:revision:${envelope.placement.revision}:${eventType}`;
    envelope.eventId = expectedKey;
    envelope.idempotencyKey = expectedKey;
    if (state === 'confirmed' || state === 'adjusted') envelope.placement.finalLevel = fixture.placement.finalLevel;
    else delete envelope.placement.finalLevel;
    assert.equal(validateAitUsaCrmEvent(envelope).ok, true, eventType);
  }
  const tooLongFinalLevel = structuredClone(fixture);
  tooLongFinalLevel.placement.finalLevel = 'x'.repeat(121);
  assert.equal(validateAitUsaCrmEvent(tooLongFinalLevel).ok, false);
});

test('vendored producer ordering fixture remains valid for out-of-order review delivery', async () => {
  const events = JSON.parse(await readFile(orderingFixtureUrl, 'utf8'));
  assert.equal(Array.isArray(events), true);
  assert.deepEqual(events.map((event) => event.placement.revision), [3, 2]);
  for (const event of events) assert.equal(validateAitUsaCrmEvent(event).ok, true);
});
