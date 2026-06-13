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

test('buildContactTimeline treats employee follow-up completion as structured activity', () => {
  const timeline = buildContactTimeline({
    activityEvents: [{
      id: 'manual-follow-up-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      eventType: 'follow_up.no_answer',
      message: 'Follow-up completed: No answer.',
      metadataJson: {
        source: 'manual_follow_up_task',
        taskId: 'task-1',
        outcome: 'no_answer',
        outcomeLabel: 'No answer',
      },
      occurredAt: new Date('2026-06-03T14:00:00.000Z'),
    }],
    tasks: [{
      id: 'task-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      title: 'Call Hilda',
    }],
    businessUnits: [{ id: 'bu-1', name: 'AIT USA Institute', label: 'Divisions' }],
  });

  const followUp = timeline[0];
  assert.equal(followUp.type, 'activity');
  assert.equal(followUp.title, 'No answer');
  assert.equal(followUp.presentation.category, 'follow_up');
  assert.equal(followUp.presentation.isImported, false);
  assert.deepEqual(followUp.linkedRecords.map((record) => record.type), ['contact', 'lead', 'task']);
  assert.equal(followUp.linkedRecords.find((record) => record.type === 'task').label, 'Task: Call Hilda');
  assert.equal(followUp.metadataJson.outcome, 'no_answer');
});

test('buildContactTimeline labels first manual AIT USA follow-up as first outreach', () => {
  const timeline = buildContactTimeline({
    activityEvents: [{
      id: 'manual-follow-up-1',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      eventType: 'ait_usa.follow_up',
      message: 'Called twice then texted.',
      actorUserId: 'user-1',
      occurredAt: new Date('2026-06-12T13:31:00.000Z'),
    }, {
      id: 'manual-follow-up-2',
      contactId: 'contact-1',
      leadId: 'lead-1',
      businessUnitId: 'bu-1',
      eventType: 'ait_usa.follow_up',
      message: 'Second follow-up after status change.',
      actorUserId: 'user-1',
      occurredAt: new Date('2026-06-12T13:33:00.000Z'),
    }],
    users: [{ id: 'user-1', name: 'AIT USA Account Manager' }],
    businessUnits: [{ id: 'bu-1', name: 'AIT USA Institute', label: 'Divisions' }],
  });

  const firstOutreach = timeline.find((entry) => entry.id === 'activity:manual-follow-up-1');
  const followUp = timeline.find((entry) => entry.id === 'activity:manual-follow-up-2');

  assert.equal(firstOutreach.title, 'First outreach attempt');
  assert.equal(firstOutreach.presentation.category, 'follow_up');
  assert.equal(firstOutreach.presentation.categoryLabel, 'First outreach');
  assert.equal(firstOutreach.presentation.provenance, null);
  assert.equal(followUp.title, 'Follow-up attempt');
  assert.equal(followUp.presentation.categoryLabel, 'Follow-up');
  assert.equal(followUp.presentation.provenance, null);
});

test('buildContactTimeline hides generic regular note activity artifacts', () => {
  const timeline = buildContactTimeline({
    notes: [{
      id: 'note-1',
      contactId: 'contact-1',
      businessUnitId: 'bu-1',
      body: 'Classes Monday, Wednesday, and Friday.',
      authorUserId: 'user-1',
      createdAt: new Date('2026-06-12T00:00:00.000Z'),
    }],
    activityEvents: [{
      id: 'note-added-activity-1',
      contactId: 'contact-1',
      businessUnitId: 'bu-1',
      eventType: 'contact.note_added',
      message: 'Added contact timeline note.',
      actorUserId: 'user-1',
      occurredAt: new Date('2026-06-12T13:33:00.000Z'),
    }],
    users: [{ id: 'user-1', name: 'AIT USA Account Manager' }],
    businessUnits: [{ id: 'bu-1', name: 'AIT USA Institute', label: 'Divisions' }],
  });

  assert.deepEqual(timeline.map((entry) => entry.id), ['note:note-1']);
  assert.equal(timeline[0].timestamp, '2026-06-12T13:33:00.000Z');
  assert.equal(timeline[0].presentation.category, 'note');
  assert.equal(timeline[0].presentation.provenance, null);
});

