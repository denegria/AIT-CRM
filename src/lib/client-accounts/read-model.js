import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  businessUnits,
  clientAccountAliases,
  clientAccounts,
  clientContactMethods,
  clientLocations,
  clientPeople,
  contacts,
  estimates,
  workOrders,
} from '../../db/schema.js';

export const CLIENT_ACCOUNT_MATCH_REASONS = {
  ACCOUNT_NAME: 'account_name',
  VISIBLE_ALIAS: 'visible_alias',
  HISTORICAL_SOURCE_NAME: 'historical_source_name',
  PERSON: 'person',
  CONTACT_METHOD: 'contact_method',
  LOCATION: 'location',
  WORK_ORDER: 'work_order',
  ESTIMATE: 'estimate',
};

const MATCH_REASON_LABELS = {
  [CLIENT_ACCOUNT_MATCH_REASONS.ACCOUNT_NAME]: 'Account name',
  [CLIENT_ACCOUNT_MATCH_REASONS.VISIBLE_ALIAS]: 'Visible alias',
  [CLIENT_ACCOUNT_MATCH_REASONS.HISTORICAL_SOURCE_NAME]: 'Historical source name',
  [CLIENT_ACCOUNT_MATCH_REASONS.PERSON]: 'Person',
  [CLIENT_ACCOUNT_MATCH_REASONS.CONTACT_METHOD]: 'Phone or email',
  [CLIENT_ACCOUNT_MATCH_REASONS.LOCATION]: 'Location',
  [CLIENT_ACCOUNT_MATCH_REASONS.WORK_ORDER]: 'Work order',
  [CLIENT_ACCOUNT_MATCH_REASONS.ESTIMATE]: 'Estimate',
};

const MATCH_REASON_RANK = {
  [CLIENT_ACCOUNT_MATCH_REASONS.ACCOUNT_NAME]: 0,
  [CLIENT_ACCOUNT_MATCH_REASONS.VISIBLE_ALIAS]: 1,
  [CLIENT_ACCOUNT_MATCH_REASONS.HISTORICAL_SOURCE_NAME]: 2,
  [CLIENT_ACCOUNT_MATCH_REASONS.CONTACT_METHOD]: 3,
  [CLIENT_ACCOUNT_MATCH_REASONS.PERSON]: 4,
  [CLIENT_ACCOUNT_MATCH_REASONS.LOCATION]: 5,
  [CLIENT_ACCOUNT_MATCH_REASONS.WORK_ORDER]: 6,
  [CLIENT_ACCOUNT_MATCH_REASONS.ESTIMATE]: 7,
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeAccountSearchText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAccountSearchDigits(value) {
  return cleanText(value).replace(/\D+/g, '');
}

function textMatches(value, normalizedQuery) {
  if (!normalizedQuery) return false;
  return normalizeAccountSearchText(value).includes(normalizedQuery);
}

function digitsMatch(value, queryDigits) {
  if (!queryDigits || queryDigits.length < 3) return false;
  return normalizeAccountSearchDigits(value).includes(queryDigits);
}

function firstByPriority(rows) {
  return [...rows].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    if (left.status !== right.status) {
      if (left.status === 'active') return -1;
      if (right.status === 'active') return 1;
    }
    return cleanText(left.value || left.name || left.label || left.address).localeCompare(
      cleanText(right.value || right.name || right.label || right.address),
    );
  })[0] || null;
}

function addReason(reasons, code) {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push({
    code,
    label: MATCH_REASON_LABELS[code] || code,
  });
}

function locationText(location) {
  return [
    location.label,
    location.address,
    location.city,
    location.state,
    location.postalCode,
  ].filter(Boolean).join(' ');
}

function contactMethodLabel(method) {
  const type = cleanText(method?.methodType);
  const label = cleanText(method?.label);
  if (label && type) return `${label} ${type}`;
  return label || type || 'Contact';
}

