'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCRM } from '@/lib/store';
import PageState from '@/components/PageState';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import { aitUsaAssigneeOptionLabel, isEligibleAitUsaAssignee } from '@/lib/crm/ait-usa-assignee.js';
import { validateManualContactIdentity } from '@/lib/crm/contact-input';
import { isClosedLifecycleStatus, WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import {
  buildContactDirectoryFacetGroups,
  CONTACT_DIRECTORY_FACET_GROUPS,
  contactDirectorySignalLabels,
  filterContactsByDirectoryFacet,
} from '@/lib/contact-directory-facets';
import {
  buildCourseFilterOptions,
  buildLocationFilterOptions,
  buildSourceFilterOptions,
  contactLeadDateScopeLabel,
  contactFilterQuery,
  contactFilterStateFromParams,
  contactMatchesLeadDateScope,
  contactMatchesLocation,
  contactMatchesSource,
  contactMatchesStatusOwnerCourse,
  courseTagsForDirectoryRow,
  effectiveLeadDateScopeForContactParams,
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_CUSTOM,
  CONTACT_LEAD_DATE_SCOPE_QUARTER,
  DEFAULT_CONTACT_COURSE_FILTER,
  DEFAULT_CONTACT_FACET_FILTER,
  DEFAULT_CONTACT_LEAD_DATE_FROM,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  DEFAULT_CONTACT_LEAD_DATE_TO,
  DEFAULT_CONTACT_LOCATION_FILTER,
  DEFAULT_CONTACT_OWNER_FILTER,
  DEFAULT_CONTACT_SOURCE_FILTER,
  DEFAULT_CONTACT_STATUS_FILTER,
} from '@/lib/contact-directory-filters';
import {
  clientDirectoryColumnMode,
  directorySourceText,
  enrollmentSourceText,
  enrollmentStageText,
  lifecycleBucket,
} from '@/lib/contact-directory-view';
import { workflowForBusinessUnit } from '@/lib/sales-workflow';
import {
  AIT_USA_SCHOOL_LOCATIONS,
  schoolLocationForContact,
  schoolLocationOptions,
  studentLocationForContact,
} from '@/lib/school-locations';
import { useToast } from '@/components/Toast';
import { useDeferredContactDirectory } from '@/lib/contacts/directory-loader.js';
import {
  contactDirectorySortStateFromParams,
  normalizeContactDirectorySort,
} from '@/lib/contacts/directory-sort.js';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import TimeframeFilterPanel from '@/components/TimeframeFilterPanel';
import { ContactDialogInitialTimelineNote } from '@/components/ContactTimelineNoteFields';
import ContactTerminalStatusReasonField from '@/components/ContactTerminalStatusReasonField';
import { Activity, AlertCircle, BadgeDollarSign, Check, Clock3, ListFilter, PhoneOff, RotateCcw, UserRoundCheck, UsersRound, X } from 'lucide-react';

const empty = {
  name: '',
  email: '',
  phone: '',
  address: '',
  locationPreference: '',
  status: 'New Lead',
  currentStage: 'New Lead',
  source: 'Wix Historical Import',
  assignedTo: '',
  tags: [],
  nextAction: '',
  appendNote: '',
  terminalStatusReason: '',
};

const CONTACT_FILTER_CHIP_LABELS = {
  leadDateScope: 'Timeframe',
  owner: 'Owner',
  status: 'Status',
  source: 'Source',
  course: 'Course',
  location: 'Learning Location',
  facet: 'Segments',
};

const REMOTE_SOURCE_FILTER_OPTIONS = [
  'Facebook Lead Ads',
  'Facebook Messenger',
  'Website Form Submission',
  'Workbook Import',
  'Manual / Unknown',
  'Other Source',
].map((value) => ({ value, label: value, count: null }));

const CONTACT_SEGMENT_GROUPS = [
  {
    id: 'follow_up_signals',
    label: 'Follow-up Signals',
    facets: ['needs_first_contact', 'needs_next_follow_up', 'active', 'no_recent_touch'],
  },
  {
    id: 'contact_quality',
    label: 'Contact Quality',
    facets: ['invalid_phone', 'needs_contact_info', 'usa_bad_contact_channel'],
  },
  {
    id: 'relationship_signals',
    label: 'Relationship Signals',
    facets: ['signs_linked_people', 'signs_payment_balance'],
  },
];

const CONTACT_SEGMENT_META = {
  all: {
    label: 'All Segments',
    description: 'Show every matching contact',
    icon: ListFilter,
  },
  active: {
    description: 'Open records with current work',
    icon: Activity,
  },
  no_recent_touch: {
    description: 'No touch in the last 30 days',
    icon: Clock3,
  },
  needs_first_contact: {
    label: 'Needs first contact',
    description: 'No genuine interaction or dated next commitment',
    icon: UserRoundCheck,
  },
  needs_next_follow_up: {
    label: 'Needs next follow-up',
    description: 'Prior interaction but no dated next commitment',
    icon: Clock3,
  },
  invalid_phone: {
    description: 'Phone number needs cleanup',
    icon: PhoneOff,
  },
  needs_contact_info: {
    description: 'Missing phone and email',
    icon: AlertCircle,
  },
  usa_bad_contact_channel: {
    label: 'Bad Contact Channel',
    description: 'Wrong number, do-not-contact, or no reachable channel',
    icon: PhoneOff,
  },
  signs_linked_people: {
    description: 'Contacts connected to other people',
    icon: UsersRound,
  },
  signs_payment_balance: {
    description: 'Payment or balance activity exists',
    icon: BadgeDollarSign,
  },
};

function ownerInitials(label = '') {
  const parts = String(label || '')
    .replace(/@.*/, '')
    .split(/\s+|[._-]/)
    .filter(Boolean)
    .slice(0, 2);
  return (parts.map((part) => part[0]).join('') || 'U').toUpperCase();
}

function ownerMeta(employee = {}) {
  const role = (employee.roleKeys || [])
    .map((key) => String(key).replaceAll('_', ' '))
    .join(', ');
  return role || employee.email || 'Team member';
}

function matchesOwnerSearch(owner, query) {
  if (!query) return true;
  const haystack = [owner.label, owner.email, owner.meta].join(' ').toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function canManageAitUsaAssignmentsForUser(user) {
  const roleKeys = [user?.primaryRoleKey, ...(user?.roleKeys || [])].filter(Boolean);
  return roleKeys.some((key) => ['admin', 'senior_coordinator'].includes(String(key).trim()));
}

const ALWAYS_VISIBLE_SEGMENT_IDS = new Set([
  'needs_first_contact',
  'needs_next_follow_up',
]);

function buildVisibleSegmentGroups(facetGroups = [], activeFacetId = 'all') {
  const facetById = new Map(
    facetGroups.flatMap((group) => group.facets.map((facet) => [facet.id, facet])),
  );
  const allFacet = facetById.get('all') || { id: 'all', label: 'All', count: 0 };
  const groups = CONTACT_SEGMENT_GROUPS
    .map((group) => ({
      ...group,
      facets: group.facets
        .map((id) => facetById.get(id))
        .filter((facet) => facet && (
          facet.count > 0 ||
          activeFacetId === facet.id ||
          ALWAYS_VISIBLE_SEGMENT_IDS.has(facet.id)
        )),
    }))
    .filter((group) => group.facets.length > 0);
  const visibleIds = new Set(['all', ...groups.flatMap((group) => group.facets.map((facet) => facet.id))]);
  return { allFacet, groups, visibleIds };
}

function SegmentIcon({ id }) {
  const Icon = CONTACT_SEGMENT_META[id]?.icon || ListFilter;
  return (
    <span className="contacts-segment-icon" aria-hidden="true">
      <Icon size={15} />
    </span>
  );
}

function SegmentTile({ facet, active, onClick }) {
  const meta = CONTACT_SEGMENT_META[facet.id] || {};
  return (
    <button
      type="button"
      className={`contacts-segment-row ${active ? 'active' : ''} ${facet.count === 0 ? 'is-empty' : ''}`}
      onClick={onClick}
      disabled={facet.count === 0 && !active}
      aria-pressed={active}
    >
      <SegmentIcon id={facet.id} />
      <span className="contacts-segment-copy">
        <strong>{meta.label || facet.label}</strong>
        <small>{meta.description || 'Signal-based contact segment'}</small>
      </span>
      {facet.count != null && <span className="contacts-segment-count">{facet.count}</span>}
      <span className="contacts-segment-check" aria-hidden="true" />
    </button>
  );
}

function TagList({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <div className="workflow-tags">
      {tags.slice(0, 3).map((tag) => (
        <span key={tag} className="workflow-tag">{tag.replaceAll('_', ' ')}</span>
      ))}
    </div>
  );
}

function WorkflowCell({ row }) {
  const stageLabel = row.needsFirstOutreach && row.status ? row.status : (row.currentStage || row.status);
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        {row.needsFirstOutreach ? <AlertCircle size={13} /> : <UserRoundCheck size={13} />}
        <span>{stageLabel}</span>
      </div>
      {row.nextAction && <div className="workflow-next">{row.nextAction}</div>}
      <TagList tags={row.tags || []} />
    </div>
  );
}

function SignalCell({ row }) {
  if (!row.signalLabels?.length) return <span className="contacts-signal-empty">—</span>;
  return (
    <div className="contacts-signal-list">
      {row.signalLabels.map((label) => (
        <span key={label} className="contacts-signal-pill">{label}</span>
      ))}
    </div>
  );
}

function PeopleCell({ row }) {
  if (!row.linkedPeopleCount) return <span className="contacts-signal-empty">—</span>;
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        <UserRoundCheck size={13} />
        <span>{row.linkedPeopleCount} {row.linkedPeopleCount === 1 ? 'person' : 'people'}</span>
      </div>
      {row.linkedPeoplePreview && <div className="workflow-next">{row.linkedPeoplePreview}</div>}
    </div>
  );
}