test('buildContactTimeline interprets Wix website imports without raw pipe text', () => {
  const timeline = buildContactTimeline({
    notes: [{
      id: 'website-details-note',
      contactId: 'contact-wix-1',
      leadId: 'lead-wix-1',
      body: 'Website form details:\n- Age: 36\n- Location: New jersey\n- Additional form fields: Para quien: Para mí',
      createdAt: new Date('2026-05-20T20:08:00.000Z'),
    }],
    activityEvents: [{
      id: 'website-captured-activity',
      contactId: 'contact-wix-1',
      leadId: 'lead-wix-1',
      businessUnitId: 'bu-ait-usa',
      eventType: 'website_lead_captured',
      message: 'Website lead submitted.',
      createdAt: new Date('2026-05-20T20:07:00.000Z'),
    }, {
      id: 'default-assignment-activity',
      contactId: 'contact-wix-1',
      leadId: 'lead-wix-1',
      businessUnitId: 'bu-ait-usa',
      eventType: 'lead.assigned',
      message: 'Assigned inbound lead by default rule.',
      createdAt: new Date('2026-05-20T20:07:00.000Z'),
    }],
    leads: [{
      id: 'lead-wix-1',
      contactId: 'contact-wix-1',
      businessUnitId: 'bu-ait-usa',
      sourceType: 'website_form',
      sourceName: 'Wix Contact Form',
      status: 'New Lead',
      currentStage: 'New Lead',
      originalNotes: 'website_form | external_id=none | source_key=wix-ait-usa | source_row_id=source-row-1 | current_stage=New Lead | address=New jersey | age=36 | message=Para mí',
      assignedUserId: 'user-1',
      createdAt: new Date('2026-05-20T20:07:00.000Z'),
    }, {
      id: 'lead-wix-duplicate',
      contactId: 'contact-wix-1',
      businessUnitId: 'bu-ait-usa',
      sourceType: 'website_form',
      sourceName: 'Wix Contact Form',
      status: 'New Lead',
      currentStage: 'New Lead',
      originalNotes: 'website_form | external_id=none | source_key=wix-ait-usa | source_row_id=source-row-2 | current_stage=New Lead | address=New jersey | age=36 | message=Para mí',
      createdAt: new Date('2026-05-20T20:07:00.000Z'),
    }],
    users: [{ id: 'user-1', name: 'Default Owner' }],
    businessUnits: [{ id: 'bu-ait-usa', name: 'AIT USA', label: 'Divisions' }],
  });

  const websiteLeads = timeline.filter((entry) => entry.record?.kind === 'website_lead');
  const lead = websiteLeads[0];
  const detailsNote = timeline.find((entry) => entry.id === 'note:website-details-note');

  assert.equal(websiteLeads.length, 1);
  assert.equal(lead.title, 'Wix Contact Form');
  assert.equal(lead.text, '');
  assert.equal(lead.text.includes('source_key='), false);
  assert.equal(lead.actor, null);
  assert.equal(lead.record.kind, 'website_lead');
  assert.deepEqual(lead.record.meta, ['Stage New Lead', 'For myself', 'Location New jersey', 'Age 36', 'Source wix-ait-usa']);
  assert.equal(lead.presentation.category, 'lead');
  assert.equal(lead.presentation.provenance.sourceKind, 'Website form row');
  assert.match(lead.presentation.provenance.rawText, /source_key=wix-ait-usa/);
  assert.equal(detailsNote.title, 'Website form details');
  assert.equal(detailsNote.text, 'Age 36 · Location New jersey · Additional form fields Para quien: Para mí');
  assert.equal(detailsNote.presentation.category, 'import');
  assert.equal(timeline.some((entry) => entry.id === 'activity:website-captured-activity'), false);
  assert.equal(timeline.some((entry) => entry.id === 'activity:default-assignment-activity'), false);
});

