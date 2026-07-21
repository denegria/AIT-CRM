import assert from 'node:assert/strict';
import test from 'node:test';
import { createContactWithLead, updateContactWithLeadAndNotes } from './write-helpers.js';

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
  assert.deepEqual(result.activityEventRows, []);
});

test('createContactWithLead creates an initial note in the contact transaction', async () => {
  const insertedValues = [];
  const contact = { id: 'contact-1', primaryBusinessUnitId: 'bu-ait-usa' };
  const lead = { id: 'lead-1', contactId: 'contact-1', businessUnitId: 'bu-ait-usa' };
  const note = { id: 'note-1', contactId: 'contact-1', body: 'Interested in evening classes.' };
  const returnedRows = [[contact], [lead], [note]];
  const tx = {
    insert() {
      return {
        values(value) {
          const index = insertedValues.push(value) - 1;
          return {
            returning() {
              return Promise.resolve(returnedRows[index]);
            },
          };
        },
      };
    },
  };
  const db = { transaction: (callback) => callback(tx) };

  const result = await createContactWithLead({
    db,
    organizationId: 'org-1',
    actorUserId: 'user-1',
    contactValues: { primaryBusinessUnitId: 'bu-ait-usa', name: 'Maria' },
    leadValues: { businessUnitId: 'bu-ait-usa', status: 'New Lead' },
    initialNote: { body: 'Interested in evening classes.' },
  });

  assert.equal(insertedValues.length, 3);
  assert.deepEqual(insertedValues[2], {
    organizationId: 'org-1',
    businessUnitId: 'bu-ait-usa',
    contactId: 'contact-1',
    body: 'Interested in evening classes.',
    authorUserId: 'user-1',
  });
  assert.deepEqual(result.noteRows, [note]);
});

test('updateContactWithLeadAndNotes appends a regular note without replacing history', async () => {
  const insertedValues = [];
  const deletedTables = [];
  const contact = {
    id: 'contact-1',
    organizationId: 'org-1',
    primaryBusinessUnitId: 'bu-ait-usa',
  };
  const existingNote = { id: 'existing-note', body: 'Existing history.' };
  let selectCalls = 0;
  const tx = {
    update() {
      return returningChain([contact]);
    },
    select() {
      selectCalls += 1;
      return selectChain(selectCalls === 1 ? [existingNote] : []);
    },
    delete(table) {
      deletedTables.push(table);
      return {
        where() {
          return Promise.resolve();
        },
      };
    },
    insert() {
      return {
        values(value) {
          insertedValues.push(value);
          return {
            returning() {
              const rows = Array.isArray(value) ? value : [value];
              return Promise.resolve(rows.map((row, index) => ({ id: `row-${index + 1}`, ...row })));
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
    contactPatch: { updatedAt: new Date('2026-06-12T13:33:00.000Z') },
    appendNote: { body: 'Classes Monday, Wednesday, and Friday.' },
  });

  assert.equal(deletedTables.length, 0);
  assert.equal(insertedValues.length, 1);
  assert.equal(insertedValues[0].body, 'Classes Monday, Wednesday, and Friday.');
  assert.deepEqual(result.noteRows.map((row) => row.body), [
    'Classes Monday, Wednesday, and Friday.',
    'Existing history.',
  ]);
  assert.deepEqual(result.activityEventRows, []);
});