function RecentWorkCell({ row }) {
  if (row.accountSnapshotText) return <span>{row.accountSnapshotText}</span>;
  return <span className="contacts-signal-empty">No recent work</span>;
}

function EnrollmentCell({ row }) {
  const courseTags = courseTagsForDirectoryRow(row);
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        <UserRoundCheck size={13} />
        <span>{enrollmentStageText(row)}</span>
      </div>
      {row.nextAction && <div className="workflow-next">{row.nextAction}</div>}
      <TagList tags={courseTags} />
    </div>
  );
}

function EnrollmentSourceCell({ row }) {
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        <span>{enrollmentSourceText(row)}</span>
      </div>
      {row.latestCommentLabel && <div className="workflow-next">{row.latestCommentLabel}</div>}
    </div>
  );
}

function SourceCell({ row }) {
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        <span>{directorySourceText(row)}</span>
      </div>
      {row.sourceActivityDate && <div className="workflow-next">{String(row.sourceActivityDate).slice(0, 10)}</div>}
    </div>
  );
}

function BucketCell({ row }) {
  const bucket = lifecycleBucket(row);
  return (
    <div className="contacts-bucket-cell">
      <span className={`contacts-bucket-pill tone-${bucket.tone}`}>{bucket.label}</span>
      {bucket.detail && <div className="workflow-next">{bucket.detail}</div>}
    </div>
  );
}