test('buildContactTimeline keeps historical Wix imports chip-only by default', () => {
  const timeline = buildContactTimeline({
    leads: [{
      id: 'lead-wix-history',
      contactId: 'contact-wix-history',
      businessUnitId: 'bu-ait-usa',
      sourceType: 'website_form',
      sourceName: 'Wix Historical Import',
      status: 'New Lead',
      currentStage: 'Needs First Outreach',
      originalNotes: [
        'website_form',
        'external_id=wix-history-123',
        'source_key=wix-ait-usa',
        'source_row_id=source-row-history',
        'current_stage=Needs First Outreach',
        'outreach_state=never_contacted',
        'priority=High',
        'service=Wix historical lead',
        'message=Wix sources: Wix Contacts Export | Merged rows: 1 | Source files: contacts.csv',
      ].join(' | '),
      createdAt: new Date('2026-05-16T05:57:00.000Z'),
    }],
    businessUnits: [{ id: 'bu-ait-usa', name: 'AIT USA', label: 'Divisions' }],
  });

  const lead = timeline.find((entry) => entry.record?.kind === 'website_lead');

  assert.equal(lead.title, 'Wix Historical Import');
  assert.equal(lead.text, '');
  assert.deepEqual(lead.record.meta, [
    'Stage Needs First Outreach',
    'Interest Wix historical lead',
    'Source wix-ait-usa',
    'Submission wix-history-123',
  ]);
  assert.match(lead.presentation.provenance.rawText, /Wix sources: Wix Contacts Export/);
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
        sourceSheet: 'WORK ORDER TERMINADOS Y PAGADOS',
        sourceRow: 45,
        occurredAt: new Date('2026-04-01T13:00:00.000Z'),
      },
      {
        id: 'payment-1',
        contactId: 'contact-1',
        eventType: 'import_promoted_payment_snapshot',
        message: '$500 balance captured from workbook.',
        sourceSheet: 'WORK ORDER TERMINADOS Y PAGADOS',
        sourceRow: 45,
        occurredAt: new Date('2026-04-02T13:00:00.000Z'),
      },
    ],
    workOrders: [{
      id: 'work-order-1',
      workOrderNumber: 'AIT-WO-45',
      title: 'Installed acrylic sign',
      status: 'Completed',
      estimatedCost: '554.45',
    }],
    paymentSnapshots: [{
      id: 'payment-snapshot-1',
      amount: '500.00',
      balanceAfter: '54.45',
      sourceSheet: 'WORK ORDER TERMINADOS Y PAGADOS',
      sourceRow: 45,
    }],
  });

  const work = timeline.find((entry) => entry.eventType === 'import_promoted_work_order');
  const payment = timeline.find((entry) => entry.eventType === 'import_promoted_payment_snapshot');

  assert.equal(work.title, 'Installed acrylic sign');
  assert.equal(work.text, 'AIT-WO-45 · $554.45 · Completed');
  assert.equal(work.record.kind, 'work_order');
  assert.equal(work.record.href, '/work-orders/work-order-1');
  assert.equal(work.record.stageLabel, 'Completed');
  assert.deepEqual(work.record.stages.map((stage) => stage.label), ['Work order', 'Delivered', 'Completed']);
  assert.equal(work.presentation.category, 'work');
  assert.equal(work.presentation.provenance.sourceKind, 'Completed work source');
  assert.equal(work.presentation.provenance.rawText, 'INSTALAR LETRERO - ENTREGADO PENDIENTE DE COBRO');
  assert.equal(work.presentation.sourceGroupLabel, 'Workbook row 45: 2 imported records');
  assert.equal(payment.title, 'Payment snapshot $500');
  assert.equal(payment.text, '$500 · Balance $54.45');
  assert.equal(payment.record.kind, 'payment_snapshot');
  assert.equal(payment.presentation.category, 'payment');
  assert.equal(payment.presentation.provenance.sourceKind, 'Completed work source');
  assert.equal(payment.presentation.sourceGroupLabel, 'Workbook row 45: 2 imported records');
});

test('buildContactTimeline links manual payment activity to payment snapshot metadata', () => {
  const timeline = buildContactTimeline({
    activityEvents: [{
      id: 'manual-payment-1',
      contactId: 'contact-1',
      workOrderId: 'work-order-1',
      eventType: 'financial.payment_received',
      message: 'Payment received $300.00 · Cash · Work Order AIT-WO-45 · Balance $900.00',
      metadataJson: { paymentSnapshotId: 'payment-snapshot-manual' },
      occurredAt: new Date('2026-06-13T12:00:00.000Z'),
    }],
    workOrders: [{
      id: 'work-order-1',
      workOrderNumber: 'AIT-WO-45',
      title: 'Installed acrylic sign',
      status: 'In Progress',
      estimatedCost: '1200.00',
    }],
    paymentSnapshots: [{
      id: 'payment-snapshot-manual',
      amount: '300.00',
      balanceAfter: '900.00',
      paymentMethod: 'Cash',
      workOrderId: 'work-order-1',
    }],
  });

  const payment = timeline.find((entry) => entry.eventType === 'financial.payment_received');
  assert.equal(payment.title, 'Payment snapshot $300');
  assert.equal(payment.text, '$300 · Balance $900');
  assert.equal(payment.record.kind, 'payment_snapshot');
  assert.equal(payment.presentation.category, 'payment');
  assert.equal(payment.presentation.provenance, null);
});

