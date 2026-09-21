import { and, eq } from 'drizzle-orm';
import { contactCourseRecords, leadStatusHistory, leads } from '../../db/schema.js';
import { createCrmError } from './errors.js';
import { withLockedAitUsaOpportunityMutation } from './ait-usa-opportunities.js';
import {
  isNoFurtherProspectingLifecycleStatus,
  WORKFLOW_KEYS,
  workflowKeyForBusinessUnit,
} from './lifecycle.js';
import { reconcileAutomatedInboundFollowUpTasks } from '../tasks/service.js';

export const ENROLLMENT_WRITE_INTENTS = Object.freeze({
  START: 'start_enrollment',
  PAST: 'past_enrollment',
});

export function normalizeEnrollmentWriteIntent(value = '') {
  return value === ENROLLMENT_WRITE_INTENTS.PAST
    ? ENROLLMENT_WRITE_INTENTS.PAST
    : ENROLLMENT_WRITE_INTENTS.START;
}

async function insertCourseRecord(tx, values) {
  const [record] = await tx.insert(contactCourseRecords).values(values).returning();
  return record;
}

async function updateOpportunityStatus(tx, { opportunity, transition, now }) {
  const [updated] = await tx
    .update(leads)
    .set({
      status: transition.toStatus,
      currentStage: transition.toStatus,
      updatedAt: now,
    })
    .where(and(eq(leads.id, opportunity.id), eq(leads.organizationId, opportunity.organizationId)))
    .returning();
  return updated;
}

async function insertStatusHistory(tx, values) {
  await tx.insert(leadStatusHistory).values(values);
}

export async function createCourseRecordWithEnrollmentLifecycle({
  db,
  organizationId,
  actorUserId,
  businessUnit,
  contact,
  expectedOpportunityId = '',
  courseValues,
  intent,
  authorize = null,
  dependencies = {},
}) {
  const writeIntent = normalizeEnrollmentWriteIntent(intent);
  const insertRecord = dependencies.insertCourseRecord || insertCourseRecord;

  if (writeIntent === ENROLLMENT_WRITE_INTENTS.PAST) {
    return db.transaction(async (tx) => ({
      record: await insertRecord(tx, courseValues),
      opportunity: null,
      transition: null,
    }));
  }

  if (workflowKeyForBusinessUnit(businessUnit) !== WORKFLOW_KEYS.AIT_USA) {
    throw createCrmError('Starting an enrollment requires an AIT USA inquiry.', 400);
  }
  if (!expectedOpportunityId) {
    throw createCrmError('An active inquiry is required before starting an enrollment.', 409);
  }

  const runLockedMutation = dependencies.withLockedMutation || withLockedAitUsaOpportunityMutation;
  const updateStatus = dependencies.updateOpportunityStatus || updateOpportunityStatus;
  const addStatusHistory = dependencies.insertStatusHistory || insertStatusHistory;
  const reconcileFollowUps = dependencies.reconcileFollowUps || reconcileAutomatedInboundFollowUpTasks;
  const now = dependencies.now ? dependencies.now() : new Date();

  return runLockedMutation({
    db,
    organizationId,
    businessUnit,
    contact,
    expectedOpportunityId,
    toStatus: 'Enrolled',
    authorize,
    write: async ({ tx, opportunity, transition }) => {
      const record = await insertRecord(tx, {
        ...courseValues,
        leadId: opportunity.id,
      });
      let nextOpportunity = opportunity;

      if (transition?.changed) {
        nextOpportunity = await updateStatus(tx, { opportunity, transition, now });
        await addStatusHistory(tx, {
          organizationId,
          businessUnitId: opportunity.businessUnitId,
          contactId: contact.id,
          leadId: opportunity.id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          actorUserId,
          reason: 'Enrollment started.',
          occurredAt: now,
        });
        if (isNoFurtherProspectingLifecycleStatus(transition.toStatus, { businessUnit })) {
          await reconcileFollowUps(tx, {
            organizationId,
            actorUserId,
            businessUnitId: opportunity.businessUnitId,
            contactId: contact.id,
            leadId: opportunity.id,
            action: 'cancel',
            source: 'enrollment_started',
            reason: 'no_further_prospecting_lifecycle',
            lifecycleStatus: transition.toStatus,
          });
        }
      }

      return { record, opportunity: nextOpportunity, transition };
    },
  });
}
