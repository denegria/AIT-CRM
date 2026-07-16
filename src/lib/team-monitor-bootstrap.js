import { workflowFromLead } from './sales-workflow.js';
import { filterTeamMonitorContacts, filterTeamMonitorEmployees } from './crm/coordinator-policy.js';
import { toBusinessUnitPayload } from './crm/payloads.js';
import { latestStructuredFollowUpAt } from './structured-follow-up.js';

function timeValue(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

function iso(value) {
  return value?.toISOString?.() || value || '';
}

function latestByContact(rows = [], selector = () => 0) {
  const byContactId = new Map();
  for (const row of rows) {
    if (!row?.contactId) continue;
    const current = byContactId.get(row.contactId);
    if (!current || selector(row) > selector(current)) byContactId.set(row.contactId, row);
  }
  return byContactId;
}

function isBulkStatusReconcile(row = {}) {
  const source = String(row.metadataJson?.source || '').trim().toLowerCase();
  return Boolean(source) && !row.actorUserId && !row.fromStatus && /retargeting-reconcile|status-reconcile|backfill|import/.test(source);
}

function latestStatusDate(rows = [], status = '') {
  const match = rows
    .filter((row) => row.toStatus === status && !isBulkStatusReconcile(row))
    .sort((left, right) => timeValue(right.occurredAt || right.createdAt) - timeValue(left.occurredAt || left.createdAt))[0];
  return iso(match?.occurredAt || match?.createdAt);
}

export function buildTeamMonitorBootstrapPayload({
  appVersion = '',
  currentUser = null,
  access = {},
  businessUnits = [],
  employees = [],
  contacts = [],
  leads = [],
  tasks = [],
  courseRecords = [],
  leadStatusHistory = [],
  activityEvents = [],
} = {}) {
  const scopedEmployees = filterTeamMonitorEmployees(employees, currentUser || {});
  const rosterIds = new Set(scopedEmployees.map((employee) => employee.id));
  const scopedContacts = filterTeamMonitorContacts(contacts, currentUser || {});
  const scopedContactIds = new Set(scopedContacts.map((contact) => contact.id));
  const businessUnitById = new Map(businessUnits.map((unit) => [unit.id, unit]));
  const leadByContactId = latestByContact(leads, (lead) => timeValue(lead.createdAt));
  const coursesByContactId = new Map();
  const historyByContactId = new Map();
  const eventsByContactId = new Map();

  for (const row of courseRecords) {
    if (!scopedContactIds.has(row.contactId)) continue;
    const list = coursesByContactId.get(row.contactId) || [];
    list.push(row);
    coursesByContactId.set(row.contactId, list);
  }
  for (const row of leadStatusHistory) {
    if (!scopedContactIds.has(row.contactId)) continue;
    const list = historyByContactId.get(row.contactId) || [];
    list.push(row);
    historyByContactId.set(row.contactId, list);
  }
  for (const row of activityEvents) {
    if (!scopedContactIds.has(row.contactId)) continue;
    const list = eventsByContactId.get(row.contactId) || [];
    list.push(row);
    eventsByContactId.set(row.contactId, list);
  }

  return {
    dataSource: 'postgres',
    appVersion,
    authRequired: false,
    authError: '',
    currentUser,
    access,
    businessUnits: businessUnits.map((unit) => toBusinessUnitPayload(unit, { emptyColor: null })),
    employees: scopedEmployees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      roleKeys: employee.roleKeys,
      businessUnitIds: employee.businessUnitIds,
    })),
    contacts: scopedContacts.map((contact) => {
      const lead = leadByContactId.get(contact.id) || null;
      const workflow = workflowFromLead(lead, { businessUnit: businessUnitById.get(contact.primaryBusinessUnitId) || null });
      const history = historyByContactId.get(contact.id) || [];
      return {
        id: contact.id,
        primaryBusinessUnitId: contact.primaryBusinessUnitId,
        workflowKey: workflow.workflowKey,
        status: workflow.status,
        currentStage: workflow.currentStage,
        assignedTo: rosterIds.has(lead?.assignedUserId) ? lead.assignedUserId : '',
        unattributedOwner: Boolean(lead?.assignedUserId && !rosterIds.has(lead.assignedUserId)),
        courseRecords: (coursesByContactId.get(contact.id) || []).map((row) => ({
          status: row.status,
          startDate: iso(row.startDate),
          endDate: iso(row.endDate),
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        })),
        enrollmentStatusChangedAt: latestStatusDate(history, 'Enrolled'),
        droppedStatusChangedAt: latestStatusDate(history, 'Dropped / Quit'),
        lastStructuredFollowUpAt: latestStructuredFollowUpAt(eventsByContactId.get(contact.id) || []),
      };
    }),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      businessUnitId: task.businessUnitId,
      contactId: scopedContactIds.has(task.contactId) ? task.contactId : '',
      taskType: task.taskType,
      status: task.status,
      dueAt: iso(task.dueAt),
      completedAt: iso(task.completedAt),
      ownerUserId: rosterIds.has(task.ownerUserId) ? task.ownerUserId : '',
      unattributedOwner: Boolean(task.ownerUserId && !rosterIds.has(task.ownerUserId)),
    })),
    workOrders: [],
    financials: [],
    calendarEvents: [],
    salesLedger: [],
  };
}
