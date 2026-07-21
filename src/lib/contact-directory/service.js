import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import {
  activityEvents,
  businessUnits,
  contactCourseRecords,
  contactPeople,
  conversationMessages,
  contacts,
  estimates,
  financialDocuments,
  leads,
  notes,
  paymentSnapshots,
  users,
  workOrders,
} from '@/db/schema.js';
import {
  mapContacts,
  mapFinancials,
  mapWorkOrders,
} from '@/lib/bootstrap-data.js';
import { loadContactBootstrapSummaryRows } from '@/lib/contact-summary-loader.js';
import { attachPaymentSnapshotContactLinks } from '@/lib/financial-linkage.js';
import {
  contactLeadAccessWhere,
  scopedBusinessUnitWhere,
  scopedContactWhere,
  scopedOrgWhere,
} from '@/lib/crm/access.js';
import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from '@/lib/crm/lifecycle.js';
import { searchPattern, searchPhoneDigits } from '@/lib/search/match.js';
import { canonicalAitUsaSchoolLocation } from '@/lib/school-locations.js';
import {
  contactDirectoryModeForRequest,
  normalizeContactDirectorySort,
} from '@/lib/contacts/directory-sort.js';

export const CONTACT_DIRECTORY_PAGE_SIZE = 50;
export const CONTACT_DIRECTORY_MAX_PAGE_SIZE = 100;

const FOLLOW_UP_TEXT_NEEDLES = Object.freeze([
  'follow up',
  'follow-up',
  'seguimiento',
  'llamada',
  'llamo',
  'llamó',
  'called',
  'voicemail',
  'no contesta',
  'no answer',
  'whatsapp',
  'mensaje',
  'texted',
]);
const SYSTEM_HISTORY_PATTERN = '^mis-[0-9]+[[:space:]]+.*(cleanup|consolidation|correction|merge|merged|backfill|parser|audit|source-row|artifact|data-fix)';
const SYSTEM_APPROVAL_PATTERN = '^mis-[0-9]+[[:space:]]+approved';