test('buildContactTimeline demotes raw imported notes behind source details', () => {
  const timeline = buildContactTimeline({
    notes: [{
      id: 'note-raw-1',
      body: '1527 | SI | NO | 45315.0 | BLUE MOUNTAIN | FELIX | (20) YARD SIGN 24 X 18 | ENTREGADO | $ | 520.0 | 34.45 | 554.45',
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }, {
      id: 'note-cleanup-1',
      body: 'AIT Signs cleanup merged duplicate customer contacts into this account.\nMerged duplicate contacts:\n- FELIX | company: BLUE MOUNTAIN | linked rows: 3',
      createdAt: new Date('2026-06-02T02:22:29.828Z'),
    }, {
      id: 'note-mis97-cleanup-1',
      body: 'MIS-97 staging duplicate cleanup (mis97_blue_contacts_confirmed_staging_apply).\nCanonical contact retained as: BLUE MOUNTAIN.\nMerged contact rows and preserved source contact details:\n- name=MARK BLUE MOUNTAIN | company=MARK BLUE MOUNTAIN | phone=908 642 3020',
      createdAt: new Date('2026-06-04T23:55:46.644Z'),
    }, {
      id: 'note-mis125-cleanup-1',
      body: 'MIS-125 approved invalid-phone collision merge.\nCanonical retained as: BRENMA TREE SERVICE.\nApproval: Alvaro #2/#3: Brenma Tree Service / same as 2.\nSource: WORK ORDER TERMINADOS Y PAGADOS rows 1445, 1518, 1697 plus existing BREMMA/BRENMA tree-service collision.\nMerged contact rows and preserved aliases/contact context:\n- name=BREMMA LANDSCAPING | company=BREMMA LANDSCAPING | phone=15460625 | links=6\n- name=BRENMA LANDSCAPING | company=BRENMA LANDSCAPING | phone=10129375 | links=3',
      createdAt: new Date('2026-06-05T04:22:55.000Z'),
    }],
  });

  const rawNote = timeline.find((entry) => entry.id === 'note:note-raw-1');
  const cleanupNote = timeline.find((entry) => entry.id === 'note:note-cleanup-1');
  const mis97CleanupNote = timeline.find((entry) => entry.id === 'note:note-mis97-cleanup-1');
  const mis125CleanupNote = timeline.find((entry) => entry.id === 'note:note-mis125-cleanup-1');

  assert.equal(rawNote.title, 'Imported workbook note');
  assert.equal(rawNote.text, 'Workbook note captured for audit. Expand source details for the original imported row.');
  assert.equal(rawNote.presentation.category, 'import');
  assert.equal(rawNote.presentation.provenance.sourceKind, 'Imported workbook note');
  assert.match(rawNote.presentation.provenance.rawText, /BLUE MOUNTAIN/);
  assert.equal(cleanupNote.title, 'Audit / Source Cleanup');
  assert.equal(cleanupNote.presentation.category, 'import');
  assert.equal(cleanupNote.presentation.categoryLabel, 'Audit / Source Cleanup');
  assert.equal(cleanupNote.presentation.provenance.sourceKind, 'Cleanup audit');
  assert.equal(mis97CleanupNote.title, 'Audit / Source Cleanup');
  assert.match(mis97CleanupNote.text, /Retained BLUE MOUNTAIN/);
  assert.match(mis97CleanupNote.text, /Merged aliases: MARK BLUE MOUNTAIN/);
  assert.equal(mis97CleanupNote.presentation.category, 'import');
  assert.equal(mis97CleanupNote.presentation.provenance.sourceKind, 'Cleanup audit');
  assert.equal(mis125CleanupNote.title, 'Audit / Source Cleanup');
  assert.match(mis125CleanupNote.text, /Retained BRENMA TREE SERVICE/);
  assert.match(mis125CleanupNote.text, /Merged aliases: BREMMA LANDSCAPING, BRENMA LANDSCAPING/);
  assert.equal(mis125CleanupNote.presentation.categoryLabel, 'Audit / Source Cleanup');
});

test('filterTimelineRowsForBusinessUnit preserves unassigned rows and allowed divisions only', () => {
  const scoped = filterTimelineRowsForBusinessUnit([
    { id: 'allowed', businessUnitId: 'bu-1' },
    { id: 'blocked', businessUnitId: 'bu-2' },
    { id: 'unassigned', businessUnitId: null },
  ], ['bu-1']);

  assert.deepEqual(scoped.map((row) => row.id), ['allowed', 'unassigned']);
});