export default function ContactsPage({ mode = 'contacts' } = {}) {
  const {
    contacts,
    workOrders,
    financials,
    contactDirectoryIsDeferred,
    addContact,
    updateContact,
    deleteContact,
    employees,
    loaded,
    access,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    currentUser,
    canUseConsolidatedScope,
    scopeLabel,
    sources,
  } = useCRM();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawer, setDrawer] = useState(null); // null | 'new' | contact object
  const [form, setForm] = useState(empty);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formError, setFormError] = useState('');
  const [facetNow] = useState(() => Date.now());
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeFilterSection, setActiveFilterSection] = useState('timeframe');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [directoryRefreshKey, setDirectoryRefreshKey] = useState(0);
  const isClientsMode = mode === 'clients';
  const singularLabel = isClientsMode ? 'Client' : 'Contact';
  const pluralLabel = isClientsMode ? 'Clients' : 'Contacts';
  const routeBase = isClientsMode ? '/clients' : '/contacts';
  const {
    statusFilter,
    ownerFilter,
    directoryFacet,
    leadDateScope,
    leadDateFrom,
    leadDateTo,
    courseFilter,
    sourceFilter,
    locationFilter,
  } = contactFilterStateFromParams(searchParams);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const canManageAitUsaAssignments = canManageAitUsaAssignmentsForUser(currentUser);
  const effectiveOwnerFilter = coordinatorUiPolicy.lockedOwnerUserId || ownerFilter;
  const hasExplicitLeadDateFilter =
    searchParams.has('leadDateScope') ||
    searchParams.has('leadDateFrom') ||
    searchParams.has('leadDateTo');
  const ownerFilterImpliesAllLeadDates =
    !coordinatorUiPolicy.ownerScoped &&
    effectiveOwnerFilter !== DEFAULT_CONTACT_OWNER_FILTER &&
    !hasExplicitLeadDateFilter;
  const effectiveLeadDateScope = effectiveLeadDateScopeForContactParams(searchParams);
  const preservedDirectorySort = contactDirectorySortStateFromParams(searchParams);
  const updateFilterQuery = useCallback((patch) => {
    const patchHasLeadDateScope =
      Object.prototype.hasOwnProperty.call(patch, 'leadDateScope') ||
      Object.prototype.hasOwnProperty.call(patch, 'leadDateFrom') ||
      Object.prototype.hasOwnProperty.call(patch, 'leadDateTo');
    const includeLeadDateScope = Object.prototype.hasOwnProperty.call(patch, 'includeLeadDateScope')
      ? patch.includeLeadDateScope
      : hasExplicitLeadDateFilter || patchHasLeadDateScope;
    const filterQuery = contactFilterQuery({
      statusFilter,
      ownerFilter: coordinatorUiPolicy.ownerScoped ? DEFAULT_CONTACT_OWNER_FILTER : ownerFilter,
      directoryFacet,
      leadDateScope,
      leadDateFrom,
      leadDateTo,
      includeLeadDateScope,
      courseFilter,
      sourceFilter,
      locationFilter,
      ...patch,
    });
    const nextParams = new URLSearchParams(filterQuery);
    if (preservedDirectorySort.key) {
      nextParams.set('sort', preservedDirectorySort.key);
      nextParams.set('direction', preservedDirectorySort.direction);
    }
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${routeBase}?${nextQuery}` : routeBase, { scroll: false });
  }, [coordinatorUiPolicy.ownerScoped, courseFilter, directoryFacet, hasExplicitLeadDateFilter, leadDateFrom, leadDateScope, leadDateTo, locationFilter, ownerFilter, preservedDirectorySort.direction, preservedDirectorySort.key, routeBase, router, sourceFilter, statusFilter]);
  useEffect(() => {
    if (!coordinatorUiPolicy.ownerScoped || (!searchParams.has('owner') && !searchParams.has('ownerUserId'))) return;
    updateFilterQuery({ ownerFilter: DEFAULT_CONTACT_OWNER_FILTER });
  }, [coordinatorUiPolicy.ownerScoped, searchParams, updateFilterQuery]);
  useEffect(() => {
    if (!searchParams.has('location') || locationFilter !== DEFAULT_CONTACT_LOCATION_FILTER) return;
    updateFilterQuery({ locationFilter: DEFAULT_CONTACT_LOCATION_FILTER });
  }, [locationFilter, searchParams, updateFilterQuery]);
  const setStatusFilter = useCallback((value) => updateFilterQuery({ statusFilter: value }), [updateFilterQuery]);
  const setOwnerFilter = useCallback((value) => {
    if (coordinatorUiPolicy.ownerScoped) return;
    updateFilterQuery({
      ownerFilter: value,
      ...(!hasExplicitLeadDateFilter && value !== DEFAULT_CONTACT_OWNER_FILTER ? {
        leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
        leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
        leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
      } : {}),
    });
  }, [coordinatorUiPolicy.ownerScoped, hasExplicitLeadDateFilter, updateFilterQuery]);
  const setDirectoryFacet = useCallback((value) => updateFilterQuery({ directoryFacet: value }), [updateFilterQuery]);
  const setLeadDateScope = useCallback((value) => updateFilterQuery({ leadDateScope: value }), [updateFilterQuery]);
  const setLeadDateRange = useCallback((from, to) => updateFilterQuery({
    leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM,
    leadDateFrom: from,
    leadDateTo: to,
  }), [updateFilterQuery]);
  const setCourseFilter = useCallback((value) => updateFilterQuery({ courseFilter: value }), [updateFilterQuery]);
  const setSourceFilter = useCallback((value) => updateFilterQuery({ sourceFilter: value }), [updateFilterQuery]);
  const setLocationFilter = useCallback((value) => updateFilterQuery({ locationFilter: value }), [updateFilterQuery]);

  const deferredDirectory = useDeferredContactDirectory({
    enabled: contactDirectoryIsDeferred,
    searchParams,
    businessUnitId: currentBusinessUnitId,
    directoryKind: isClientsMode ? 'clients' : 'contacts',
    refreshKey: directoryRefreshKey,
  });
  const refreshDirectory = useCallback(() => {
    if (contactDirectoryIsDeferred) setDirectoryRefreshKey((value) => value + 1);
  }, [contactDirectoryIsDeferred]);

  const directoryContacts = useMemo(() => {
    return contactDirectoryIsDeferred ? deferredDirectory.contacts : contacts;
  }, [contactDirectoryIsDeferred, contacts, deferredDirectory.contacts]);
  const directoryWorkOrders = useMemo(() => {
    return contactDirectoryIsDeferred ? deferredDirectory.workOrders : workOrders;
  }, [contactDirectoryIsDeferred, deferredDirectory.workOrders, workOrders]);
  const directoryFinancials = useMemo(() => {
    return contactDirectoryIsDeferred ? deferredDirectory.financials : financials;
  }, [contactDirectoryIsDeferred, deferredDirectory.financials, financials]);
  const directoryBusinessUnitId = currentBusinessUnitId;
  const directoryBusinessUnit = currentBusinessUnit;

  const canWrite = access.canWriteCrm;
  const {
    activeWorkflow,
    businessUnitById,
    contactRows,
    currentScopedBusinessUnitId,
    defaultBusinessUnitId,
    statusOptions,
    statusOptionsForBusinessUnitId,
  } = useContactWorkflowView({
    contacts: directoryContacts,
    workOrders: directoryWorkOrders,
    financials: directoryFinancials,
    employees,
    accessibleBusinessUnits,
    currentBusinessUnitId: directoryBusinessUnitId,
    currentBusinessUnit: directoryBusinessUnit,
  });
  const columnMode = clientDirectoryColumnMode({
    isClientsMode,
    workflowKey: activeWorkflow?.key,
    isSingleDivisionScope: Boolean(currentScopedBusinessUnitId),
  });
  const directorySort = contactDirectorySortStateFromParams(searchParams, { mode: columnMode });
  const setDirectorySort = useCallback(({ key, direction }) => {
    const nextSort = normalizeContactDirectorySort({ key, direction, mode: columnMode });
    const params = new URLSearchParams(searchParams.toString());
    if (nextSort.key) {
      params.set('sort', nextSort.key);
      params.set('direction', nextSort.direction);
    } else {
      params.delete('sort');
      params.delete('direction');
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${routeBase}?${nextQuery}` : routeBase, { scroll: false });
  }, [columnMode, routeBase, router, searchParams]);
  const isAitUsaDirectory = activeWorkflow?.key === WORKFLOW_KEYS.AIT_USA;
  const effectiveLocationFilter = isAitUsaDirectory ? locationFilter : DEFAULT_CONTACT_LOCATION_FILTER;
  const ownerOptions = useMemo(() => {
    return (employees || [])
      .filter((employee) => employee?.id)
      .map((employee) => ({
        id: employee.id,
        label: employee.name || employee.email || 'Unnamed User',
        email: employee.email || '',
        roleKeys: employee.roleKeys || [],
        businessUnitIds: employee.businessUnitIds || [],
        initials: ownerInitials(employee.name || employee.email || 'Unnamed User'),
        meta: ownerMeta(employee),
      }));
  }, [employees]);
  const visibleOwnerOptions = useMemo(
    () => ownerOptions.filter((owner) => owner.id !== currentUser?.id && matchesOwnerSearch(owner, ownerSearch)),
    [currentUser?.id, ownerOptions, ownerSearch],
  );
  const facetContext = useMemo(() => ({
    businessUnitById,
    currentUserId: currentUser?.id,
    now: facetNow,
  }), [businessUnitById, currentUser?.id, facetNow]);
  const directoryRows = useMemo(() => contactRows.map((contact) => {
    const signalLabels = contactDirectorySignalLabels(contact, facetContext);
    const accountSnapshotText = contact.operationalSummary || [
      Number(contact.relatedWorkOrderCount || 0) ? `${contact.relatedWorkOrderCount} work orders` : '',
      Number(contact.relatedEstimateCount || 0) ? `${contact.relatedEstimateCount} estimates` : '',
      Number(contact.relatedPaymentCount || 0) ? `${contact.relatedPaymentCount} payments` : '',
    ].filter(Boolean).join(' · ');
    return {
      ...contact,
      accountSnapshotText,
      linkedPeopleSummary: [
        contact.linkedPeopleCount ? `${contact.linkedPeopleCount} people` : '',
        contact.linkedPeoplePreview || '',
      ].filter(Boolean).join(' '),
      enrollmentStage: enrollmentStageText(contact),
      studentLocation: studentLocationForContact(contact),
      schoolLocation: schoolLocationForContact(contact),
      inquirySource: enrollmentSourceText(contact),
      sourceCategoryText: directorySourceText(contact),
      signalLabels,
      signalText: signalLabels.join(' '),
    };
  }), [contactRows, facetContext]);
  const openNew = () => {
    if (!canWrite) return;
    const defaultStatuses = statusOptionsForBusinessUnitId(defaultBusinessUnitId);
    const defaultBusinessUnit = businessUnitById.get(defaultBusinessUnitId) || null;
    const defaultIsAitUsa = workflowForBusinessUnit(defaultBusinessUnit).key === WORKFLOW_KEYS.AIT_USA;
    setForm({
      ...empty,
      status: defaultStatuses[0] || empty.status,
      currentStage: defaultStatuses[0] || empty.status,
      businessUnitId: defaultBusinessUnitId,
      primaryBusinessUnitId: defaultBusinessUnitId,
      assignedTo: defaultIsAitUsa ? '' : coordinatorUiPolicy.lockedOwnerUserId || empty.assignedTo,
    });
    setFormError('');
    setDrawer('new');
  };
  const openEdit = (row) => {
    if (!canWrite) return;
    setForm({ ...row });
    setFormError('');
    setDrawer(row);
  };
  const close = () => { setDrawer(null); setFormError(''); };
  const requestDelete = () => {
    if (!canWrite || !drawer || drawer === 'new') return;
    setDeleteTarget(drawer);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteContact(deleteTarget.id, { reason: 'Archived from contacts directory.' })
      .then((result) => {
        toast(result?.approvalRequested
          ? `Archive approval requested for ${deleteTarget.name || singularLabel.toLowerCase()}`
          : `${singularLabel} archived`);
        setDeleteTarget(null);
        if (!result?.approvalRequested) close();
        refreshDirectory();
      })
      .catch((error) => toast(error?.message || 'Archive failed.', 'error'));
  };

  const save = () => {
    const validationError = drawer === 'new'
      ? validateManualContactIdentity(form)
      : (!String(form.name || '').trim() ? 'Contact name is required.' : '');
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (
      drawer === 'new' &&
      isAitUsaForm &&
      isClosedLifecycleStatus(form.status, { businessUnit: formBusinessUnit }) &&
      !String(form.terminalStatusReason || '').trim()
    ) {
      setFormError('Outcome reason is required when an AIT USA Opportunity starts in a closed status.');
      return;
    }
    setFormError('');
    const payload = { ...form };
    delete payload.notes;
    delete payload.timeline;
    if (drawer === 'new') {
      payload.appendNote = String(payload.appendNote || '').trim();
      if (!payload.appendNote) delete payload.appendNote;
    } else {
      delete payload.appendNote;
    }
    if (isAitUsaForm && !canManageAitUsaAssignments) {
      delete payload.assignedTo;
    } else if (isAitUsaForm && drawer !== 'new' && payload.assignedTo === drawer.assignedTo) {
      delete payload.assignedTo;
    } else if (coordinatorUiPolicy.lockedOwnerUserId) {
      payload.assignedTo = coordinatorUiPolicy.lockedOwnerUserId;
    }
    if (drawer === 'new') {
      addContact(payload)
        .then(() => {
          toast(`${singularLabel} created successfully`);
          close();
          refreshDirectory();
        })
        .catch((error) => toast(error?.message || `${singularLabel} create failed.`, 'error'));
    } else {
      updateContact(drawer.id, payload)
        .then(() => {
          toast(`${singularLabel} updated successfully`);
          close();
          refreshDirectory();
        })
        .catch((error) => toast(error?.message || `${singularLabel} update failed.`, 'error'));
    }
  };

  const columns = [
    { key: 'name', label: isClientsMode ? 'Client' : 'Name', sortable: true, editable: true },
    ...(columnMode !== 'ait_signs' ? [{ key: 'email', label: 'Email', sortable: true, editable: true }] : []),
    { key: 'phone', label: 'Phone', sortable: true, editable: true },
    ...(columnMode === 'ait_signs' ? [
      { key: 'sourceCategoryText', label: 'Source', sortable: true, render: (row) => <SourceCell row={row} /> },
      { key: 'linkedPeopleSummary', label: 'People', sortable: true, render: (row) => <PeopleCell row={row} /> },
      { key: 'accountSnapshotText', label: 'Recent Work', sortable: false, render: (row) => <RecentWorkCell row={row} /> },
    ] : []),
    ...(columnMode === 'ait_usa' ? [
      { key: 'enrollmentStage', label: 'Enrollment', sortable: true, render: (row) => <EnrollmentCell row={row} /> },
      { key: 'studentLocation', label: 'Student Location', sortable: true },
      { key: 'schoolLocation', label: 'Learning Location', sortable: true },
      { key: 'inquirySource', label: 'Source', sortable: true, render: (row) => <EnrollmentSourceCell row={row} /> },
    ] : []),
    ...(columnMode !== 'ait_usa' ? [{ key: 'status', label: columnMode === 'ait_signs' ? 'Stage' : 'Status', type: 'badge', sortable: true }] : []),
    ...(columnMode === 'contacts' ? [{ key: 'lifecycleBucket', label: 'Activity', sortable: false, render: (row) => <BucketCell row={row} /> }] : []),
    ...(columnMode === 'contacts' ? [{ key: 'workflow', label: 'Next Step', sortable: false, render: (row) => <WorkflowCell row={row} /> }] : []),
    ...(columnMode === 'contacts' ? [{ key: 'signalText', label: 'Signals', sortable: false, render: (row) => <SignalCell row={row} /> }] : []),
    { key: 'assignedLabel', label: 'Owner', sortable: true },
    ...(columnMode === 'contacts' ? [{ key: 'divisionLabel', label: scopeLabel, sortable: true }] : []),
    ...(columnMode === 'contacts' ? [{ key: 'source', label: 'Source', sortable: true }] : []),
    { key: 'lastTouch', label: 'Last Touch', sortable: true },
    { key: 'lastEdited', label: 'Last Edited', sortable: true },
  ];

  const dateScopedRows = useMemo(() => {
    return directoryRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: effectiveLeadDateScope,
      leadDateFrom,
      leadDateTo,
    }));
  }, [directoryRows, effectiveLeadDateScope, leadDateFrom, leadDateTo]);
  const allDateLeadCount = contactDirectoryIsDeferred ? null : directoryRows.length;
  const currentLeadCount = useMemo(
    () => contactDirectoryIsDeferred ? null : directoryRows.filter((contact) => contactMatchesLeadDateScope(contact)).length,
    [contactDirectoryIsDeferred, directoryRows],
  );
  const quarterLeadCount = useMemo(
    () => contactDirectoryIsDeferred ? null : directoryRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_QUARTER,
    })).length,
    [contactDirectoryIsDeferred, directoryRows],
  );
  const customLeadCount = useMemo(
    () => contactDirectoryIsDeferred ? null : directoryRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM,
      leadDateFrom,
      leadDateTo,
    })).length,
    [contactDirectoryIsDeferred, directoryRows, leadDateFrom, leadDateTo],
  );
  const statusOwnerFilteredContacts = useMemo(() => dateScopedRows.filter((contact) => (
    contactMatchesStatusOwnerCourse(contact, {
      statusFilter,
      ownerFilter: effectiveOwnerFilter,
      courseFilter: DEFAULT_CONTACT_COURSE_FILTER,
    })
  )), [dateScopedRows, effectiveOwnerFilter, statusFilter]);
  const sourceFilterOptions = useMemo(
    () => contactDirectoryIsDeferred ? REMOTE_SOURCE_FILTER_OPTIONS : buildSourceFilterOptions(statusOwnerFilteredContacts),
    [contactDirectoryIsDeferred, statusOwnerFilteredContacts],
  );
  const sourceFilteredContacts = useMemo(() => statusOwnerFilteredContacts.filter((contact) => (
    contactMatchesSource(contact, { sourceFilter })
  )), [sourceFilter, statusOwnerFilteredContacts]);
  const courseFilterOptions = useMemo(
    () => contactDirectoryIsDeferred
      ? deferredDirectory.filterMetadata.courseOptions
      : buildCourseFilterOptions(sourceFilteredContacts),
    [contactDirectoryIsDeferred, deferredDirectory.filterMetadata.courseOptions, sourceFilteredContacts],
  );
  const courseFilteredContacts = useMemo(() => sourceFilteredContacts.filter((contact) => (
    contactMatchesStatusOwnerCourse(contact, {
      statusFilter: DEFAULT_CONTACT_STATUS_FILTER,
      ownerFilter: DEFAULT_CONTACT_OWNER_FILTER,
      courseFilter,
    })
  )), [courseFilter, sourceFilteredContacts]);
  const locationFilterOptions = useMemo(
    () => isAitUsaDirectory
      ? (contactDirectoryIsDeferred
        ? AIT_USA_SCHOOL_LOCATIONS.map((value) => ({ value, label: value, count: null }))
        : buildLocationFilterOptions(courseFilteredContacts))
      : [],
    [contactDirectoryIsDeferred, courseFilteredContacts, isAitUsaDirectory],
  );
  const baseFilteredContacts = useMemo(() => courseFilteredContacts.filter((contact) => (
    contactMatchesLocation(contact, { locationFilter: effectiveLocationFilter })
  )), [courseFilteredContacts, effectiveLocationFilter]);
  const facetGroups = useMemo(
    () => contactDirectoryIsDeferred
      ? CONTACT_DIRECTORY_FACET_GROUPS
        .filter((group) => group.alwaysVisible || group.workflowKey === activeWorkflow?.key)
        .map((group) => ({
          ...group,
          facets: group.facets.map((facet) => ({
            id: facet.id,
            label: facet.label,
            count: facet.id === 'all'
              ? deferredDirectory.total
              : deferredDirectory.filterMetadata.facetCounts?.[facet.id] ?? null,
          })),
        }))
      : buildContactDirectoryFacetGroups(baseFilteredContacts, facetContext),
    [activeWorkflow?.key, baseFilteredContacts, contactDirectoryIsDeferred, deferredDirectory.filterMetadata.facetCounts, deferredDirectory.total, facetContext],
  );
  const effectiveDirectoryFacet = directoryFacet || 'all';
  const visibleSegmentGroups = useMemo(
    () => buildVisibleSegmentGroups(facetGroups, effectiveDirectoryFacet),
    [effectiveDirectoryFacet, facetGroups],
  );
  useEffect(() => {
    if (
      directoryFacet &&
      directoryFacet !== DEFAULT_CONTACT_FACET_FILTER &&
      !visibleSegmentGroups.visibleIds.has(directoryFacet)
    ) {
      setDirectoryFacet(DEFAULT_CONTACT_FACET_FILTER);
    }
  }, [directoryFacet, setDirectoryFacet, visibleSegmentGroups.visibleIds]);
  const filteredContacts = useMemo(
    () => filterContactsByDirectoryFacet(baseFilteredContacts, effectiveDirectoryFacet, facetContext),
    [baseFilteredContacts, effectiveDirectoryFacet, facetContext],
  );
  const selectedFacetLabel = useMemo(() => {
    if (effectiveDirectoryFacet === 'all') return '';
    for (const group of facetGroups) {
      const facet = group.facets.find((entry) => entry.id === effectiveDirectoryFacet);
      if (facet) return facet.label;
    }
    return effectiveDirectoryFacet.replaceAll('_', ' ');
  }, [effectiveDirectoryFacet, facetGroups]);
  const selectedOwnerLabel = useMemo(() => {
    if (coordinatorUiPolicy.ownerScoped) return 'My Contacts';
    if (effectiveOwnerFilter === 'all') return '';
    if (effectiveOwnerFilter === 'unassigned') return 'Unassigned';
    return ownerOptions.find((owner) => owner.id === effectiveOwnerFilter)?.label || 'Selected owner';
  }, [coordinatorUiPolicy.ownerScoped, effectiveOwnerFilter, ownerOptions]);
  const selectedCourseLabel = useMemo(() => {
    if (courseFilter === DEFAULT_CONTACT_COURSE_FILTER) return '';
    return courseFilterOptions.find((option) => option.value === courseFilter)?.label || courseFilter;
  }, [courseFilter, courseFilterOptions]);
  const selectedLocationLabel = useMemo(() => {
    if (!isAitUsaDirectory || effectiveLocationFilter === DEFAULT_CONTACT_LOCATION_FILTER) return '';
    return locationFilterOptions.find((option) => option.value === effectiveLocationFilter)?.label || effectiveLocationFilter;
  }, [effectiveLocationFilter, isAitUsaDirectory, locationFilterOptions]);
  const selectedSourceLabel = useMemo(() => {
    if (sourceFilter === DEFAULT_CONTACT_SOURCE_FILTER) return '';
    return sourceFilterOptions.find((option) => option.value === sourceFilter)?.label || sourceFilter;
  }, [sourceFilter, sourceFilterOptions]);
  const selectedDateLabel = useMemo(
    () => contactLeadDateScopeLabel(effectiveLeadDateScope, leadDateFrom, leadDateTo),
    [effectiveLeadDateScope, leadDateFrom, leadDateTo],
  );
  const implicitLeadDate = (coordinatorUiPolicy.ownerScoped && !hasExplicitLeadDateFilter) || ownerFilterImpliesAllLeadDates;
  const dateFilterIsDefault = !hasExplicitLeadDateFilter || implicitLeadDate;
  const activeFilterChips = useMemo(() => [
    !hasExplicitLeadDateFilter || (coordinatorUiPolicy.ownerScoped && implicitLeadDate) ? null : {
      key: 'leadDateScope',
      label: selectedDateLabel,
      primary: !coordinatorUiPolicy.ownerScoped,
      onRemove: dateFilterIsDefault
        ? () => updateFilterQuery({
          leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
          leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
          leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
        })
        : () => updateFilterQuery({
          leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
          leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
          leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
          includeLeadDateScope: false,
        }),
    },
    selectedOwnerLabel ? {
      key: 'owner',
      label: selectedOwnerLabel,
      primary: coordinatorUiPolicy.ownerScoped,
      onRemove: coordinatorUiPolicy.ownerScoped ? null : () => setOwnerFilter(DEFAULT_CONTACT_OWNER_FILTER),
    } : null,
    statusFilter !== DEFAULT_CONTACT_STATUS_FILTER ? {
      key: 'status',
      label: statusFilter,
      onRemove: () => setStatusFilter(DEFAULT_CONTACT_STATUS_FILTER),
    } : null,
    selectedSourceLabel ? {
      key: 'source',
      label: selectedSourceLabel,
      onRemove: () => setSourceFilter(DEFAULT_CONTACT_SOURCE_FILTER),
    } : null,
    selectedCourseLabel ? {
      key: 'course',
      label: selectedCourseLabel,
      onRemove: () => setCourseFilter(DEFAULT_CONTACT_COURSE_FILTER),
    } : null,
    selectedLocationLabel ? {
      key: 'location',
      label: selectedLocationLabel,
      onRemove: () => setLocationFilter(DEFAULT_CONTACT_LOCATION_FILTER),
    } : null,
    selectedFacetLabel ? {
      key: 'facet',
      label: selectedFacetLabel,
      onRemove: () => setDirectoryFacet(DEFAULT_CONTACT_FACET_FILTER),
    } : null,
  ].filter(Boolean), [
    dateFilterIsDefault,
    selectedCourseLabel,
    selectedDateLabel,
    selectedFacetLabel,
    selectedLocationLabel,
    selectedOwnerLabel,
    selectedSourceLabel,
    setCourseFilter,
    setDirectoryFacet,
    setLocationFilter,
    setOwnerFilter,
    coordinatorUiPolicy.ownerScoped,
    setStatusFilter,
    setSourceFilter,
    statusFilter,
    hasExplicitLeadDateFilter,
    implicitLeadDate,
    updateFilterQuery,
  ]);
  const activeFilterCount = activeFilterChips.filter((chip) => chip.onRemove).length;
  const filterSummaryChips = activeFilterChips.filter((chip) => chip.onRemove).slice(0, 3);
  const visibleActiveFilterChips = activeFilterChips.filter((chip) => (
    chip.onRemove ||
    (chip.key === 'owner' && selectedOwnerLabel)
  ));
  const hasNonDefaultLeadDateFilter = hasExplicitLeadDateFilter;
  const hasNonDefaultFilters = hasNonDefaultLeadDateFilter ||
    statusFilter !== DEFAULT_CONTACT_STATUS_FILTER ||
    (!coordinatorUiPolicy.ownerScoped && ownerFilter !== DEFAULT_CONTACT_OWNER_FILTER) ||
    sourceFilter !== DEFAULT_CONTACT_SOURCE_FILTER ||
    courseFilter !== DEFAULT_CONTACT_COURSE_FILTER ||
    effectiveLocationFilter !== DEFAULT_CONTACT_LOCATION_FILTER ||
    effectiveDirectoryFacet !== DEFAULT_CONTACT_FACET_FILTER;
  const filterSections = [
    {
      id: 'timeframe',
      label: 'Timeframe',
      summary: coordinatorUiPolicy.ownerScoped && implicitLeadDate ? 'All owned records' : selectedDateLabel,
    },
    {
      id: 'owner',
      label: 'Owner',
      summary: selectedOwnerLabel || 'All Owners',
    },
    {
      id: 'status',
      label: 'Status',
      summary: statusFilter === DEFAULT_CONTACT_STATUS_FILTER ? 'All Statuses' : statusFilter,
    },
    {
      id: 'source',
      label: 'Source',
      summary: selectedSourceLabel || 'All Sources',
    },
    (courseFilterOptions.length > 0 || courseFilter !== DEFAULT_CONTACT_COURSE_FILTER) ? {
      id: 'course',
      label: 'Course',
      summary: selectedCourseLabel || 'All Courses',
    } : null,
    isAitUsaDirectory ? {
      id: 'location',
      label: 'Learning Location',
      summary: selectedLocationLabel || 'All Learning Locations',
    } : null,
    visibleSegmentGroups.groups.length > 0 ? {
      id: 'segments',
      label: 'Segments',
      summary: selectedFacetLabel || 'All Segments',
    } : null,
  ].filter(Boolean);
  const resetFilters = () => {
    updateFilterQuery({
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
      leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
      leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
      includeLeadDateScope: false,
      statusFilter: DEFAULT_CONTACT_STATUS_FILTER,
      ownerFilter: DEFAULT_CONTACT_OWNER_FILTER,
      sourceFilter: DEFAULT_CONTACT_SOURCE_FILTER,
      directoryFacet: DEFAULT_CONTACT_FACET_FILTER,
      courseFilter: DEFAULT_CONTACT_COURSE_FILTER,
      locationFilter: DEFAULT_CONTACT_LOCATION_FILTER,
    });
  };
  const mobileFieldKeys = columnMode === 'ait_signs'
    ? ['phone', 'sourceCategoryText', 'linkedPeopleSummary', 'accountSnapshotText', 'assignedLabel', 'lastTouch', 'lastEdited']
    : columnMode === 'ait_usa'
      ? ['phone', 'enrollmentStage', 'inquirySource', 'assignedLabel', 'lastTouch', 'lastEdited']
      : ['phone', 'workflow', 'signalText', 'assignedLabel', 'divisionLabel', 'lastTouch', 'lastEdited'];
  const directoryScopeName = directoryBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`;
  const summaryNoun = pluralLabel.toLowerCase();
  const directoryResultCount = contactDirectoryIsDeferred ? deferredDirectory.total : filteredContacts.length;
  const summaryLabel = directoryResultCount === 1 ? singularLabel.toLowerCase() : summaryNoun;
  const directorySummary = `${directoryResultCount.toLocaleString()} matching ${summaryLabel} in ${directoryScopeName}`;
  const formBusinessUnitId = form.businessUnitId || form.primaryBusinessUnitId || '';
  const formBusinessUnit = businessUnitById.get(formBusinessUnitId) || null;
  const isAitUsaForm = workflowForBusinessUnit(formBusinessUnit).key === WORKFLOW_KEYS.AIT_USA;
  const canManageFormAssignments = isAitUsaForm
    ? canManageAitUsaAssignments
    : coordinatorUiPolicy.canManageCoordinatorAssignments;
  const formOwnerOptions = isAitUsaForm
    ? ownerOptions.filter((owner) => (
        isEligibleAitUsaAssignee({ owner, businessUnitId: formBusinessUnitId, actorUserId: currentUser?.id }) ||
        (drawer !== 'new' && owner.id === form.assignedTo)
      ))
    : ownerOptions;
  const formSchoolLocationOptions = schoolLocationOptions(form.address);

  if (!loaded) {
    return <PageState tone="loading" title={`Loading ${pluralLabel.toLowerCase()}`} copy="Preparing the contact directory for your current division scope." />;
  }
  if (contactDirectoryIsDeferred && deferredDirectory.loading && !deferredDirectory.ready) {
    return <PageState tone="loading" title={`Loading ${pluralLabel.toLowerCase()}`} copy="Loading the first 50 matching records for this division." />;
  }
  if (contactDirectoryIsDeferred && deferredDirectory.error && !deferredDirectory.ready) {
    return (
      <PageState
        tone="error"
        title={`${pluralLabel} could not load`}
        copy={deferredDirectory.error}
        actions={<button className="btn btn-primary" type="button" onClick={deferredDirectory.retry}>Try again</button>}
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{pluralLabel}</h1>
          <p className="page-subtitle">{directorySummary}</p>
        </div>
      </div>

      <div className="card contacts-table-card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filteredContacts}
          searchPlaceholder={`Search ${pluralLabel.toLowerCase()} by name, phone, source, location, or course`}
          searchValue={contactDirectoryIsDeferred ? deferredDirectory.search : undefined}
          onSearchChange={contactDirectoryIsDeferred ? deferredDirectory.setSearch : undefined}
          sortKey={contactDirectoryIsDeferred ? directorySort.key : undefined}
          sortDirection={contactDirectoryIsDeferred ? directorySort.direction : undefined}
          onSortChange={contactDirectoryIsDeferred ? setDirectorySort : undefined}
          toolbarAfterSearch={(
            <div className="contacts-filter-popover-anchor">
              <button
                className={`contacts-filter-menu-button ${filterMenuOpen ? 'active' : ''}`}
                type="button"
                onClick={() => setFilterMenuOpen((open) => !open)}
                aria-expanded={filterMenuOpen}
              >
                <ListFilter size={15} />
                Filters
                {hasNonDefaultFilters && <strong>{activeFilterCount}</strong>}
              </button>

              {visibleActiveFilterChips.length > 0 && (
                <div className="contacts-active-filter-chips" aria-label="Active contact filters">
                  {visibleActiveFilterChips.map((chip) => (
                    <span key={chip.key} className="contacts-active-filter-chip">
                      <small>{CONTACT_FILTER_CHIP_LABELS[chip.key] || 'Filter'}</small>
                      <strong>{chip.label}</strong>
                      {chip.onRemove ? (
                        <button
                          type="button"
                          className="contacts-active-filter-chip-remove"
                          onClick={chip.onRemove}
                          aria-label={`Remove ${CONTACT_FILTER_CHIP_LABELS[chip.key] || 'filter'}: ${chip.label}`}
                        >
                          <X size={12} />
                        </button>
                      ) : (
                        <span className="contacts-active-filter-chip-lock" aria-hidden="true">
                          <Check size={12} />
                        </span>
                      )}
                    </span>
                  ))}
                  {hasNonDefaultFilters && (
                    <button className="contacts-filter-reset contacts-filter-reset-inline" type="button" onClick={resetFilters}>
                      <RotateCcw size={13} />
                      Clear all
                    </button>
                  )}
                </div>
              )}

              {filterMenuOpen && (
                <div className="contacts-filter-menu" role="dialog" aria-label="Contact filters">
                  <div className="contacts-filter-menu-header">
                    <div className="contacts-filter-title">
                      <span>Contact filters</span>
                      {hasNonDefaultFilters ? <em>{activeFilterCount}</em> : null}
                    </div>
                    <div className="contacts-filter-menu-actions">
                      {hasNonDefaultFilters && (
                        <button className="contacts-filter-reset contacts-filter-reset-inline" type="button" onClick={resetFilters}>
                          <RotateCcw size={13} />
                          Clear all
                        </button>
                      )}
                      <button
                        type="button"
                        className="contacts-filter-done"
                        onClick={() => setFilterMenuOpen(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>

                  <div className="contacts-filter-summary-strip" aria-label="Selected contact filters">
                    {filterSummaryChips.length > 0 ? (
                      <>
                        {filterSummaryChips.map((chip) => (
                          <span key={chip.key} className="contacts-filter-summary-item">
                            <small>{CONTACT_FILTER_CHIP_LABELS[chip.key] || 'Filter'}</small>
                            <strong>{chip.label}</strong>
                          </span>
                        ))}
                        {activeFilterCount > filterSummaryChips.length && (
                          <span className="contacts-filter-summary-more">+{activeFilterCount - filterSummaryChips.length}</span>
                        )}
                      </>
                    ) : (
                      <span className="contacts-filter-summary-empty">Default contact view</span>
                    )}
                  </div>

                  <div className="contacts-filter-shell">
                    <div className="contacts-filter-section-list" role="tablist" aria-label="Contact filter sections">
                      {filterSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          className={`contacts-filter-section-button ${activeFilterSection === section.id ? 'active' : ''}`}
                          onClick={() => setActiveFilterSection(section.id)}
                          role="tab"
                          aria-selected={activeFilterSection === section.id}
                          aria-label={`${section.label}: ${section.summary}`}
                        >
                          <span>{section.label}</span>
                          <small>{section.summary}</small>
                        </button>
                      ))}
                    </div>

                    <div className={`contacts-filter-detail ${['timeframe', 'owner', 'status', 'source', 'course', 'location'].includes(activeFilterSection) ? 'contacts-filter-detail-compact' : ''}`}>
                      {activeFilterSection === 'timeframe' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Timeframe</div>
                          <TimeframeFilterPanel
                            activeScope={effectiveLeadDateScope}
                            counts={{
                              quarter: quarterLeadCount,
                              current: currentLeadCount,
                              all: allDateLeadCount,
                              custom: customLeadCount,
                            }}
                            leadDateFrom={leadDateFrom}
                            leadDateTo={leadDateTo}
                            onDateRangeChange={setLeadDateRange}
                            onScopeChange={setLeadDateScope}
                          />
                        </section>
                      )}

                      {activeFilterSection === 'owner' && (
                        <section className="contacts-filter-block contacts-owner-filter">
                          <div className="contacts-filter-heading">Owner</div>
                          <div className="contacts-owner-scope-grid" aria-label="Owner scope">
                            <button
                              type="button"
                              className={`contacts-owner-tile ${effectiveOwnerFilter === DEFAULT_CONTACT_OWNER_FILTER && !coordinatorUiPolicy.ownerScoped ? 'active' : ''}`}
                              disabled={coordinatorUiPolicy.ownerScoped}
                              onClick={() => setOwnerFilter(DEFAULT_CONTACT_OWNER_FILTER)}
                              aria-pressed={effectiveOwnerFilter === DEFAULT_CONTACT_OWNER_FILTER && !coordinatorUiPolicy.ownerScoped}
                            >
                              <span>All Owners</span>
                              <small>Full team view</small>
                            </button>
                            <button
                              type="button"
                              className={`contacts-owner-tile ${coordinatorUiPolicy.ownerScoped || effectiveOwnerFilter === currentUser?.id ? 'active' : ''}`}
                              disabled={!currentUser?.id || (coordinatorUiPolicy.ownerScoped && !coordinatorUiPolicy.lockedOwnerUserId)}
                              onClick={() => currentUser?.id && setOwnerFilter(currentUser.id)}
                              aria-pressed={coordinatorUiPolicy.ownerScoped || effectiveOwnerFilter === currentUser?.id}
                            >
                              <span>My Contacts</span>
                              <small>{coordinatorUiPolicy.ownerScoped ? 'Role default' : 'Assigned to me'}</small>
                            </button>
                            <button
                              type="button"
                              className={`contacts-owner-tile ${effectiveOwnerFilter === 'unassigned' ? 'active' : ''}`}
                              disabled={coordinatorUiPolicy.ownerScoped}
                              onClick={() => setOwnerFilter('unassigned')}
                              aria-pressed={effectiveOwnerFilter === 'unassigned'}
                            >
                              <span>Unassigned</span>
                              <small>Needs owner</small>
                            </button>
                          </div>

                          {coordinatorUiPolicy.ownerScoped ? (
                            <p className="contacts-owner-note">Locked to your assigned contacts.</p>
                          ) : (
                            <div className="contacts-owner-staff">
                              <label className="contacts-owner-search">
                                <span>Specific staff</span>
                                <input
                                  className="input"
                                  type="search"
                                  value={ownerSearch}
                                  onChange={(event) => setOwnerSearch(event.target.value)}
                                  placeholder="Search staff..."
                                />
                              </label>
                              <div className="contacts-owner-list" role="listbox" aria-label="Staff owner filters">
                                {visibleOwnerOptions.length > 0 ? (
                                  visibleOwnerOptions.map((owner) => (
                                    <button
                                      key={owner.id}
                                      type="button"
                                      className={`contacts-owner-row ${effectiveOwnerFilter === owner.id ? 'active' : ''}`}
                                      onClick={() => setOwnerFilter(owner.id)}
                                      aria-selected={effectiveOwnerFilter === owner.id}
                                      role="option"
                                    >
                                      <span className="contacts-owner-avatar" aria-hidden="true">{owner.initials}</span>
                                      <span className="contacts-owner-copy">
                                        <strong>{owner.label}</strong>
                                        <small>{owner.meta}</small>
                                      </span>
                                    </button>
                                  ))
                                ) : (
                                  <span className="contacts-owner-empty">No matching staff</span>
                                )}
                              </div>
                            </div>
                          )}
                        </section>
                      )}

                      {activeFilterSection === 'status' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Status</div>
                          <div className="contacts-option-list" role="listbox" aria-label="Contact status filters">
                            <button
                              type="button"
                              className={`contacts-option-tile ${statusFilter === DEFAULT_CONTACT_STATUS_FILTER ? 'active' : ''}`}
                              onClick={() => setStatusFilter(DEFAULT_CONTACT_STATUS_FILTER)}
                              aria-selected={statusFilter === DEFAULT_CONTACT_STATUS_FILTER}
                              role="option"
                            >
                              <span>All Statuses</span>
                              <small>Do not narrow by stage</small>
                            </button>
                            {statusOptions.map((status) => (
                              <button
                                key={status}
                                type="button"
                                className={`contacts-option-tile ${statusFilter === status ? 'active' : ''}`}
                                onClick={() => setStatusFilter(status)}
                                aria-selected={statusFilter === status}
                                role="option"
                              >
                                <span>{status}</span>
                                <small>Only this stage</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'source' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Source</div>
                          <div className="contacts-option-list" role="listbox" aria-label="Contact source filters">
                            <button
                              type="button"
                              className={`contacts-option-tile ${sourceFilter === DEFAULT_CONTACT_SOURCE_FILTER ? 'active' : ''}`}
                              onClick={() => setSourceFilter(DEFAULT_CONTACT_SOURCE_FILTER)}
                              aria-selected={sourceFilter === DEFAULT_CONTACT_SOURCE_FILTER}
                              role="option"
                            >
                              <span>All Sources</span>
                              <strong>{contactDirectoryIsDeferred ? deferredDirectory.total : statusOwnerFilteredContacts.length}</strong>
                            </button>
                            {sourceFilterOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`contacts-option-tile ${sourceFilter === option.value ? 'active' : ''}`}
                                onClick={() => setSourceFilter(option.value)}
                                aria-selected={sourceFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                {option.count != null && <strong>{option.count}</strong>}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'course' && (courseFilterOptions.length > 0 || courseFilter !== DEFAULT_CONTACT_COURSE_FILTER) && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Course</div>
                          <div className="contacts-option-list" role="listbox" aria-label="Contact course filters">
                            <button
                              type="button"
                              className={`contacts-option-tile ${courseFilter === DEFAULT_CONTACT_COURSE_FILTER ? 'active' : ''}`}
                              onClick={() => setCourseFilter(DEFAULT_CONTACT_COURSE_FILTER)}
                              aria-selected={courseFilter === DEFAULT_CONTACT_COURSE_FILTER}
                              role="option"
                            >
                              <span>All Courses</span>
                              <strong>{contactDirectoryIsDeferred ? deferredDirectory.total : sourceFilteredContacts.length}</strong>
                            </button>
                            {courseFilterOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`contacts-option-tile ${courseFilter === option.value ? 'active' : ''}`}
                                onClick={() => setCourseFilter(option.value)}
                                aria-selected={courseFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                {option.count != null && <strong>{option.count}</strong>}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'location' && isAitUsaDirectory && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Learning Location</div>
                          <div className="contacts-option-list" role="listbox" aria-label="AIT USA learning location filters">
                            <button
                              type="button"
                              className={`contacts-option-tile ${effectiveLocationFilter === DEFAULT_CONTACT_LOCATION_FILTER ? 'active' : ''}`}
                              onClick={() => setLocationFilter(DEFAULT_CONTACT_LOCATION_FILTER)}
                              aria-selected={effectiveLocationFilter === DEFAULT_CONTACT_LOCATION_FILTER}
                              role="option"
                            >
                              <span>All Learning Locations</span>
                              <strong>{contactDirectoryIsDeferred ? deferredDirectory.total : courseFilteredContacts.length}</strong>
                            </button>
                            {locationFilterOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`contacts-option-tile ${effectiveLocationFilter === option.value ? 'active' : ''}`}
                                onClick={() => setLocationFilter(option.value)}
                                aria-selected={effectiveLocationFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                {option.count != null && <strong>{option.count}</strong>}
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'segments' && visibleSegmentGroups.groups.length > 0 && (
                        <section className="contacts-filter-block contacts-segment-filter">
                          <SegmentTile
                            facet={visibleSegmentGroups.allFacet}
                            active={effectiveDirectoryFacet === 'all'}
                            onClick={() => setDirectoryFacet(DEFAULT_CONTACT_FACET_FILTER)}
                          />
                          <div className="contacts-segment-groups">
                            {visibleSegmentGroups.groups.map((group) => (
                              <div key={group.id} className="contacts-segment-group">
                                <div className="contacts-segment-label">{group.label}</div>
                                <div className="contacts-segment-list">
                                  {group.facets.map((facet) => (
                                    <SegmentTile
                                      key={facet.id}
                                      facet={facet}
                                      active={effectiveDirectoryFacet === facet.id}
                                      onClick={() => setDirectoryFacet(facet.id)}
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>

                  <div className="contacts-filter-footer">
                    <div className="contacts-filter-footer-meta">
                      <span>
                        {filteredContacts.length.toLocaleString()} shown of{' '}
                        {(contactDirectoryIsDeferred ? deferredDirectory.total : dateScopedRows.length).toLocaleString()}
                      </span>
                      {hasNonDefaultFilters && (
                        <button className="contacts-filter-reset" type="button" onClick={resetFilters}>
                          <RotateCcw size={13} />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          toolbarExtra={canWrite ? (
            <button className="btn btn-primary contacts-table-add-button" onClick={openNew}>+ Add {singularLabel}</button>
          ) : null}
          onEdit={canWrite ? (id, u) => {
            updateContact(id, u)
              .then(() => {
                toast('Field updated');
                refreshDirectory();
              })
              .catch((error) => toast(error?.message || 'Update failed.', 'error'));
          } : undefined}
          actions={[
            { label: 'View', onClick: (r) => router.push(`${routeBase}/${r.id}`) },
            ...(canWrite ? [
              { label: 'Edit', onClick: openEdit },
            ] : []),
          ]}
          mobileBadges={['status']}
          mobileFields={mobileFieldKeys}
        />
        {contactDirectoryIsDeferred && deferredDirectory.totalPages > 1 && (
          <div className="contacts-directory-pagination" aria-label="Contact directory pages">
            <button
              className="btn btn-sm"
              type="button"
              disabled={deferredDirectory.page <= 1 || deferredDirectory.loading}
              onClick={() => deferredDirectory.setPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <span>
              Page {deferredDirectory.page.toLocaleString()} of {deferredDirectory.totalPages.toLocaleString()}
              {' · '}{deferredDirectory.total.toLocaleString()} records
            </span>
            <button
              className="btn btn-sm"
              type="button"
              disabled={deferredDirectory.page >= deferredDirectory.totalPages || deferredDirectory.loading}
              onClick={() => deferredDirectory.setPage((page) => Math.min(deferredDirectory.totalPages, page + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <Modal
        open={!!drawer}
        onClose={close}
        title={drawer === 'new' ? `New ${singularLabel}` : `Edit ${singularLabel}`}
        variant="dialog"
        panelClassName="contact-dialog-panel"
        footer={<>
          <button className="btn" type="button" onClick={close}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="contact-dialog-form">Save</button>
        </>}>
        <form
          id="contact-dialog-form"
          className="contact-dialog-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="contact-dialog-intro">
            <p>{drawer === 'new' ? 'Start with identity, then set the current routing and context.' : 'Update this contact’s identity, routing, and current context.'}</p>
            {drawer === 'new' && <span>Name and one contact method are required.</span>}
          </div>

          {formError && <div className="contact-dialog-error" role="alert">{formError}</div>}

          <section className="contact-dialog-section contact-dialog-identity">
            <div className="contact-dialog-section-header">
              <span className="contact-dialog-section-index">1</span>
              <div>
                <h2>Identity</h2>
                <p>Keep the person and their preferred contact details clear.</p>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="input" value={form.name} required autoFocus onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="input" type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} />
              </div>
            </div>
          </section>

          <section className="contact-dialog-section contact-dialog-routing">
            <div className="contact-dialog-section-header">
              <span className="contact-dialog-section-index">2</span>
              <div>
                <h2>Routing</h2>
                <p>Place this contact in the right workflow and scope.</p>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="input select" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                  {[
                    ...new Set([
                      ...(statusOptionsForBusinessUnitId(form.businessUnitId || form.primaryBusinessUnitId) || []),
                      ...(form.status ? [form.status] : []),
                    ]),
                  ].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <ContactTerminalStatusReasonField
                visible={Boolean(
                  drawer === 'new' &&
                  isAitUsaForm &&
                  isClosedLifecycleStatus(form.status, { businessUnit: formBusinessUnit })
                )}
                value={form.terminalStatusReason || ''}
                onChange={e => setForm(f => ({ ...f, terminalStatusReason: e.target.value }))}
              />
              <div className="form-group">
                <label className="form-label">Source</label>
                <select className="input select" value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
                  {[...new Set([...(sources || []), ...(form.source ? [form.source] : [])])].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="contact-dialog-routing-details">
              {canManageFormAssignments ? (
                <div className="form-group">
                  <label className="form-label">Assigned To</label>
                  <select className="input select" value={form.assignedTo || ''} onChange={e => setForm(f => ({...f, assignedTo: e.target.value}))}>
                    <option value="">Unassigned</option>
                    {formOwnerOptions.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {isAitUsaForm ? aitUsaAssigneeOptionLabel(owner, currentUser?.id) : owner.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                isAitUsaForm ? (
                  <div className="form-group">
                    <label className="form-label">Assigned To</label>
                    <div className="profile-editor-helper">Unassigned until a Senior Coordinator assigns this Opportunity.</div>
                  </div>
                ) : (
                  <input type="hidden" value={form.assignedTo || coordinatorUiPolicy.lockedOwnerUserId} readOnly />
                )
              )}
              <div className="form-group">
                <label className="form-label">{scopeLabel}</label>
                <select
                  className="input select"
                  value={form.businessUnitId || form.primaryBusinessUnitId || ''}
                  onChange={e => {
                    const nextBusinessUnitId = e.target.value;
                    const nextStatuses = statusOptionsForBusinessUnitId(nextBusinessUnitId);
                    setForm(f => ({
                      ...f,
                      businessUnitId: nextBusinessUnitId,
                      primaryBusinessUnitId: nextBusinessUnitId,
                      status: nextStatuses.includes(f.status) ? f.status : nextStatuses[0] || f.status,
                    }));
                  }}
                >
                  {canUseConsolidatedScope && <option value="">Unassigned</option>}
                  {accessibleBusinessUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section className="contact-dialog-section contact-dialog-context">
            <div className="contact-dialog-section-header">
              <span className="contact-dialog-section-index">3</span>
              <div>
                <h2>Context</h2>
                <p>Capture where the student lives and where they intend to learn.</p>
              </div>
            </div>
            {isAitUsaForm ? (
              <div className="contact-dialog-grid">
                <div className="form-group">
                  <label className="form-label">Student Location</label>
                  <input
                    className="input"
                    value={form.locationPreference || ''}
                    onChange={e => setForm(f => ({ ...f, locationPreference: e.target.value }))}
                    placeholder="City, municipality, or address"
                  />
                  <p className="profile-editor-helper">Where the student currently lives.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Intended Learning Location</label>
                  <select
                    className="input select"
                    value={form.address || ''}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  >
                    <option value="">Not specified</option>
                    {formSchoolLocationOptions.map((location) => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
                  <p className="profile-editor-helper">Campus or Online preference before enrollment.</p>
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Address</label>
                <input
                  className="input"
                  value={form.address || ''}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                />
              </div>
            )}
            <ContactDialogInitialTimelineNote
              isNewContact={drawer === 'new'}
              value={form.appendNote || ''}
              onChange={(event) => setForm((current) => ({ ...current, appendNote: event.target.value }))}
            />
          </section>

          {canWrite && drawer && drawer !== 'new' && (
            <section className="contact-dialog-danger-action danger-action-panel">
              <div className="danger-action-copy">
                <span className="danger-action-eyebrow">Separate account action</span>
                <strong>{coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive this ${singularLabel.toLowerCase()}` : 'Request archive approval'}</strong>
                <p>
                  {coordinatorUiPolicy.canArchiveContactsDirectly
                    ? `This is not saved with contact edits. It opens a separate confirmation before removing the ${singularLabel.toLowerCase()} from normal CRM lists.`
                    : `This is not saved with contact edits. It opens a separate confirmation and the contact stays active unless approved.`}
                </p>
              </div>
              <button className="btn btn-danger" type="button" onClick={requestDelete}>
                {coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive ${singularLabel}` : 'Request Archive'}
              </button>
            </section>
          )}
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive ${singularLabel}` : `Request archive approval`}
        message={coordinatorUiPolicy.canArchiveContactsDirectly
          ? `Archive ${deleteTarget?.name || `this ${singularLabel.toLowerCase()}`}? It will be removed from normal CRM lists, but history remains available in the database for audit/recovery.`
          : `Request senior approval to archive ${deleteTarget?.name || `this ${singularLabel.toLowerCase()}`}? The contact will stay active until the request is approved.`}
        confirmLabel={coordinatorUiPolicy.canArchiveContactsDirectly ? 'Archive' : 'Request Approval'}
        variant="danger"
      />
    </div>
  );
}
