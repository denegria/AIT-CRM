import { classifyContactIdentity } from '../crm/contact-identity.js';
import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from '../crm/lifecycle.js';
import { authorizeRegistrationRequest } from './policy.js';
import {
  assignContactToRegistrationScope,
  createRegistrationContact,
  loadRegistrationReplay,
  persistRegistrationBundle,
} from './service.js';

export class RegistrationActionError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'RegistrationActionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function assertAitUsaBusinessUnit(client, scope) {
  const result = await client.query(
    `select id, name, label, is_active
       from business_units
      where id = $1 and organization_id = $2
      limit 1`,
    [scope.businessUnitId, scope.organizationId],
  );
  const businessUnit = result.rows[0];
  if (!businessUnit || businessUnit.is_active === false) {
    throw new RegistrationActionError('business_unit_not_found', 'Registration business unit is not active.', 404);
  }
  if (workflowKeyForBusinessUnit(businessUnit) !== WORKFLOW_KEYS.AIT_USA) {
    throw new RegistrationActionError('business_unit_not_eligible', 'Registration is limited to AIT USA.', 403);
  }
  return businessUnit;
}

async function lockRegistrationIdentities(client, scope, identities) {
  const keys = [...new Set(identities.filter(Boolean).map((identity) => [
    identity.contactId ? `contact:${identity.contactId}` : '',
    identity.email ? `email:${identity.email}` : '',
    identity.phone ? `phone:${identity.phone}` : '',
  ].filter(Boolean).join('|')).filter(Boolean))].sort();
  for (const key of keys) {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`registration-identity:${scope.organizationId}:${key}`],
    );
  }
}

async function resolveRegistrationIdentity(client, scope, identity, role) {
  if (identity.contactId) {
    try {
      return await assignContactToRegistrationScope(client, scope, identity.contactId);
    } catch (error) {
      throw new RegistrationActionError('contact_scope_conflict', error.message, 409);
    }
  }
  const classification = await classifyContactIdentity(client, {
    organizationId: scope.organizationId,
    email: identity.email,
    phone: identity.phone,
  });
  if (classification.status === 'ambiguous') {
    throw new RegistrationActionError(
      'identity_review_required',
      `${role === 'student' ? 'Student' : 'Payer'} identity requires advisor review.`,
      409,
      { reason: classification.reason },
    );
  }
  if (classification.status === 'exact') {
    try {
      return await assignContactToRegistrationScope(client, scope, classification.contactId);
    } catch (error) {
      throw new RegistrationActionError('contact_scope_conflict', error.message, 409);
    }
  }
  return createRegistrationContact(client, scope, identity, role);
}

export async function orchestrateRegistration(client, input = {}) {
  const request = authorizeRegistrationRequest(input);
  if (request.status === 'advisor_required') {
    return {
      status: 'advisor_required',
      duplicate: false,
      reason: request.reason,
      quote: request.quote,
      wroteRecords: false,
    };
  }
  const scope = {
    organizationId: request.organizationId,
    businessUnitId: request.businessUnitId,
  };
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`registration:${scope.organizationId}:${scope.businessUnitId}:${request.idempotencyKey}`],
    );
    const replay = await loadRegistrationReplay(client, scope, request.idempotencyKey);
    if (replay) {
      await client.query('commit');
      return replay;
    }
    await assertAitUsaBusinessUnit(client, scope);
    await lockRegistrationIdentities(client, scope, [request.student, request.payer]);
    const student = await resolveRegistrationIdentity(client, scope, request.student, 'student');
    const payer = request.payer
      ? await resolveRegistrationIdentity(client, scope, request.payer, 'payer')
      : student;
    const result = await persistRegistrationBundle(client, {
      ...scope,
      idempotencyKey: request.idempotencyKey,
      sourceReference: request.sourceReference,
      programCode: request.programCode,
      classSectionId: request.classSectionId,
      studentContactId: student.id,
      payerContactId: payer.id,
      quote: request.quote,
      fulfillmentPlan: request.fulfillmentPlan,
    });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