function operationalSummary({ linkedContacts, accountWorkOrders, accountEstimates }) {
  const parts = [];
  if (linkedContacts.length) {
    parts.push(`${linkedContacts.length} linked contact${linkedContacts.length === 1 ? '' : 's'}`);
  }
  if (accountWorkOrders.length) {
    parts.push(`${accountWorkOrders.length} work order${accountWorkOrders.length === 1 ? '' : 's'}`);
  }
  if (accountEstimates.length) {
    parts.push(`${accountEstimates.length} estimate${accountEstimates.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

function newestDated(rows) {
  return [...rows].sort((left, right) => {
    const leftDate = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightDate = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightDate - leftDate;
  })[0] || null;
}

export function buildClientAccountResult({
  account,
  businessUnit = null,
  aliases = [],
  people = [],
  contactMethods = [],
  locations = [],
  linkedContacts = [],
  accountWorkOrders = [],
  accountEstimates = [],
  query = '',
  includeDetail = false,
} = {}) {
  const normalizedQuery = normalizeAccountSearchText(query);
  const queryDigits = normalizeAccountSearchDigits(query);
  const visibleAliases = aliases
    .filter((alias) => alias.visibility === 'visible')
    .map((alias) => cleanText(alias.value))
    .filter(Boolean);
  const hiddenAliases = aliases.filter((alias) => alias.visibility !== 'visible');
  const searchableAliases = aliases.filter((alias) => alias.searchable !== false);
  const primaryPerson = firstByPriority(people);
  const primaryContactMethod = firstByPriority(contactMethods);
  const primaryLocation = firstByPriority(locations);
  const latestWorkOrder = newestDated(accountWorkOrders);
  const latestEstimate = newestDated(accountEstimates);
  const matchReasons = [];

  if (normalizedQuery) {
    if (textMatches(account?.displayName, normalizedQuery) || textMatches(account?.normalizedName, normalizedQuery)) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.ACCOUNT_NAME);
    }

    for (const alias of searchableAliases) {
      if (!textMatches(alias.value, normalizedQuery) && !textMatches(alias.normalizedValue, normalizedQuery)) continue;
      addReason(
        matchReasons,
        alias.visibility === 'visible'
          ? CLIENT_ACCOUNT_MATCH_REASONS.VISIBLE_ALIAS
          : CLIENT_ACCOUNT_MATCH_REASONS.HISTORICAL_SOURCE_NAME,
      );
    }

    if (people.some((person) => textMatches(person.name, normalizedQuery) || textMatches(person.role, normalizedQuery))) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.PERSON);
    }

    if (contactMethods.some((method) => (
      textMatches(method.value, normalizedQuery) ||
      textMatches(method.normalizedValue, normalizedQuery) ||
      textMatches(method.label, normalizedQuery) ||
      digitsMatch(method.value, queryDigits) ||
      digitsMatch(method.normalizedValue, queryDigits)
    ))) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.CONTACT_METHOD);
    }

    if (locations.some((location) => textMatches(locationText(location), normalizedQuery))) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.LOCATION);
    }

    if (accountWorkOrders.some((workOrder) => (
      textMatches(workOrder.workOrderNumber, normalizedQuery) ||
      textMatches(workOrder.title, normalizedQuery)
    ))) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.WORK_ORDER);
    }

    if (accountEstimates.some((estimate) => textMatches(estimate.estimateNumber, normalizedQuery))) {
      addReason(matchReasons, CLIENT_ACCOUNT_MATCH_REASONS.ESTIMATE);
    }
  }

  const status = account?.status || 'active';
  const displayName = cleanText(account?.displayName);
  const primaryContactValue = cleanText(primaryContactMethod?.value);
  const primaryLocationText = primaryLocation ? locationText(primaryLocation) : '';

  const result = {
    id: account?.id,
    href: account?.id ? `/client-accounts/${account.id}` : '',
    title: displayName,
    displayName,
    status,
    tags: asArray(account?.tagsJson),
    businessUnitId: account?.businessUnitId || null,
    businessUnitName: businessUnit?.name || null,
    visibleAliases,
    hiddenAliasCount: hiddenAliases.length,
    matchedHiddenAliasCount: normalizedQuery && matchReasons.some(
      (reason) => reason.code === CLIENT_ACCOUNT_MATCH_REASONS.HISTORICAL_SOURCE_NAME,
    ) ? hiddenAliases.length : 0,
    primaryPersonName: primaryPerson?.name || null,
    primaryPersonRole: primaryPerson?.role || null,
    primaryContactMethod: primaryContactMethod ? {
      id: primaryContactMethod.id,
      type: primaryContactMethod.methodType,
      label: contactMethodLabel(primaryContactMethod),
      value: primaryContactValue,
      status: primaryContactMethod.status,
    } : null,
    primaryLocation: primaryLocation ? {
      id: primaryLocation.id,
      label: primaryLocation.label || null,
      address: primaryLocation.address || null,
      city: primaryLocation.city || null,
      state: primaryLocation.state || null,
      postalCode: primaryLocation.postalCode || null,
      text: primaryLocationText,
    } : null,
    peopleCount: people.length,
    contactMethodCount: contactMethods.length,
    locationCount: locations.length,
    linkedContactCount: linkedContacts.length,
    workOrderCount: accountWorkOrders.length,
    estimateCount: accountEstimates.length,
    latestWorkOrderNumber: latestWorkOrder?.workOrderNumber || null,
    latestEstimateNumber: latestEstimate?.estimateNumber || null,
    operationalSummary: operationalSummary({ linkedContacts, accountWorkOrders, accountEstimates }),
    matchReasons,
    matchReasonCodes: matchReasons.map((reason) => reason.code),
  };

  if (includeDetail) {
    result.people = people.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role || null,
      notes: person.notes || null,
      isPrimary: Boolean(person.isPrimary),
      sourceLabel: person.sourceLabel || null,
    }));
    result.contactMethods = contactMethods.map((method) => ({
      id: method.id,
      type: method.methodType,
      label: contactMethodLabel(method),
      value: method.value,
      status: method.status,
      isPrimary: Boolean(method.isPrimary),
      sourceLabel: method.sourceLabel || null,
    }));
    result.locations = locations.map((location) => ({
      id: location.id,
      label: location.label || null,
      address: location.address || null,
      city: location.city || null,
      state: location.state || null,
      postalCode: location.postalCode || null,
      text: locationText(location),
      isPrimary: Boolean(location.isPrimary),
      sourceLabel: location.sourceLabel || null,
    }));
    result.linkedContacts = linkedContacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone || null,
      email: contact.email || null,
      sourceLabel: contact.sourceLabel || null,
    }));
    result.workOrders = accountWorkOrders.map((workOrder) => ({
      id: workOrder.id,
      contactId: workOrder.contactId || null,
      workOrderNumber: workOrder.workOrderNumber || null,
      title: workOrder.title || null,
      status: workOrder.status || null,
      createdAt: workOrder.createdAt || null,
      updatedAt: workOrder.updatedAt || null,
    }));
    result.estimates = accountEstimates.map((estimate) => ({
      id: estimate.id,
      contactId: estimate.contactId || null,
      estimateNumber: estimate.estimateNumber || null,
      status: estimate.status || null,
      total: estimate.total || null,
      createdAt: estimate.createdAt || null,
      updatedAt: estimate.updatedAt || null,
    }));
    result.provenanceAliases = hiddenAliases.map((alias) => ({
      id: alias.id,
      value: alias.value,
      type: alias.type,
      sourceLabel: alias.sourceLabel || null,
      sourceSheet: alias.sourceSheet || null,
      sourceRow: alias.sourceRow || null,
      confidence: alias.confidence || null,
    }));
  }

  return result;
}

export function filterAndRankClientAccountResults(results, query = '', limit = 50) {
  const hasQuery = Boolean(normalizeAccountSearchText(query));
  const ranked = results
    .filter((result) => !hasQuery || result.matchReasons.length)
    .sort((left, right) => {
      if (hasQuery) {
        const leftRank = MATCH_REASON_RANK[left.matchReasonCodes[0]] ?? 99;
        const rightRank = MATCH_REASON_RANK[right.matchReasonCodes[0]] ?? 99;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return cleanText(left.displayName).localeCompare(cleanText(right.displayName));
    });
  return ranked.slice(0, Math.max(0, limit));
}

function groupByAccountId(rows) {
  return rows.reduce((groups, row) => {
    const accountId = row.clientAccountId;
    if (!accountId) return groups;
    if (!groups.has(accountId)) groups.set(accountId, []);
    groups.get(accountId).push(row);
    return groups;
  }, new Map());
}

function combineWhere(parts) {
  return parts.length === 1 ? parts[0] : and(...parts);
}

async function selectIfAny(ids, loader) {
  if (!ids.length) return [];
  return loader(ids);
}

export async function listClientAccountResults({
  db,
  organizationId,
  businessUnitIds = null,
  accountId = '',
  query = '',
  limit = 50,
  includeDetail = false,
} = {}) {
  if (!db) throw new Error('db is required.');
  if (!organizationId) throw new Error('organizationId is required.');
  if (Array.isArray(businessUnitIds) && !businessUnitIds.length) return [];

  const accountWhere = [eq(clientAccounts.organizationId, organizationId)];
  if (accountId) {
    accountWhere.push(eq(clientAccounts.id, accountId));
  }
  if (Array.isArray(businessUnitIds)) {
    accountWhere.push(inArray(clientAccounts.businessUnitId, businessUnitIds));
  }

  const accountRows = await db
    .select({
      account: clientAccounts,
      businessUnit: {
        id: businessUnits.id,
        name: businessUnits.name,
      },
    })
    .from(clientAccounts)
    .leftJoin(businessUnits, eq(clientAccounts.businessUnitId, businessUnits.id))
    .where(combineWhere(accountWhere))
    .orderBy(asc(clientAccounts.normalizedName))
    .limit(1000);

  const accountIds = accountRows.map((row) => row.account.id);
  if (!accountIds.length) return [];

  const [
    aliasRows,
    peopleRows,
    contactMethodRows,
    locationRows,
    linkedContactRows,
  ] = await Promise.all([
    selectIfAny(accountIds, (ids) => db
      .select()
      .from(clientAccountAliases)
      .where(and(
        eq(clientAccountAliases.organizationId, organizationId),
        inArray(clientAccountAliases.clientAccountId, ids),
      ))
      .orderBy(asc(clientAccountAliases.visibility), asc(clientAccountAliases.value))),
    selectIfAny(accountIds, (ids) => db
      .select()
      .from(clientPeople)
      .where(and(
        eq(clientPeople.organizationId, organizationId),
        inArray(clientPeople.clientAccountId, ids),
      ))
      .orderBy(desc(clientPeople.isPrimary), asc(clientPeople.name))),
    selectIfAny(accountIds, (ids) => db
      .select()
      .from(clientContactMethods)
      .where(and(
        eq(clientContactMethods.organizationId, organizationId),
        inArray(clientContactMethods.clientAccountId, ids),
      ))
      .orderBy(desc(clientContactMethods.isPrimary), asc(clientContactMethods.methodType), asc(clientContactMethods.value))),
    selectIfAny(accountIds, (ids) => db
      .select()
      .from(clientLocations)
      .where(and(
        eq(clientLocations.organizationId, organizationId),
        inArray(clientLocations.clientAccountId, ids),
      ))
      .orderBy(desc(clientLocations.isPrimary), asc(clientLocations.address))),
    selectIfAny(accountIds, (ids) => db
      .select({
        id: contacts.id,
        clientAccountId: contacts.clientAccountId,
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
        sourceLabel: contacts.sourceLabel,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(and(
        eq(contacts.organizationId, organizationId),
        inArray(contacts.clientAccountId, ids),
      ))
      .orderBy(asc(contacts.name))),
  ]);

  const linkedContactIds = linkedContactRows.map((row) => row.id);
  const [workOrderRows, estimateRows] = await Promise.all([
    selectIfAny(linkedContactIds, (ids) => db
      .select({
        id: workOrders.id,
        contactId: workOrders.contactId,
        workOrderNumber: workOrders.workOrderNumber,
        title: workOrders.title,
        status: workOrders.status,
        createdAt: workOrders.createdAt,
        updatedAt: workOrders.updatedAt,
      })
      .from(workOrders)
      .where(and(
        eq(workOrders.organizationId, organizationId),
        inArray(workOrders.contactId, ids),
      ))
      .orderBy(desc(workOrders.updatedAt), desc(workOrders.createdAt))),
    selectIfAny(linkedContactIds, (ids) => db
      .select({
        id: estimates.id,
        contactId: estimates.contactId,
        estimateNumber: estimates.estimateNumber,
        status: estimates.status,
        total: estimates.total,
        createdAt: estimates.createdAt,
        updatedAt: estimates.updatedAt,
      })
      .from(estimates)
      .where(and(
        eq(estimates.organizationId, organizationId),
        inArray(estimates.contactId, ids),
      ))
      .orderBy(desc(estimates.updatedAt), desc(estimates.createdAt))),
  ]);

  const aliasesByAccount = groupByAccountId(aliasRows);
  const peopleByAccount = groupByAccountId(peopleRows);
  const contactMethodsByAccount = groupByAccountId(contactMethodRows);
  const locationsByAccount = groupByAccountId(locationRows);
  const contactsByAccount = groupByAccountId(linkedContactRows);
  const contactToAccountId = new Map(linkedContactRows.map((row) => [row.id, row.clientAccountId]));
  const workOrdersByAccount = groupByAccountId(workOrderRows.map((row) => ({
    ...row,
    clientAccountId: contactToAccountId.get(row.contactId),
  })));
  const estimatesByAccount = groupByAccountId(estimateRows.map((row) => ({
    ...row,
    clientAccountId: contactToAccountId.get(row.contactId),
  })));

  return filterAndRankClientAccountResults(accountRows.map(({ account, businessUnit }) => buildClientAccountResult({
    account,
    businessUnit,
    aliases: aliasesByAccount.get(account.id) || [],
    people: peopleByAccount.get(account.id) || [],
    contactMethods: contactMethodsByAccount.get(account.id) || [],
    locations: locationsByAccount.get(account.id) || [],
    linkedContacts: contactsByAccount.get(account.id) || [],
    accountWorkOrders: workOrdersByAccount.get(account.id) || [],
    accountEstimates: estimatesByAccount.get(account.id) || [],
    query,
    includeDetail,
  })), query, limit);
}