function clean(value = '') {
  return String(value || '').trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedSql(column) {
  return sql`regexp_replace(lower(trim(coalesce(${column}, ''))), '[_-]+', ' ', 'g')`;
}

function nullableNormalizedSql(column) {
  return sql`nullif(lower(trim(coalesce(${column}, ''))), '')`;
}

function importedLeadFieldSql(column, field) {
  const pattern = `(?i)(?:^|\\|)\\s*${field}\\s*=\\s*([^|]+)`;
  return sql`nullif(trim(substring(coalesce(${column}, '') from ${pattern})), '')`;
}

function validCandidateTimeSql(...columns) {
  return sql`coalesce(${sql.join(columns, sql`, `)}) <= now() + interval '1 day'`;
}

function isSystemHistorySql(column) {
  return sql`(
    coalesce(${column}, '') ilike 'ait signs cleanup merged duplicate customer contacts%'
    or lower(trim(coalesce(${column}, ''))) ~ ${SYSTEM_HISTORY_PATTERN}
    or lower(trim(coalesce(${column}, ''))) ~ ${SYSTEM_APPROVAL_PATTERN}
  )`;
}

function containsFollowUpTextSql(column) {
  return or(...FOLLOW_UP_TEXT_NEEDLES.map((needle) => ilike(column, `%${needle}%`)));
}

function followUpEventConditionSql() {
  return or(
    ilike(activityEvents.eventType, '%follow_up%'),
    ilike(activityEvents.eventType, '%manual_outbound%'),
    ilike(activityEvents.eventType, '%call%'),
    ilike(activityEvents.eventType, '%sms%'),
    ilike(activityEvents.eventType, '%whatsapp%'),
    ilike(activityEvents.eventType, '%message%'),
    containsFollowUpTextSql(activityEvents.message),
  );
}

function touchEventConditionSql() {
  return or(
    sql`lower(coalesce(${activityEvents.eventType}, '')) = 'website_lead_captured'`,
    ilike(activityEvents.eventType, '%follow_up%'),
    ilike(activityEvents.eventType, '%message%'),
    ilike(activityEvents.eventType, '%call%'),
    ilike(activityEvents.eventType, '%sms%'),
    ilike(activityEvents.eventType, '%whatsapp%'),
    ilike(activityEvents.eventType, '%manual_outbound%'),
  );
}

function greatestSql(...expressions) {
  return sql`greatest(${sql.join(expressions, sql`, `)})`;
}

function nonSignsTouchSql({ includeFollowUpNotes = false } = {}) {
  const messageTime = sql`(
    select max(${conversationMessages.occurredAt})
    from ${conversationMessages}
    where ${conversationMessages.contactId} = ${contacts.id}
      and ${conversationMessages.organizationId} = ${contacts.organizationId}
      and ${validCandidateTimeSql(conversationMessages.occurredAt, conversationMessages.createdAt)}
  )`;
  const followUpActivityTime = sql`(
    select max(coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt}))
    from ${activityEvents}
    where ${activityEvents.contactId} = ${contacts.id}
      and ${activityEvents.organizationId} = ${contacts.organizationId}
      and ${validCandidateTimeSql(activityEvents.occurredAt, activityEvents.createdAt)}
      and not ${isSystemHistorySql(activityEvents.message)}
      and ${followUpEventConditionSql()}
  )`;
  const followUpNoteTime = includeFollowUpNotes ? sql`(
    select max(${notes.createdAt})
    from ${notes}
    where ${notes.contactId} = ${contacts.id}
      and ${notes.organizationId} = ${contacts.organizationId}
      and ${validCandidateTimeSql(notes.createdAt)}
      and not ${isSystemHistorySql(notes.body)}
      and ${containsFollowUpTextSql(notes.body)}
  )` : sql`null::timestamptz`;
  const touchActivityTime = sql`(
    select max(coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt}))
    from ${activityEvents}
    where ${activityEvents.contactId} = ${contacts.id}
      and ${activityEvents.organizationId} = ${contacts.organizationId}
      and ${validCandidateTimeSql(activityEvents.occurredAt, activityEvents.createdAt)}
      and not ${isSystemHistorySql(activityEvents.message)}
      and ${touchEventConditionSql()}
  )`;
  const touchTime = greatestSql(messageTime, touchActivityTime);
  if (!includeFollowUpNotes) return touchTime;
  return sql`coalesce(${greatestSql(messageTime, followUpActivityTime, followUpNoteTime)}, ${touchTime})`;
}

function businessUnitConditionSql(ids = []) {
  return ids.length ? inArray(contacts.primaryBusinessUnitId, ids) : sql`false`;
}

function contactLastTouchSql(latestLead, businessUnitRows = []) {
  const signsIds = businessUnitRows
    .filter((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_SIGNS)
    .map((unit) => unit.id);
  const usaIds = businessUnitRows
    .filter((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA)
    .map((unit) => unit.id);
  return sql`case
    when ${businessUnitConditionSql(signsIds)} then ${aitSignsLastTouchSql()}
    when ${businessUnitConditionSql(usaIds)} then ${nonSignsTouchSql({ includeFollowUpNotes: true })}
    else ${nonSignsTouchSql()}
  end`;
}

function sourceCategorySql(latestLead, businessUnitRows = []) {
  const signsIds = businessUnitRows
    .filter((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_SIGNS)
    .map((unit) => unit.id);
  const sourceText = sql`lower(concat_ws(' ', coalesce(${latestLead.sourceName}, ${latestLead.sourceType}), ${contacts.sourceLabel}))`;
  return sql`case
    when ${sourceText} ~ '(website|web form|wix|wordpress)' then 'website form submission'
    when ${businessUnitConditionSql(signsIds)}
      or ${sourceText} ~ '(workbook|xlsx|spreadsheet|archive|work_order|estimate|interesados|ait signs)'
      then 'workbook import'
    when trim(${sourceText}) = '' then 'manual / unknown'
    else 'other source'
  end`;
}

function inquirySourceSql(latestLead) {
  const sourceKey = importedLeadFieldSql(latestLead.originalNotes, 'source_key');
  const source = nullableNormalizedSql(sql`coalesce(${latestLead.sourceName}, ${sourceKey}, ${latestLead.sourceType})`);
  return sql`case
    when ${source} like '%facebook%' or ${source} like '%messenger%' then 'facebook messenger'
    when ${source} like '%wix historical%' or ${source} like '%wix history%' then 'wix historical import'
    when ${source} like '%wix%' then 'wix website form'
    when ${source} like '%wordpress%' then 'wordpress website form'
    when ${source} like '%website%' then 'website form'
    else ${source}
  end`;
}

function contactDirectorySortExpression({ sortKey, latestLead, businessUnitRows }) {
  const expressions = {
    name: nullableNormalizedSql(contacts.name),
    email: nullableNormalizedSql(contacts.email),
    phone: sql`nullif(regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g'), '')`,
    status: nullableNormalizedSql(sql`coalesce(${latestLead.currentStage}, ${latestLead.status})`),
    enrollmentStage: nullableNormalizedSql(sql`coalesce(${latestLead.currentStage}, ${latestLead.status})`),
    assignedLabel: nullableNormalizedSql(sql`coalesce(${users.name}, ${users.email})`),
    divisionLabel: nullableNormalizedSql(businessUnits.name),
    source: nullableNormalizedSql(sql`coalesce(${latestLead.sourceName}, ${latestLead.sourceType}, ${contacts.sourceLabel})`),
    sourceCategoryText: sourceCategorySql(latestLead, businessUnitRows),
    linkedPeopleSummary: sql`(
      select count(*)::integer
      from ${contactPeople}
      where ${contactPeople.contactId} = ${contacts.id}
        and ${contactPeople.organizationId} = ${contacts.organizationId}
    )`,
    studentLocation: nullableNormalizedSql(sql`coalesce(
      nullif(trim(${latestLead.locationPreference}), ''),
      ${importedLeadFieldSql(latestLead.originalNotes, 'address')}
    )`),
    schoolLocation: nullableNormalizedSql(contacts.address),
    inquirySource: inquirySourceSql(latestLead),
    lastTouch: contactLastTouchSql(latestLead, businessUnitRows),
    lastEdited: sql`coalesce(${contacts.updatedAt}, ${contacts.createdAt})`,
  };
  return expressions[sortKey] || null;
}

function contactDirectoryOrderBy({ sort, latestLead, businessUnitRows }) {
  const expression = contactDirectorySortExpression({
    sortKey: sort.key,
    latestLead,
    businessUnitRows,
  });
  if (!expression) return [desc(contacts.createdAt), desc(contacts.id)];
  const orderedExpression = sort.direction === 'desc'
    ? sql`${expression} desc nulls last`
    : sql`${expression} asc nulls last`;
  return [orderedExpression, asc(contacts.id)];
}

function parseDate(value, endOfDay = false) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function aitSignsSourceDateSql(latestLead) {
  const excelDateFromText = (column) => sql`(
    select max(date '1899-12-30' + (match[2])::integer)
    from regexp_matches(
      coalesce(${column}, ''),
      '(^|[^0-9.])([0-9]{5})(\\.0+)?([^0-9]|$)',
      'g'
    ) as match
    where (match[2])::integer between 40000 and 60000
      and date '1899-12-30' + (match[2])::integer <= current_date + 1
  )`;
  return sql`(
    select max(candidate_date) from (
      select ${excelDateFromText(latestLead.originalNotes)} as candidate_date
      union all
      select ${excelDateFromText(activityEvents.message)}
        from ${activityEvents}
        where ${activityEvents.contactId} = ${contacts.id}
      union all
      select ${excelDateFromText(sql`n.body`)}
        from notes n
        where n.contact_id = ${contacts.id}
      union all
      select max(${workOrders.deliveryDate}::timestamp)
        from ${workOrders}
        where ${workOrders.contactId} = ${contacts.id}
      union all
      select max(greatest(${estimates.approvedAt}, ${estimates.rejectedAt}))
        from ${estimates}
        where ${estimates.contactId} = ${contacts.id}
      union all
      select max(ps.paid_at::timestamp)
        from payment_snapshots ps
        left join estimates pe on pe.id = ps.estimate_id
        left join work_orders pw on pw.id = ps.work_order_id
        where pe.contact_id = ${contacts.id} or pw.contact_id = ${contacts.id}
    ) source_dates
  )`;
}

function aitSignsLastTouchSql() {
  const excelDateFromText = (column) => sql`(
    select max(date '1899-12-30' + (match[2])::integer)
    from regexp_matches(
      coalesce(${column}, ''),
      '(^|[^0-9.])([0-9]{5})(\\.0+)?([^0-9]|$)',
      'g'
    ) as match
    where (match[2])::integer between 40000 and 60000
      and date '1899-12-30' + (match[2])::integer <= current_date + 1
  )`;
  const bounded = (candidate) => sql`case
    when ${candidate} <= now() + interval '1 day' then ${candidate}
    else null
  end`;
  const pipeDelimitedHistory = (column) => sql`(
    length(coalesce(${column}, '')) - length(replace(coalesce(${column}, ''), '|', ''))
  ) >= 3`;
  const eventText = sql`coalesce(nullif(${activityEvents.message}, ''), ${activityEvents.eventType}, '')`;
  const eventImported = or(
    sql`left(lower(coalesce(${activityEvents.eventType}, '')), 7) = 'import_'`,
    sql`${activityEvents.sourceSheet} is not null`,
    sql`${activityEvents.sourceRow} is not null`,
    pipeDelimitedHistory(eventText),
  );
  const eventCandidate = sql`coalesce(
    ${excelDateFromText(eventText)}::timestamptz,
    case when not ${eventImported} then coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt}) end
  )`;
  const noteCandidate = sql`coalesce(
    ${excelDateFromText(notes.body)}::timestamptz,
    case when not ${pipeDelimitedHistory(notes.body)} then ${notes.createdAt} end
  )`;
  const workOrderText = sql`coalesce(nullif(${workOrders.description}, ''), nullif(${workOrders.title}, ''), ${workOrders.workOrderNumber}, '')`;
  const workOrderCandidate = sql`coalesce(
    ${excelDateFromText(workOrderText)}::timestamptz,
    case when not ${pipeDelimitedHistory(workOrderText)}
      then coalesce(${workOrders.deliveryDate}::timestamptz, ${workOrders.createdAt})
    end
  )`;
  const messageTime = sql`(
    select max(${conversationMessages.occurredAt})
    from ${conversationMessages}
    where ${conversationMessages.contactId} = ${contacts.id}
      and ${conversationMessages.organizationId} = ${contacts.organizationId}
      and ${validCandidateTimeSql(conversationMessages.occurredAt, conversationMessages.createdAt)}
  )`;
  const eventTime = sql`(
    select max(${bounded(eventCandidate)})
    from ${activityEvents}
    where ${activityEvents.contactId} = ${contacts.id}
      and ${activityEvents.organizationId} = ${contacts.organizationId}
      and not ${isSystemHistorySql(eventText)}
  )`;
  const noteTime = sql`(
    select max(${bounded(noteCandidate)})
    from ${notes}
    where ${notes.contactId} = ${contacts.id}
      and ${notes.organizationId} = ${contacts.organizationId}
      and not ${isSystemHistorySql(notes.body)}
  )`;
  const workOrderTime = sql`(
    select max(${bounded(workOrderCandidate)})
    from ${workOrders}
    where ${workOrders.contactId} = ${contacts.id}
      and ${workOrders.organizationId} = ${contacts.organizationId}
  )`;
  const estimateTime = sql`(
    select max(${bounded(sql`greatest(${estimates.approvedAt}, ${estimates.rejectedAt})`)})
    from ${estimates}
    where ${estimates.contactId} = ${contacts.id}
      and ${estimates.organizationId} = ${contacts.organizationId}
  )`;
  const paymentTime = sql`(
    select max(${bounded(sql`${paymentSnapshots.paidAt}::timestamptz`)})
    from ${paymentSnapshots}
    left join ${estimates} pe on pe.id = ${paymentSnapshots.estimateId}
    left join ${workOrders} pw on pw.id = ${paymentSnapshots.workOrderId}
    where ${paymentSnapshots.organizationId} = ${contacts.organizationId}
      and (pe.contact_id = ${contacts.id} or pw.contact_id = ${contacts.id})
  )`;
  return greatestSql(messageTime, eventTime, noteTime, workOrderTime, estimateTime, paymentTime);
}

function directoryDateSql(latestLead, workflowKey) {
  if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) return aitSignsSourceDateSql(latestLead);
  return sql`coalesce(
    (
      select min(coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt}))
      from ${activityEvents}
      where ${activityEvents.contactId} = ${contacts.id}
        and lower(${activityEvents.eventType}) = 'website_lead_captured'
        and (${activityEvents.leadId} is null or ${activityEvents.leadId} = ${latestLead.id})
    ),
    ${latestLead.createdAt},
    ${contacts.createdAt}
  )`;
}

function dateRangeCondition({
  scope,
  from,
  to,
  latestLead,
  workflowKey,
  now = new Date(),
  excludeClosedCurrent = true,
}) {
  if (!scope || scope === 'all') return undefined;
  let start = null;
  let end = null;
  if (scope === 'current') {
    start = new Date(Date.UTC(
      workflowKey === WORKFLOW_KEYS.AIT_SIGNS ? now.getUTCFullYear() - 1 : now.getUTCFullYear(),
      0,
      1,
    ));
    end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  } else if (scope === 'quarter') {
    const month = Math.floor(now.getUTCMonth() / 3) * 3;
    start = new Date(Date.UTC(now.getUTCFullYear(), month, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), month + 3, 1));
  } else if (scope === 'custom') {
    start = parseDate(from);
    const inclusiveEnd = parseDate(to, true);
    end = inclusiveEnd ? new Date(inclusiveEnd.getTime() + 1) : null;
  }
  const leadDate = directoryDateSql(latestLead, workflowKey);
  let dateCondition;
  if (start && end) dateCondition = sql`${leadDate} >= ${start} and ${leadDate} < ${end}`;
  else if (start) dateCondition = sql`${leadDate} >= ${start}`;
  else if (end) dateCondition = sql`${leadDate} < ${end}`;
  if (!dateCondition) return undefined;
  if (!excludeClosedCurrent || scope !== 'current' || workflowKey !== WORKFLOW_KEYS.AIT_USA) return dateCondition;
  const status = normalizedSql(sql`coalesce(${latestLead.currentStage}, ${latestLead.status})`);
  const leadStatus = normalizedSql(latestLead.status);
  return and(
    dateCondition,
    sql`${status} not in ('retargeting', 'dropped / quit', 'not interested', 'course completed')`,
    sql`${leadStatus} not in ('retargeting', 'dropped / quit', 'not interested', 'course completed')`,
  );
}

function sourceCondition(value, latestLead) {
  const source = clean(value).toLowerCase();
  if (!source || source === 'all') return undefined;
  const sourceText = sql`lower(concat_ws(' ', ${latestLead.sourceName}, ${latestLead.sourceType}, ${contacts.sourceLabel}))`;
  if (source === 'website form submission') {
    return sql`${sourceText} ~ '(website|web form|wix|wordpress)'`;
  }
  if (source === 'workbook import') {
    return sql`${sourceText} ~ '(workbook|xlsx|spreadsheet|archive|work_order|estimate|interesados|ait signs)'`;
  }
  if (source === 'manual / unknown') {
    return sql`trim(${sourceText}) = '' or ${sourceText} like '%manual%'`;
  }
  if (source === 'other source') {
    return sql`trim(${sourceText}) <> ''
      and ${sourceText} !~ '(website|web form|wix|wordpress|workbook|xlsx|spreadsheet|archive|work_order|estimate|interesados|ait signs)'`;
  }
  return or(
    eq(normalizedSql(latestLead.sourceName), source),
    eq(normalizedSql(latestLead.sourceType), source),
    eq(normalizedSql(contacts.sourceLabel), source),
  );
}

function courseCondition(value, latestLead) {
  const course = clean(value).toLowerCase();
  if (!course || course === 'all') return undefined;
  return sql`(
    ${normalizedSql(latestLead.currentCourse)} = ${course}
    or ${normalizedSql(latestLead.completedCourse)} = ${course}
    or ${normalizedSql(latestLead.endedCourse)} = ${course}
    or exists (
      select 1 from ${contactCourseRecords}
      where ${contactCourseRecords.contactId} = ${contacts.id}
        and ${normalizedSql(contactCourseRecords.courseName)} = ${course}
    )
  )`;
}

function facetCondition(value, latestLead, session) {
  const facet = clean(value);
  const status = normalizedSql(sql`coalesce(${latestLead.currentStage}, ${latestLead.status})`);
  const assignedUserId = latestLead.assignedUserId;
  const phoneDigits = sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g')`;
  const closedStatuses = ['lost', 'completed', 'not interested', 'course completed', 'dropped / quit'];
  const statusIs = (label) => eq(status, label.toLowerCase());
  if (!facet || facet === 'all') return undefined;
  if (facet === 'mine') return eq(assignedUserId, session.user.id);
  if (facet === 'unassigned') return isNull(assignedUserId);
  if (facet === 'needs_first_outreach') return sql`${status} in ('new lead', 'intake')`;
  if (facet === 'needs_contact_info') return and(
    sql`trim(coalesce(${contacts.phone}, '')) = ''`,
    sql`trim(coalesce(${contacts.email}, '')) = ''`,
  );
  if (facet === 'invalid_phone') return sql`trim(coalesce(${contacts.phone}, '')) <> '' and length(${phoneDigits}) not in (10, 11)`;
  if (facet === 'closed') return inArray(status, closedStatuses);
  if (facet === 'active') return sql`${status} not in ('lost', 'completed', 'not interested', 'course completed', 'dropped / quit')`;
  if (facet === 'no_recent_touch') {
    return sql`not exists (
      select 1 from ${activityEvents}
      where ${activityEvents.contactId} = ${contacts.id}
        and coalesce(${activityEvents.occurredAt}, ${activityEvents.createdAt}) >= now() - interval '30 days'
    )`;
  }
  if (facet === 'signs_linked_people') {
    return sql`exists (select 1 from contact_people cp where cp.contact_id = ${contacts.id})`;
  }
  if (facet === 'signs_payment_balance') {
    return or(
      statusIs('invoice / payment'),
      sql`exists (
        select 1 from ${paymentSnapshots} ps
        left join ${estimates} e on e.id = ps.estimate_id
        left join ${workOrders} wo on wo.id = ps.work_order_id
        where e.contact_id = ${contacts.id} or wo.contact_id = ${contacts.id}
      )`,
    );
  }
  const statusFacets = {
    signs_intake: 'intake',
    signs_estimate: 'estimate',
    signs_work_order: 'work order',
    signs_fulfillment: 'fulfillment',
    signs_invoice_payment: 'invoice / payment',
    usa_new_lead: 'new lead',
    usa_follow_up: 'follow up',
    usa_enrolled: 'enrolled',
    usa_dropped_quit: 'dropped / quit',
    usa_retargeting: 'retargeting',
    usa_not_interested: 'not interested',
    usa_course_completed: 'course completed',
  };
  if (statusFacets[facet]) return statusIs(statusFacets[facet]);
  if (facet === 'usa_bad_contact_channel') {
    return or(
      eq(contacts.isDoNotCall, true),
      eq(contacts.isWrongNumber, true),
      and(sql`trim(coalesce(${contacts.phone}, '')) <> ''`, sql`length(${phoneDigits}) not in (10, 11)`),
    );
  }
  return undefined;
}

function directoryConditions({ searchParams, latestLead, session, workflowKey, excludeClosedCurrent = true }) {
  const conditions = [scopedContactWhere(contacts, session)];
  const businessUnitId = clean(searchParams.get('businessUnitId'));
  if (businessUnitId === 'unassigned') conditions.push(isNull(contacts.primaryBusinessUnitId));
  else if (businessUnitId && businessUnitId !== 'all') {
    const allowed = session.user.canAccessAllBusinessUnits || session.user.businessUnitIds.includes(businessUnitId);
    conditions.push(allowed ? eq(contacts.primaryBusinessUnitId, businessUnitId) : sql`false`);
  }
  conditions.push(contactLeadAccessWhere(contacts, latestLead, session));

  const query = clean(searchParams.get('q'));
  if (query) {
    const pattern = searchPattern(query);
    const phoneDigits = searchPhoneDigits(query);
    conditions.push(or(
      ilike(contacts.name, pattern),
      ilike(contacts.companyName, pattern),
      ilike(contacts.email, pattern),
      ilike(contacts.phone, pattern),
      phoneDigits
        ? sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') like ${`%${phoneDigits}%`}`
        : undefined,
      ilike(contacts.address, pattern),
      ilike(contacts.sourceLabel, pattern),
      ilike(latestLead.sourceType, pattern),
      ilike(latestLead.sourceName, pattern),
      ilike(latestLead.locationPreference, pattern),
      ilike(latestLead.programInterest, pattern),
      ilike(latestLead.currentStage, pattern),
      ilike(latestLead.status, pattern),
      ilike(latestLead.currentCourse, pattern),
      ilike(latestLead.completedCourse, pattern),
      ilike(latestLead.endedCourse, pattern),
      sql`exists (
        select 1 from ${contactCourseRecords}
        where ${contactCourseRecords.contactId} = ${contacts.id}
          and ${contactCourseRecords.courseName} ilike ${pattern}
      )`,
    ));
  }
  const status = clean(searchParams.get('status'));
  if (status && status !== 'All') {
    conditions.push(eq(
      normalizedSql(sql`coalesce(${latestLead.currentStage}, ${latestLead.status})`),
      status.toLowerCase().replace(/[_-]+/g, ' '),
    ));
  }
  const owner = clean(searchParams.get('owner'));
  if (owner === 'unassigned') conditions.push(isNull(latestLead.assignedUserId));
  else if (owner && owner !== 'all') conditions.push(eq(latestLead.assignedUserId, owner));

  const source = sourceCondition(searchParams.get('source'), latestLead);
  if (source) conditions.push(source);
  const course = courseCondition(searchParams.get('course'), latestLead);
  if (course) conditions.push(course);
  const location = canonicalAitUsaSchoolLocation(searchParams.get('location')).toLowerCase();
  if (location) {
    conditions.push(eq(normalizedSql(contacts.address), location));
  }
  const date = dateRangeCondition({
    scope: searchParams.get('leadDateScope'),
    from: searchParams.get('leadDateFrom'),
    to: searchParams.get('leadDateTo'),
    latestLead,
    workflowKey,
    excludeClosedCurrent,
  });
  if (date) conditions.push(date);
  const facet = facetCondition(searchParams.get('facet'), latestLead, session);
  if (facet) conditions.push(facet);
  return conditions;
}

async function contactDirectoryQueryContext({ db, session, searchParams, businessUnitRows = null, excludeClosedCurrent = true }) {
  const units = businessUnitRows || await db.select().from(businessUnits).where(scopedOrgWhere(businessUnits, session));
  const requestedBusinessUnitId = clean(searchParams.get('businessUnitId'));
  const workflowKey = workflowKeyForBusinessUnit(
    units.find((unit) => unit.id === requestedBusinessUnitId) || null,
  );
  const directoryMode = contactDirectoryModeForRequest({
    directoryKind: clean(searchParams.get('directoryKind')) || 'contacts',
    workflowKey,
    hasSingleDivisionScope: Boolean(
      requestedBusinessUnitId &&
      requestedBusinessUnitId !== 'all' &&
      requestedBusinessUnitId !== 'unassigned'
    ),
  });
  const sort = normalizeContactDirectorySort({
    key: searchParams.get('sort'),
    direction: searchParams.get('direction'),
    mode: directoryMode,
  });
  const latestLead = db
    .selectDistinctOn([leads.contactId])
    .from(leads)
    .where(scopedOrgWhere(leads, session))
    .orderBy(leads.contactId, desc(leads.createdAt), desc(leads.id))
    .as('latest_contact_lead');
  const conditions = directoryConditions({
    searchParams,
    latestLead,
    session,
    workflowKey,
    excludeClosedCurrent,
  });
  return {
    businessUnitRows: units,
    requestedBusinessUnitId,
    workflowKey,
    directoryMode,
    sort,
    latestLead,
    where: and(...conditions),
  };
}

export async function countContactDirectoryRows({
  db,
  session,
  searchParams,
  businessUnitRows = null,
  excludeClosedCurrent = true,
}) {
  const context = await contactDirectoryQueryContext({
    db,
    session,
    searchParams,
    businessUnitRows,
    excludeClosedCurrent,
  });
  const rows = await db
    .select({ value: count() })
    .from(contacts)
    .leftJoin(context.latestLead, eq(context.latestLead.contactId, contacts.id))
    .where(context.where);
  return Number(rows[0]?.value || 0);
}

function paymentWhereForPage({ estimateRows, workOrderRows, paymentLinkRows }) {
  const conditions = [];
  const estimateIds = estimateRows.map((row) => row.id);
  const workOrderIds = workOrderRows.map((row) => row.id);
  if (estimateIds.length) conditions.push(inArray(paymentSnapshots.estimateId, estimateIds));
  if (workOrderIds.length) conditions.push(inArray(paymentSnapshots.workOrderId, workOrderIds));
  for (const link of paymentLinkRows) {
    if (!link.sourceSheet || link.sourceRow == null) continue;
    conditions.push(and(
      eq(paymentSnapshots.sourceSheet, link.sourceSheet),
      eq(paymentSnapshots.sourceRow, link.sourceRow),
    ));
  }
  return conditions.length ? or(...conditions) : sql`false`;
}

async function loadCourseOptions({ db, session, businessUnitId }) {
  const leadScope = and(
    scopedBusinessUnitWhere(leads, session),
    businessUnitId && businessUnitId !== 'all' && businessUnitId !== 'unassigned'
      ? eq(leads.businessUnitId, businessUnitId)
      : undefined,
  );
  const courseScope = and(
    scopedBusinessUnitWhere(contactCourseRecords, session),
    businessUnitId && businessUnitId !== 'all' && businessUnitId !== 'unassigned'
      ? eq(contactCourseRecords.businessUnitId, businessUnitId)
      : undefined,
  );
  const groups = await Promise.all([
    db.selectDistinct({ value: contactCourseRecords.courseName }).from(contactCourseRecords).where(courseScope),
    db.selectDistinct({ value: leads.currentCourse }).from(leads).where(leadScope),
    db.selectDistinct({ value: leads.completedCourse }).from(leads).where(leadScope),
    db.selectDistinct({ value: leads.endedCourse }).from(leads).where(leadScope),
  ]);
  return [...new Set(groups.flat().map((row) => clean(row.value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value, count: null }));
}

export async function loadContactDirectoryPage({
  db,
  session,
  searchParams,
  pageSizeLimit = CONTACT_DIRECTORY_MAX_PAGE_SIZE,
}) {
  const page = positiveInteger(searchParams.get('page'), 1);
  const pageSize = Math.min(
    positiveInteger(searchParams.get('pageSize'), CONTACT_DIRECTORY_PAGE_SIZE),
    pageSizeLimit,
  );
  const context = await contactDirectoryQueryContext({ db, session, searchParams });
  const {
    businessUnitRows,
    requestedBusinessUnitId,
    directoryMode,
    sort,
    latestLead,
    where,
  } = context;
  const offset = (page - 1) * pageSize;

  const [idRows, countRows, courseOptions] = await Promise.all([
    db
      .select({ id: contacts.id })
      .from(contacts)
      .leftJoin(latestLead, eq(latestLead.contactId, contacts.id))
      .leftJoin(users, eq(users.id, latestLead.assignedUserId))
      .leftJoin(businessUnits, eq(businessUnits.id, contacts.primaryBusinessUnitId))
      .where(where)
      .orderBy(...contactDirectoryOrderBy({ sort, latestLead, businessUnitRows }))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(contacts)
      .leftJoin(latestLead, eq(latestLead.contactId, contacts.id))
      .where(where),
    loadCourseOptions({ db, session, businessUnitId: requestedBusinessUnitId }),
  ]);
  const contactIds = idRows.map((row) => row.id);
  const total = Number(countRows[0]?.value || 0);
  if (!contactIds.length) {
    return {
      contacts: [],
      workOrders: [],
      financials: [],
      filterMetadata: { courseOptions },
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      directoryMode,
      sortKey: sort.key,
      sortDirection: sort.direction,
    };
  }

  const [contactRows, leadRows, workOrderRows, estimateRows, documentRows] = await Promise.all([
    db.select().from(contacts).where(inArray(contacts.id, contactIds)),
    db.select().from(leads).where(and(scopedBusinessUnitWhere(leads, session), inArray(leads.contactId, contactIds))).orderBy(desc(leads.createdAt), desc(leads.id)),
    db.select().from(workOrders).where(and(scopedBusinessUnitWhere(workOrders, session), inArray(workOrders.contactId, contactIds))).orderBy(desc(workOrders.createdAt)),
    db.select().from(estimates).where(and(scopedBusinessUnitWhere(estimates, session), inArray(estimates.contactId, contactIds))).orderBy(desc(estimates.createdAt)),
    db.select().from(financialDocuments).where(and(scopedBusinessUnitWhere(financialDocuments, session), inArray(financialDocuments.contactId, contactIds))).orderBy(desc(financialDocuments.createdAt)),
  ]);
  const signsBusinessUnitIds = new Set(
    businessUnitRows
      .filter((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_SIGNS)
      .map((unit) => unit.id),
  );
  const signsContactIds = contactRows
    .filter((row) => signsBusinessUnitIds.has(row.primaryBusinessUnitId))
    .map((row) => row.id);
  const summaryRows = await loadContactBootstrapSummaryRows({ db, visibleContactIds: contactIds, signsContactIds });
  const paymentRows = await db
    .select()
    .from(paymentSnapshots)
    .where(and(
      scopedBusinessUnitWhere(paymentSnapshots, session),
      paymentWhereForPage({ estimateRows, workOrderRows, paymentLinkRows: summaryRows.paymentLinkRows }),
    ))
    .orderBy(desc(paymentSnapshots.createdAt));
  const linkedPaymentRows = attachPaymentSnapshotContactLinks(paymentRows, summaryRows.paymentLinkRows, {
    estimateRows,
    workOrderRows,
  });
  const mappedContacts = mapContacts(
    contactRows,
    leadRows,
    summaryRows.noteRows,
    summaryRows.eventRows,
    businessUnitRows,
    session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
    {
      workOrders: workOrderRows,
      estimates: estimateRows,
      paymentSnapshots: linkedPaymentRows,
      conversationMessages: summaryRows.conversationMessageRows,
      contactPeople: summaryRows.contactPeopleRows,
      courseRecords: summaryRows.contactCourseRecordRows,
      leadStatusHistory: summaryRows.leadStatusHistoryRows,
    },
  );
  const orderById = new Map(contactIds.map((id, index) => [id, index]));
  mappedContacts.sort((left, right) => orderById.get(left.id) - orderById.get(right.id));
  const contactLookup = new Map(mappedContacts.map((contact) => [contact.id, contact]));

  return {
    contacts: mappedContacts,
    workOrders: mapWorkOrders(workOrderRows, contactLookup),
    financials: mapFinancials(estimateRows, linkedPaymentRows, contactLookup, documentRows),
    filterMetadata: { courseOptions },
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    directoryMode,
    sortKey: sort.key,
    sortDirection: sort.direction,
  };
}
