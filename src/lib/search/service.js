import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  contacts,
  estimates,
  financialDocuments,
  leads,
  workOrders,
} from '@/db/schema.js';
import {
  canAccessBusinessUnit,
  isRegularCoordinatorSession,
  scopedBusinessUnitWhere,
  scopedContactWhere,
  scopedOrgWhere,
  scopedWorkOrderWhere,
} from '@/lib/crm/access.js';
import { hasPermission, PERMISSIONS } from '@/lib/auth.js';

const SEARCH_LIMIT = 5;

function clean(value = '') {
  return String(value || '').trim();
}

function businessUnitCondition(column, session, businessUnitId) {
  if (!businessUnitId || businessUnitId === 'all') return undefined;
  if (businessUnitId === 'unassigned') return sql`${column} is null`;
  return canAccessBusinessUnit(session, businessUnitId) ? eq(column, businessUnitId) : sql`false`;
}

export async function loadGlobalSearch({ db, session, query, businessUnitId = '' }) {
  const value = clean(query);
  if (value.length < 2) return { results: [] };
  const pattern = `%${value}%`;
  const latestLead = db
    .selectDistinctOn([leads.contactId], {
      contactId: leads.contactId,
      assignedUserId: leads.assignedUserId,
    })
    .from(leads)
    .where(scopedOrgWhere(leads, session))
    .orderBy(leads.contactId, desc(leads.createdAt), desc(leads.id))
    .as('global_search_latest_lead');

  const contactRowsPromise = db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .leftJoin(latestLead, eq(latestLead.contactId, contacts.id))
    .where(and(
      scopedContactWhere(contacts, session),
      businessUnitCondition(contacts.primaryBusinessUnitId, session, businessUnitId),
      isRegularCoordinatorSession(session) ? eq(latestLead.assignedUserId, session.user.id) : undefined,
      or(ilike(contacts.name, pattern), ilike(contacts.email, pattern), ilike(contacts.phone, pattern)),
    ))
    .orderBy(contacts.name)
    .limit(SEARCH_LIMIT);

  const workOrderRowsPromise = db
    .select({ id: workOrders.id, title: workOrders.title, number: workOrders.workOrderNumber })
    .from(workOrders)
    .where(and(
      scopedWorkOrderWhere(workOrders, session),
      businessUnitCondition(workOrders.businessUnitId, session, businessUnitId),
      or(ilike(workOrders.title, pattern), ilike(workOrders.workOrderNumber, pattern)),
    ))
    .orderBy(desc(workOrders.createdAt))
    .limit(SEARCH_LIMIT);

  const canReadFinancials = hasPermission(session, PERMISSIONS.FINANCIALS_READ);
  const financialRowsPromise = canReadFinancials
    ? Promise.all([
      db
        .select({ id: estimates.id, number: estimates.estimateNumber, contactId: estimates.contactId })
        .from(estimates)
        .where(and(
          scopedBusinessUnitWhere(estimates, session),
          businessUnitCondition(estimates.businessUnitId, session, businessUnitId),
          ilike(estimates.estimateNumber, pattern),
        ))
        .orderBy(desc(estimates.createdAt))
        .limit(SEARCH_LIMIT),
      db
        .select({
          id: financialDocuments.id,
          number: financialDocuments.documentNumber,
          type: financialDocuments.documentType,
          contactId: financialDocuments.contactId,
        })
        .from(financialDocuments)
        .where(and(
          scopedBusinessUnitWhere(financialDocuments, session),
          businessUnitCondition(financialDocuments.businessUnitId, session, businessUnitId),
          ilike(financialDocuments.documentNumber, pattern),
        ))
        .orderBy(desc(financialDocuments.createdAt))
        .limit(SEARCH_LIMIT),
    ])
    : Promise.resolve([[], []]);

  const [contactRows, workOrderRows, [estimateRows, documentRows]] = await Promise.all([
    contactRowsPromise,
    workOrderRowsPromise,
    financialRowsPromise,
  ]);
  const results = [
    ...contactRows.map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.email || row.phone || 'Contact',
      type: 'contact',
      path: `/contacts/${row.id}`,
    })),
    ...workOrderRows.map((row) => ({
      id: row.id,
      title: row.title || row.number || 'Work order',
      subtitle: row.number || 'Work order',
      type: 'work-order',
      path: `/work-orders/${row.id}`,
    })),
    ...estimateRows.map((row) => ({
      id: row.id,
      title: `Estimate ${row.number || ''}`.trim(),
      subtitle: row.number || 'Estimate',
      type: 'financial',
      path: row.contactId ? `/contacts/${row.contactId}` : '/financials',
    })),
    ...documentRows.map((row) => ({
      id: row.id,
      title: `${row.type || 'Document'} ${row.number || ''}`.trim(),
      subtitle: row.number || row.type || 'Financial document',
      type: 'financial',
      path: row.contactId ? `/contacts/${row.contactId}` : '/financials',
    })),
  ];
  return { results: results.slice(0, 10) };
}
