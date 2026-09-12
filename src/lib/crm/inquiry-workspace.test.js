import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultInquiryId, inquiryWorkspaceItem } from './inquiry-workspace.js';

test('inquiry workspace projection whitelists exact CRM fields and defaults active before closed history', () => {
  const closed = inquiryWorkspaceItem({ lead: { id: 'closed', status: 'Not Interested', sourceName: 'Referral', createdAt: '2026-01-01', originalNotes: 'private' } });
  const active = inquiryWorkspaceItem({ lead: { id: 'active', status: 'Follow Up', isActive: true, sourceName: 'Web', profileDetails: 'private' } });
  assert.equal(defaultInquiryId([closed, active]), 'active');
  assert.deepEqual(Object.keys(active).sort(), ['editable', 'id', 'isActive', 'lastActivityAt', 'openedAt', 'owner', 'placement', 'program', 'source', 'status', 'updatedAt']);
  assert.equal(JSON.stringify(active).includes('profileDetails'), false);
  assert.equal(JSON.stringify(closed).includes('originalNotes'), false);
});

test('inquiry workspace projection keeps a placement action opaque and never serializes review evidence', () => {
  const item = inquiryWorkspaceItem({
    lead: { id: 'inquiry-a', status: 'Follow Up' },
    placement: { state: 'In review', updatedAt: '2026-09-12T10:00:00.000Z', reviewPath: '/employee/placement-reviews?review=opaque-1', rationale: 'forbidden', rawAnswers: ['forbidden'] },
  });
  assert.deepEqual(item.placement, { state: 'In review', finalLevel: '', finalStatus: '', updatedAt: '2026-09-12T10:00:00.000Z', reviewPath: '/employee/placement-reviews?review=opaque-1' });
  assert.equal(JSON.stringify(item).includes('rationale'), false);
  assert.equal(JSON.stringify(item).includes('rawAnswers'), false);
});
