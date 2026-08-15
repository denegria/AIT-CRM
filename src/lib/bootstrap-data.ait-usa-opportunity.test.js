import assert from 'node:assert/strict';
import test from 'node:test';
import { mapContacts } from './bootstrap-data.js';

const contact = Object.freeze({
  id: 'contact-1',
  organizationId: 'org-1',
  primaryBusinessUnitId: 'bu-usa',
  name: 'Ana Student',
  createdAt: new Date('2026-08-13T12:00:00Z'),
});
const aitUsa = Object.freeze({ id: 'bu-usa', name: 'AIT USA Institute' });

test('bootstrap Contact payload binds active-older AIT USA Opportunity over closed-newer history', () => {
  const [payload] = mapContacts(
    [contact],
    [
      { id: 'closed-newer', contactId: contact.id, businessUnitId: aitUsa.id, status: 'Not Interested', currentStage: 'Not Interested', createdAt: new Date('2026-08-15T12:00:00Z') },
      { id: 'active-older', contactId: contact.id, businessUnitId: aitUsa.id, status: 'Follow Up', currentStage: 'Follow Up', assignedUserId: 'owner-active', currentCourse: 'HVAC', createdAt: new Date('2026-08-14T12:00:00Z') },
    ],
    [],
    [],
    [aitUsa],
  );
  assert.equal(payload.opportunityId, 'active-older');
  assert.equal(payload.status, 'Follow Up');
  assert.equal(payload.assignedTo, 'owner-active');
  assert.equal(payload.courseMetadata.currentCourse, 'HVAC');
  assert.equal(payload.opportunityConflict, false);
  assert.equal(payload.activeOpportunityCount, 1);
});

test('bootstrap Contact payload marks multiple active AIT USA Opportunities as a conflict', () => {
  const [payload] = mapContacts(
    [contact],
    [
      { id: 'active-newer', contactId: contact.id, businessUnitId: aitUsa.id, status: 'Follow Up', createdAt: new Date('2026-08-15T12:00:00Z') },
      { id: 'active-older', contactId: contact.id, businessUnitId: aitUsa.id, status: 'New Lead', createdAt: new Date('2026-08-14T12:00:00Z') },
    ],
    [],
    [],
    [aitUsa],
  );
  assert.equal(payload.opportunityConflict, true);
  assert.equal(payload.activeOpportunityCount, 2);
});

test('AIT Signs bootstrap preserves newest-Lead selection regardless of AIT USA lifecycle rules', () => {
  const signsContact = { ...contact, primaryBusinessUnitId: 'bu-signs' };
  const [payload] = mapContacts(
    [signsContact],
    [
      { id: 'signs-newer', contactId: contact.id, businessUnitId: 'bu-signs', status: 'Completed', createdAt: new Date('2026-08-15T12:00:00Z') },
      { id: 'signs-older', contactId: contact.id, businessUnitId: 'bu-signs', status: 'Intake', createdAt: new Date('2026-08-14T12:00:00Z') },
    ],
    [],
    [],
    [{ id: 'bu-signs', name: 'AIT Signs' }],
  );
  assert.equal(payload.opportunityId, 'signs-newer');
  assert.equal(payload.opportunityConflict, false);
  assert.equal(payload.activeOpportunityCount, 0);
});
