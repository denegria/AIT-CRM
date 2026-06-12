import assert from 'node:assert/strict';
import test from 'node:test';
import { updateContactWithLeadAndNotes } from './write-helpers.js';

function returningChain(value) {
  return {
    set() {
      return this;
    },
    where() {
      return this;
    },
    returning() {
      return Promise.resolve(value);
    },
  };
}

function selectChain(value) {
  return {
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return Promise.resolve(value);
    },
  };
}

test('updateContactWithLeadAndNotes writes follow-up note activity events', async () => {
  const insertedValues = [];
  const contact = {
    id: 'contact-1',
    organizationId: 'org-1',
    primaryBusinessUnitId: 'bu-ait-usa',
  };
  const lead = {
    id: 'lead-1',
    businessUnitId: 'bu-ait-usa',
    contactId: 'contact-1',
  };
  const occurredAt = new Date('2026-06-12T05:00:00.000Z');
  const tx = {
    update() {
      return returningChain([contact]);
    },
    select() {
      return selectChain([]);
    },
    insert() {
      return {
        values(value) {
          insertedValues.push(value);
          return {
            returning() {
              return Promise.resolve([{ id: 'event-1', ...value }]);
            },
          };
        },
      };
    },
  };
  const db = {
    transaction(callback) {
      return callback(tx);
    },
  };

  const result = await updateContactWithLeadAndNotes({
    db,
    organizationId: 'org-1',
    actorUserId: 'user-1',
    contactId: 'contact-1',
    contactPatch: { updatedAt: occurredAt },
    existingLead: lead,
    addFollowUpNote: {
      body: 'Called and left a voicemail.',
      occurredAt,
    },
  });

  assert.equal(insertedValues.length, 1);
  assert.equal(insertedValues[0].eventType, 'ait_usa.follow_up');
  assert.equal(insertedValues[0].message, 'Called and left a voicemail.');
  assert.equal(insertedValues[0].contactId, 'contact-1');
  assert.equal(insertedValues[0].leadId, 'lead-1');
  assert.equal(insertedValues[0].occurredAt, occurredAt);
  assert.equal(result.createdActivityEvents[0].eventType, 'ait_usa.follow_up');
});
