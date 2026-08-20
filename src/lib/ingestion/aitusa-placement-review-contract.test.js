import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { validateAitUsaCrmEvent } from './aitusa-crm-events.js';

const frontendRoot = process.env.AITUSA_PLACEMENT_REVIEW_REPO
  || '/root/.openclaw/giuseppe-workspace/.worktrees/aitusa-mis-395-397';
const fixturePath = path.join(frontendRoot, 'docs/fixtures/aitusa-placement-review-crm-envelope-v1.json');
const validatorPath = path.join(frontendRoot, 'src/placementReview/crmEnvelope.js');

test('canonical AIT USA placement-review fixture passes both frontend and CRM validation', {
  skip: !existsSync(fixturePath) || !existsSync(validatorPath),
}, async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const frontend = await import(pathToFileURL(validatorPath).href);
  assert.equal(frontend.validatePlacementReviewCrmEnvelope(fixture).ok, true);
  assert.equal(validateAitUsaCrmEvent(fixture).ok, true);
  const states = {
    placement_review_created: 'pending',
    placement_review_started: 'in_review',
    placement_review_confirmed: 'confirmed',
    placement_review_adjusted: 'adjusted',
    placement_review_additional_review_required: 'additional_review_required',
  };
  for (const [eventType, state] of Object.entries(states)) {
    const envelope = frontend.buildPlacementReviewCrmEnvelope({
      review: {
        id: fixture.placement.reviewId,
        resultId: fixture.placement.resultId,
        attemptId: fixture.placement.attemptId,
        correlationId: fixture.correlationId,
        revision: 2,
        status: state,
        finalLevel: ['confirmed', 'adjusted'].includes(state) ? fixture.placement.finalLevel : null,
      },
      eventType,
      occurredAt: fixture.occurredAt,
      consent: fixture.consent,
    });
    assert.equal(envelope.placement.state, state);
    assert.equal(frontend.validatePlacementReviewCrmEnvelope(envelope).ok, true);
    assert.equal(validateAitUsaCrmEvent(envelope).ok, true);
  }
});
