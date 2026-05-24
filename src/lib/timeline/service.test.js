import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContactTimeline,
  filterTimelineRowsForBusinessUnit,
  normalizeTimelineType,
} from './service.js';

test('buildContactTimeline consolidates notes, activity, tasks, messages, and leads', () => {
  const timeline = buildContactTimeline({
    notes: [{
      id: 'note-1',
      contactId: 'contact-1',
      businessUnitId: 'bu-1',
      body: 'Customer wants a monument sign.',
      authorUserId: 'user-1',
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
    }],
    activityEvents: [
      {
        id: 'activity-message-1',
        contactId: 'contact-1',
        leadId: 'lead-1',
        businessUnitId: 'bu-1',
        eventType: 'facebook_messenger_message',
        message: 'Need pricing this week.',
        sourceSheet: 'facebook_messenger',
        sourceRow: 8,
        occurredAt: new Date('2026-05-23T11:00:00.000Z'),
      },
      {
        id: 'activity-task-1',
        contactId: 'contact-1',
        businessUnitId: 'bu-1',
        eventType: 'task.created',
        message: 'Created task Follow up.',
        occurredAt: new Date('2026-05-23T12:00:00.000Z'),
      },
    ],
    tasks: [{
      id: 'task-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      title: 'Follow up',
    }],
    taskEvents: [{
      id: 'task-event-1',
      taskId: 'task-1',
      businessUnitId: 'bu-1',
      eventType: 'created',
      message: 'Created task Follow up.',
      actorUserId: 'user-1',
      occurredAt: new Date('2026-05-23T12:00:00.000Z'),
    }],
    leads: [{
      id: 'lead-1',
      contactId: 'contact-1',
      businessUnitId: 'bu-1',
      sourceType: 'website_form',
      sourceName: 'Website form',
      status: 'New Lead',
      createdAt: new Date('2026-05-23T09:00:00.000Z'),
    }],
    users: [{ id: 'user-1', name: 'Alvaro' }],
    businessUnits: [{ id: 'bu-1', name: 'AIT Signs', label: 'Divisions' }],
  });

  assert.deepEqual(timeline.map((entry) => entry.type), ['task', 'message', 'note', 'lead']);
  assert.equal(timeline.find((entry) => entry.type === 'task').eventType, 'task.created');
  assert.equal(timeline.find((entry) => entry.type === 'message').source.label, 'facebook_messenger');
  assert.equal(timeline.find((entry) => entry.type === 'note').actor.name, 'Alvaro');
  assert.equal(timeline.find((entry) => entry.type === 'lead').businessUnit.name, 'AIT Signs');
});

test('buildContactTimeline filters by normalized event type', () => {
  const timeline = buildContactTimeline({
    notes: [{ id: 'note-1', body: 'Note', createdAt: new Date('2026-05-23T10:00:00.000Z') }],
    activityEvents: [{ id: 'message-1', eventType: 'facebook_messenger_message', message: 'Hello', occurredAt: new Date('2026-05-23T11:00:00.000Z') }],
    type: 'message',
  });

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].type, 'message');
  assert.equal(normalizeTimelineType('unsupported'), '');
});

test('filterTimelineRowsForBusinessUnit preserves unassigned rows and allowed divisions only', () => {
  const scoped = filterTimelineRowsForBusinessUnit([
    { id: 'allowed', businessUnitId: 'bu-1' },
    { id: 'blocked', businessUnitId: 'bu-2' },
    { id: 'unassigned', businessUnitId: null },
  ], ['bu-1']);

  assert.deepEqual(scoped.map((row) => row.id), ['allowed', 'unassigned']);
});
