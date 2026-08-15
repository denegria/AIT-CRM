import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContactProfilePatch,
  hasOpportunityMutationRequest,
} from './contact-profile-patch.js';

const fullEditForm = Object.freeze({
  id: 'contact-1',
  name: 'Updated name',
  phone: '555-0100',
  status: 'Follow Up',
  currentStage: 'Follow Up',
  opportunityId: 'active-older',
  assignedTo: 'owner-1',
  source: 'Website',
  businessUnitId: 'bu-usa',
  primaryBusinessUnitId: 'bu-usa',
  leadProfile: { programInterest: 'HVAC' },
  courseMetadata: { currentCourse: 'HVAC' },
  programInterest: 'HVAC',
  preferredDay: 'Monday',
  preferredSchedule: 'Evening',
  testInterest: 'EPA',
  educationLevel: 'High school',
  schoolName: 'AIT USA',
  locationPreference: 'Plainfield',
  profileDetails: 'Full bootstrap payload field',
  sourceDetail: 'Facebook form',
  currentCourse: 'HVAC',
  completedCourse: 'Electrical',
  endedCourse: 'Plumbing',
  courseOutcome: 'Completed',
});

test('AIT USA conflict serializes an unrelated Contact edit without Opportunity mutation fields', () => {
  const patch = buildContactProfilePatch({
    editForm: fullEditForm,
    contact: { hasLeadStatus: true, opportunityConflict: true },
    isAitUsa: true,
    lockedOwnerUserId: 'owner-locked',
  });
  assert.equal(patch.name, 'Updated name');
  assert.equal(patch.phone, '555-0100');
  assert.equal(patch.opportunityId, 'active-older');
  for (const field of [
    'status', 'currentStage', 'assignedTo', 'source', 'businessUnitId', 'primaryBusinessUnitId',
    'leadProfile', 'courseMetadata', 'programInterest', 'preferredDay', 'preferredSchedule',
    'testInterest', 'educationLevel', 'schoolName', 'locationPreference', 'profileDetails',
    'sourceDetail', 'currentCourse', 'completedCourse', 'endedCourse', 'courseOutcome',
  ]) {
    assert.equal(Object.hasOwn(patch, field), false, `${field} must not be serialized`);
  }
  assert.equal(hasOpportunityMutationRequest(patch), false);
});

test('AIT Signs preserves its legacy lifecycle, owner, source, and business-unit patch fields', () => {
  const patch = buildContactProfilePatch({
    editForm: fullEditForm,
    contact: { hasLeadStatus: true, opportunityConflict: false },
    isAitUsa: false,
    lockedOwnerUserId: 'owner-locked',
  });
  assert.equal(patch.status, 'Follow Up');
  assert.equal(patch.assignedTo, 'owner-locked');
  assert.equal(patch.source, 'Website');
  assert.equal(patch.businessUnitId, 'bu-usa');
  assert.deepEqual(patch.leadProfile, { programInterest: 'HVAC' });
});
