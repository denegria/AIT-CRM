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
      fromOwnerUserId: null,
      toOwnerUserId: 'user-2',
      occurredAt: new Date('2026-05-23T12:00:00.000Z'),
    }],
    leadStatusHistory: [{
      id: 'lead-status-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      fromStatus: 'Contacted',
      toStatus: 'Qualified',
      actorUserId: 'user-1',
      occurredAt: new Date('2026-05-23T12:30:00.000Z'),
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
    users: [{ id: 'user-1', name: 'Alvaro' }, { id: 'user-2', name: 'Ada' }],
    businessUnits: [{ id: 'bu-1', name: 'AIT Signs', label: 'Divisions' }],
  });

  assert.deepEqual(timeline.map((entry) => entry.type), ['lead', 'task', 'message', 'note', 'lead']);
  assert.equal(timeline[0].eventType, 'lead.status_changed');
  assert.deepEqual(timeline[0].leadStatus, { from: 'Contacted', to: 'Qualified' });
  assert.equal(timeline.find((entry) => entry.type === 'task').eventType, 'task.created');
  assert.equal(timeline.find((entry) => entry.type === 'task').ownerChange.to.name, 'Ada');
  assert.equal(timeline.find((entry) => entry.type === 'message').source.label, 'facebook_messenger');
  assert.equal(timeline.find((entry) => entry.type === 'note').actor.name, 'Alvaro');
  assert.equal(timeline.find((entry) => entry.type === 'lead').businessUnit.name, 'AIT Signs');
  assert.equal(timeline.find((entry) => entry.type === 'task').presentation.category, 'task');
  assert.equal(timeline.find((entry) => entry.type === 'message').presentation.category, 'message');
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

test('buildContactTimeline preserves imported AIT USA follow-up provenance', () => {
  const timeline = buildContactTimeline({
    activityEvents: [{
      id: 'ait-usa-follow-up-1',
      contactId: 'contact-usa-1',
      leadId: 'lead-usa-1',
      businessUnitId: 'bu-ait-usa',
      eventType: 'ait_usa.follow_up',
      message: 'ARIANA 11:52 AM: VOLVER A LLAMAR - HABLARA CON SU ESPOSA PARA VER SI ENTRAN LOS 2 A PRESENCIAL.',
      sourceSheet: '2025',
      sourceRow: 12,
      occurredAt: new Date('2025-06-01T15:52:00.000Z'),
    }],
    leads: [{
      id: 'lead-usa-1',
      contactId: 'contact-usa-1',
      businessUnitId: 'bu-ait-usa',
      sourceType: 'xlsx',
      sourceName: 'AiTUSA SEGUIMIENTO CENTRAL',
      status: 'Contacted',
      createdAt: new Date('2025-06-01T14:00:00.000Z'),
    }],
    businessUnits: [{ id: 'bu-ait-usa', name: 'AIT USA', label: 'Divisions' }],
  });

  const followUp = timeline.find((entry) => entry.eventType === 'ait_usa.follow_up');
  assert.equal(followUp.type, 'activity');
  assert.equal(followUp.title, 'Follow-up attempt');
  assert.equal(followUp.text, 'ARIANA 11:52 AM: VOLVER A LLAMAR - HABLARA CON SU ESPOSA PARA VER SI ENTRAN LOS 2 A PRESENCIAL.');
  assert.deepEqual(followUp.source, { label: '2025', row: 12 });
  assert.deepEqual(followUp.presentation, {
    category: 'follow_up',
    categoryLabel: 'Follow-up',
    priority: 'primary',
    provenance: {
      eventType: 'ait_usa.follow_up',
      sourceLabel: '2025',
      sourceRow: 12,
      sourceKind: 'Import source',
    },
    isImported: true,
  });
  assert.equal(followUp.businessUnit.name, 'AIT USA');
  assert.deepEqual(followUp.linkedRecords.map((record) => record.type), ['contact', 'lead']);
});

test('buildContactTimeline makes AIT Signs promoted work and financial history readable', () => {
  const timeline = buildContactTimeline({
    activityEvents: [
      {
        id: 'work-1',
        contactId: 'contact-1',
        workOrderId: 'work-order-1',
        eventType: 'import_promoted_work_order',
        message: 'INSTALAR LETRERO - ENTREGADO PENDIENTE DE COBRO',
        sourceSheet: '3. 15 SIGNS WORK ORDER',
        sourceRow: 45,
        occurredAt: new Date('2026-04-01T13:00:00.000Z'),
      },
      {
        id: 'payment-1',
        contactId: 'contact-1',
        eventType: 'import_promoted_payment_snapshot',
        message: '$500 balance captured from workbook.',
        sourceSheet: 'WORK ORDER TERMINADOS Y PAGADOS',
        sourceRow: 90,
        occurredAt: new Date('2026-04-02T13:00:00.000Z'),
      },
    ],
  });

  const work = timeline.find((entry) => entry.eventType === 'import_promoted_work_order');
  const payment = timeline.find((entry) => entry.eventType === 'import_promoted_payment_snapshot');

  assert.equal(work.title, 'Previous work');
  assert.equal(work.presentation.category, 'work');
  assert.equal(work.presentation.provenance.sourceKind, 'Active work source');
  assert.equal(payment.title, 'Payment snapshot');
  assert.equal(payment.presentation.category, 'payment');
  assert.equal(payment.presentation.provenance.sourceKind, 'Completed work source');
});

test('filterTimelineRowsForBusinessUnit preserves unassigned rows and allowed divisions only', () => {
  const scoped = filterTimelineRowsForBusinessUnit([
    { id: 'allowed', businessUnitId: 'bu-1' },
    { id: 'blocked', businessUnitId: 'bu-2' },
    { id: 'unassigned', businessUnitId: null },
  ], ['bu-1']);

  assert.deepEqual(scoped.map((row) => row.id), ['allowed', 'unassigned']);
});
