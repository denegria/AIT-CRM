import { and, desc, eq } from 'drizzle-orm';
import { activityEvents, businessUnits, contacts, leads, notes, workOrders } from '@/db/schema.js';
import { updateLeadOwnerWithActivity } from './assignment.js';

export async function latestLeadForContact(db, organizationId, contactId) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
}

async function notesForContact(db, organizationId, contactId) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.contactId, contactId), eq(notes.organizationId, organizationId)))
    .orderBy(desc(notes.createdAt));
}

function workOrderEventValues({ organizationId, actorUserId, workOrder, eventType, message, workOrderId = workOrder.id }) {
  return {
    organizationId,
    businessUnitId: workOrder.businessUnitId,
    contactId: workOrder.contactId,
    leadId: workOrder.leadId,
    workOrderId,
    eventType,
    message,
    actorUserId,
    occurredAt: new Date(),
  };
}

function businessUnitEventValues({ organizationId, actorUserId, businessUnit, eventType }) {
  return {
    organizationId,
    businessUnitId: businessUnit.id,
    eventType,
    message: (eventType === 'business_unit.created' ? 'Created' : 'Updated') + ' division ' + businessUnit.name + '.',
    actorUserId,
    occurredAt: new Date(),
  };
}

export async function createContactWithLead({
  db,
  organizationId,
  contactValues,
  leadValues = null,
}) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        organizationId,
        ...contactValues,
      })
      .returning();

    let lead = null;
    if (leadValues) {
      [lead] = await tx
        .insert(leads)
        .values({
          organizationId,
          contactId: contact.id,
          ...leadValues,
        })
        .returning();
    }

    return { contact, lead };
  });
}

export async function updateContactWithLeadAndNotes({
  db,
  organizationId,
  actorUserId,
  contactId,
  contactPatch,
  existingLead = null,
  leadPatch = null,
  replaceNotes = null,
}) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .update(contacts)
      .set(contactPatch)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)))
      .returning();

    let lead = existingLead;
    if (existingLead && leadPatch) {
      const hasOwnerPatch = Object.prototype.hasOwnProperty.call(leadPatch, 'assignedUserId');
      const ownerUserId = hasOwnerPatch ? leadPatch.assignedUserId || null : undefined;
      const leadPatchWithoutOwner = { ...leadPatch };
      delete leadPatchWithoutOwner.assignedUserId;

      [lead] = await tx
        .update(leads)
        .set(leadPatchWithoutOwner)
        .where(and(eq(leads.id, existingLead.id), eq(leads.organizationId, organizationId)))
        .returning();

      if (hasOwnerPatch) {
        const assignment = await updateLeadOwnerWithActivity({
          tx,
          organizationId,
          actorUserId,
          existingLead: lead,
          ownerUserId,
        });
        lead = assignment.lead;
      }
    }

    let noteRows = await notesForContact(tx, organizationId, contactId);
    if (replaceNotes) {
      const previousNoteCount = noteRows.length;
      await tx
        .delete(notes)
        .where(and(eq(notes.contactId, contactId), eq(notes.organizationId, organizationId)));

      noteRows = replaceNotes.noteInputs.length
        ? await tx.insert(notes).values(replaceNotes.noteInputs.map((note) => ({
            organizationId,
            businessUnitId: contact.primaryBusinessUnitId,
            contactId,
            body: note.body,
            authorUserId: actorUserId,
            createdAt: note.createdAt,
            updatedAt: note.createdAt,
          }))).returning()
        : [];

      if (noteRows.length > previousNoteCount) {
        await tx.insert(activityEvents).values({
          organizationId,
          businessUnitId: contact.primaryBusinessUnitId,
          contactId,
          leadId: lead?.id || null,
          eventType: 'contact.note_added',
          message: 'Added contact timeline note.',
          actorUserId,
          occurredAt: new Date(),
        });
      }
    }

    return { contact, lead, noteRows };
  });
}

export async function createWorkOrderWithActivity({
  db,
  organizationId,
  actorUserId,
  workOrderValues,
}) {
  return db.transaction(async (tx) => {
    const [workOrder] = await tx
      .insert(workOrders)
      .values({
        organizationId,
        ...workOrderValues,
      })
      .returning();

    await tx.insert(activityEvents).values(workOrderEventValues({
      organizationId,
      actorUserId,
      workOrder,
      eventType: 'work_order.created',
      message: `Created work order ${workOrder.workOrderNumber || workOrder.id}.`,
    }));

    return { workOrder };
  });
}

export async function updateWorkOrderWithActivity({
  db,
  organizationId,
  actorUserId,
  workOrderId,
  workOrderPatch,
}) {
  return db.transaction(async (tx) => {
    const [workOrder] = await tx
      .update(workOrders)
      .set(workOrderPatch)
      .where(and(eq(workOrders.id, workOrderId), eq(workOrders.organizationId, organizationId)))
      .returning();

    await tx.insert(activityEvents).values(workOrderEventValues({
      organizationId,
      actorUserId,
      workOrder,
      eventType: 'work_order.updated',
      message: `Updated work order ${workOrder.workOrderNumber || workOrder.id}.`,
    }));

    return { workOrder };
  });
}

export async function deleteWorkOrderWithActivity({
  db,
  organizationId,
  actorUserId,
  existingWorkOrder,
}) {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(workOrders)
      .where(and(eq(workOrders.id, existingWorkOrder.id), eq(workOrders.organizationId, organizationId)))
      .returning({ id: workOrders.id });

    await tx.insert(activityEvents).values(workOrderEventValues({
      organizationId,
      actorUserId,
      workOrder: existingWorkOrder,
      workOrderId: null,
      eventType: 'work_order.deleted',
      message: `Deleted work order ${existingWorkOrder.workOrderNumber || existingWorkOrder.id}.`,
    }));

    return { deleted };
  });
}

export async function createBusinessUnitWithActivity({
  db,
  organizationId,
  actorUserId,
  businessUnitValues,
}) {
  return db.transaction(async (tx) => {
    const [businessUnit] = await tx
      .insert(businessUnits)
      .values({
        organizationId,
        ...businessUnitValues,
      })
      .returning();

    await tx.insert(activityEvents).values(businessUnitEventValues({
      organizationId,
      actorUserId,
      businessUnit,
      eventType: 'business_unit.created',
    }));

    return { businessUnit };
  });
}

export async function updateBusinessUnitWithActivity({
  db,
  organizationId,
  actorUserId,
  businessUnitId,
  businessUnitPatch,
}) {
  return db.transaction(async (tx) => {
    const [businessUnit] = await tx
      .update(businessUnits)
      .set(businessUnitPatch)
      .where(and(eq(businessUnits.id, businessUnitId), eq(businessUnits.organizationId, organizationId)))
      .returning();

    await tx.insert(activityEvents).values(businessUnitEventValues({
      organizationId,
      actorUserId,
      businessUnit,
      eventType: 'business_unit.updated',
    }));

    return { businessUnit };
  });
}
