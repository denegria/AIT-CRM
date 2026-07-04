'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import { validateManualContactIdentity } from '@/lib/crm/contact-input';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import {
  buildContactDirectoryFacetGroups,
  contactDirectorySignalLabels,
  filterContactsByDirectoryFacet,
} from '@/lib/contact-directory-facets';
import {
  buildCourseFilterOptions,
  buildSourceFilterOptions,
  contactFilterQuery,
  contactFilterStateFromParams,
  contactMatchesLeadDateScope,
  contactMatchesSource,
  contactMatchesStatusOwnerCourse,
  courseTagsForDirectoryRow,
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_CUSTOM,
  DEFAULT_CONTACT_COURSE_FILTER,
  DEFAULT_CONTACT_FACET_FILTER,
  DEFAULT_CONTACT_LEAD_DATE_FROM,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  DEFAULT_CONTACT_LEAD_DATE_TO,
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
import { schoolLocationOptions } from '@/lib/school-locations';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { AlertCircle, ListFilter, RotateCcw, UserRoundCheck } from 'lucide-react';

const empty = {
  name: '',
  email: '',
  phone: '',
  address: '',
  status: 'New Lead',
  currentStage: 'New Lead',
  source: 'Wix Historical Import',
  assignedTo: '',
  tags: [],
  nextAction: '',
  notes: [],
};

const CONTACT_FILTER_CHIP_LABELS = {
  leadDateScope: 'Timeframe',
  owner: 'Owner',
  status: 'Status',
  source: 'Source',
  course: 'Course',
  facet: 'Segments',
};

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

function dateScopeLabel(scope = DEFAULT_CONTACT_LEAD_DATE_SCOPE, from = '', to = '') {
  if (scope === CONTACT_LEAD_DATE_SCOPE_ALL) return 'All Leads';
  if (scope === CONTACT_LEAD_DATE_SCOPE_CUSTOM) {
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Through ${to}`;
    return 'Custom time frame';
  }
  return 'Current Year';
}

export default function ContactsPage({ mode = 'contacts' } = {}) {
  const {
    contacts,
    workOrders,
    financials,
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
  } = contactFilterStateFromParams(searchParams);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const effectiveOwnerFilter = coordinatorUiPolicy.lockedOwnerUserId || ownerFilter;
  const hasExplicitLeadDateFilter =
    searchParams.has('leadDateScope') ||
    searchParams.has('leadDateFrom') ||
    searchParams.has('leadDateTo');
  const effectiveLeadDateScope = coordinatorUiPolicy.ownerScoped && !hasExplicitLeadDateFilter
    ? CONTACT_LEAD_DATE_SCOPE_ALL
    : leadDateScope;
  const updateFilterQuery = useCallback((patch) => {
    const nextQuery = contactFilterQuery({
      statusFilter,
      ownerFilter: coordinatorUiPolicy.ownerScoped ? DEFAULT_CONTACT_OWNER_FILTER : ownerFilter,
      directoryFacet,
      leadDateScope,
      leadDateFrom,
      leadDateTo,
      courseFilter,
      sourceFilter,
      ...patch,
    });
    router.replace(nextQuery ? `${routeBase}?${nextQuery}` : routeBase, { scroll: false });
  }, [coordinatorUiPolicy.ownerScoped, courseFilter, directoryFacet, leadDateFrom, leadDateScope, leadDateTo, ownerFilter, routeBase, router, sourceFilter, statusFilter]);
  useEffect(() => {
    if (!coordinatorUiPolicy.ownerScoped || (!searchParams.has('owner') && !searchParams.has('ownerUserId'))) return;
    updateFilterQuery({ ownerFilter: DEFAULT_CONTACT_OWNER_FILTER });
  }, [coordinatorUiPolicy.ownerScoped, searchParams, updateFilterQuery]);
  const setStatusFilter = useCallback((value) => updateFilterQuery({ statusFilter: value }), [updateFilterQuery]);
  const setOwnerFilter = useCallback((value) => {
    if (coordinatorUiPolicy.ownerScoped) return;
    updateFilterQuery({ ownerFilter: value });
  }, [coordinatorUiPolicy.ownerScoped, updateFilterQuery]);
  const setDirectoryFacet = useCallback((value) => updateFilterQuery({ directoryFacet: value }), [updateFilterQuery]);
  const setLeadDateScope = useCallback((value) => updateFilterQuery({ leadDateScope: value }), [updateFilterQuery]);
  const setLeadDateFrom = useCallback((value) => updateFilterQuery({ leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM, leadDateFrom: value }), [updateFilterQuery]);
  const setLeadDateTo = useCallback((value) => updateFilterQuery({ leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM, leadDateTo: value }), [updateFilterQuery]);
  const setCourseFilter = useCallback((value) => updateFilterQuery({ courseFilter: value }), [updateFilterQuery]);
  const setSourceFilter = useCallback((value) => updateFilterQuery({ sourceFilter: value }), [updateFilterQuery]);

  const directoryContacts = useMemo(() => {
    return contacts;
  }, [contacts]);
  const directoryWorkOrders = useMemo(() => {
    return workOrders;
  }, [workOrders]);
  const directoryFinancials = useMemo(() => {
    return financials;
  }, [financials]);
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
  const ownerOptions = useMemo(() => {
    return (employees || [])
      .filter((employee) => employee?.id)
      .map((employee) => ({
        id: employee.id,
        label: employee.name || employee.email || 'Unnamed User',
      }));
  }, [employees]);
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
      inquirySource: enrollmentSourceText(contact),
      sourceCategoryText: directorySourceText(contact),
      signalLabels,
      signalText: signalLabels.join(' '),
    };
  }), [contactRows, facetContext]);
  const openNew = () => {
    if (!canWrite) return;
    const defaultStatuses = statusOptionsForBusinessUnitId(defaultBusinessUnitId);
    setForm({
      ...empty,
      status: defaultStatuses[0] || empty.status,
      currentStage: defaultStatuses[0] || empty.status,
      businessUnitId: defaultBusinessUnitId,
      primaryBusinessUnitId: defaultBusinessUnitId,
      assignedTo: coordinatorUiPolicy.lockedOwnerUserId || empty.assignedTo,
    });
    setFormError('');
    setDrawer('new');
  };
  const openEdit = (row) => { if (!canWrite) return; setForm({ ...row }); setFormError(''); setDrawer(row); };
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
    setFormError('');
    const payload = coordinatorUiPolicy.lockedOwnerUserId
      ? { ...form, assignedTo: coordinatorUiPolicy.lockedOwnerUserId }
      : form;
    if (drawer === 'new') {
      addContact(payload)
        .then(() => {
          toast(`${singularLabel} created successfully`);
          close();
        })
        .catch((error) => toast(error?.message || `${singularLabel} create failed.`, 'error'));
    } else {
      updateContact(drawer.id, payload)
        .then(() => {
          toast(`${singularLabel} updated successfully`);
          close();
        })
        .catch((error) => toast(error?.message || `${singularLabel} update failed.`, 'error'));
    }
  };

  const columns = [
    { key: 'name', label: isClientsMode ? 'Client' : 'Name', sortable: true, editable: true },
    ...(columnMode !== 'ait_signs' ? [{ key: 'email', label: 'Email', sortable: true, editable: true }] : []),
    { key: 'phone', label: 'Phone', editable: true },
    ...(columnMode === 'ait_signs' ? [
      { key: 'sourceCategoryText', label: 'Source', sortable: true, render: (row) => <SourceCell row={row} /> },
      { key: 'linkedPeopleSummary', label: 'People', sortable: true, render: (row) => <PeopleCell row={row} /> },
      { key: 'accountSnapshotText', label: 'Recent Work', sortable: false, render: (row) => <RecentWorkCell row={row} /> },
    ] : []),
    ...(columnMode === 'ait_usa' ? [
      { key: 'enrollmentStage', label: 'Enrollment', sortable: true, render: (row) => <EnrollmentCell row={row} /> },
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
  const allDateLeadCount = directoryRows.length;
  const currentLeadCount = useMemo(
    () => directoryRows.filter((contact) => contactMatchesLeadDateScope(contact)).length,
    [directoryRows],
  );
  const customLeadCount = useMemo(
    () => directoryRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM,
      leadDateFrom,
      leadDateTo,
    })).length,
    [directoryRows, leadDateFrom, leadDateTo],
  );
  const statusOwnerFilteredContacts = useMemo(() => dateScopedRows.filter((contact) => (
    contactMatchesStatusOwnerCourse(contact, {
      statusFilter,
      ownerFilter: effectiveOwnerFilter,
      courseFilter: DEFAULT_CONTACT_COURSE_FILTER,
    })
  )), [dateScopedRows, effectiveOwnerFilter, statusFilter]);
  const sourceFilterOptions = useMemo(
    () => buildSourceFilterOptions(statusOwnerFilteredContacts),
    [statusOwnerFilteredContacts],
  );
  const sourceFilteredContacts = useMemo(() => statusOwnerFilteredContacts.filter((contact) => (
    contactMatchesSource(contact, { sourceFilter })
  )), [sourceFilter, statusOwnerFilteredContacts]);
  const courseFilterOptions = useMemo(
    () => buildCourseFilterOptions(sourceFilteredContacts),
    [sourceFilteredContacts],
  );
  const baseFilteredContacts = useMemo(() => sourceFilteredContacts.filter((contact) => (
    contactMatchesStatusOwnerCourse(contact, {
      statusFilter: DEFAULT_CONTACT_STATUS_FILTER,
      ownerFilter: DEFAULT_CONTACT_OWNER_FILTER,
      courseFilter,
    })
  )), [courseFilter, sourceFilteredContacts]);
  const facetGroups = useMemo(
    () => buildContactDirectoryFacetGroups(baseFilteredContacts, facetContext),
    [baseFilteredContacts, facetContext],
  );
  const effectiveDirectoryFacet = directoryFacet || 'all';
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
  const selectedSourceLabel = useMemo(() => {
    if (sourceFilter === DEFAULT_CONTACT_SOURCE_FILTER) return '';
    return sourceFilterOptions.find((option) => option.value === sourceFilter)?.label || sourceFilter;
  }, [sourceFilter, sourceFilterOptions]);
  const selectedDateLabel = useMemo(
    () => dateScopeLabel(effectiveLeadDateScope, leadDateFrom, leadDateTo),
    [effectiveLeadDateScope, leadDateFrom, leadDateTo],
  );
  const regularImplicitLeadDate = coordinatorUiPolicy.ownerScoped && !hasExplicitLeadDateFilter;
  const dateFilterIsDefault = regularImplicitLeadDate ||
    (
      leadDateScope === DEFAULT_CONTACT_LEAD_DATE_SCOPE &&
      leadDateFrom === DEFAULT_CONTACT_LEAD_DATE_FROM &&
      leadDateTo === DEFAULT_CONTACT_LEAD_DATE_TO
    );
  const activeFilterChips = useMemo(() => [
    regularImplicitLeadDate ? null : {
      key: 'leadDateScope',
      label: selectedDateLabel,
      primary: !coordinatorUiPolicy.ownerScoped,
      onRemove: dateFilterIsDefault
        ? null
        : () => updateFilterQuery({
          leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
          leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
          leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
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
    selectedOwnerLabel,
    selectedSourceLabel,
    setCourseFilter,
    setDirectoryFacet,
    setOwnerFilter,
    coordinatorUiPolicy.ownerScoped,
    setStatusFilter,
    setSourceFilter,
    statusFilter,
    regularImplicitLeadDate,
    updateFilterQuery,
  ]);
  const activeFilterCount = activeFilterChips.filter((chip) => chip.onRemove).length;
  const filterSummaryCards = activeFilterChips.slice(0, 3);
  const hasNonDefaultLeadDateFilter = coordinatorUiPolicy.ownerScoped
    ? hasExplicitLeadDateFilter
    : leadDateScope !== DEFAULT_CONTACT_LEAD_DATE_SCOPE ||
      leadDateFrom !== DEFAULT_CONTACT_LEAD_DATE_FROM ||
      leadDateTo !== DEFAULT_CONTACT_LEAD_DATE_TO;
  const hasNonDefaultFilters = hasNonDefaultLeadDateFilter ||
    statusFilter !== DEFAULT_CONTACT_STATUS_FILTER ||
    (!coordinatorUiPolicy.ownerScoped && ownerFilter !== DEFAULT_CONTACT_OWNER_FILTER) ||
    sourceFilter !== DEFAULT_CONTACT_SOURCE_FILTER ||
    courseFilter !== DEFAULT_CONTACT_COURSE_FILTER ||
    effectiveDirectoryFacet !== DEFAULT_CONTACT_FACET_FILTER;
  const filterSections = [
    {
      id: 'timeframe',
      label: 'Timeframe',
      summary: regularImplicitLeadDate ? 'All owned records' : selectedDateLabel,
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
    facetGroups.length > 0 ? {
      id: 'segments',
      label: 'Segments',
      summary: selectedFacetLabel || 'All Segments',
    } : null,
  ].filter(Boolean);
  const resetFilters = () => {
    updateFilterQuery({
      leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
      leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
      leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
      statusFilter: DEFAULT_CONTACT_STATUS_FILTER,
      ownerFilter: DEFAULT_CONTACT_OWNER_FILTER,
      sourceFilter: DEFAULT_CONTACT_SOURCE_FILTER,
      directoryFacet: DEFAULT_CONTACT_FACET_FILTER,
      courseFilter: DEFAULT_CONTACT_COURSE_FILTER,
    });
  };
  const mobileFieldKeys = columnMode === 'ait_signs'
    ? ['phone', 'sourceCategoryText', 'linkedPeopleSummary', 'accountSnapshotText', 'assignedLabel', 'lastTouch', 'lastEdited']
    : columnMode === 'ait_usa'
      ? ['phone', 'enrollmentStage', 'inquirySource', 'assignedLabel', 'lastTouch', 'lastEdited']
      : ['phone', 'workflow', 'signalText', 'assignedLabel', 'divisionLabel', 'lastTouch', 'lastEdited'];
  const directoryScopeName = directoryBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`;
  const summaryNoun = pluralLabel.toLowerCase();
  const directorySummary = `${filteredContacts.length.toLocaleString()} matching ${summaryNoun} in ${directoryScopeName}`;
  const formBusinessUnitId = form.businessUnitId || form.primaryBusinessUnitId || '';
  const formBusinessUnit = businessUnitById.get(formBusinessUnitId) || null;
  const isAitUsaForm = workflowForBusinessUnit(formBusinessUnit).key === WORKFLOW_KEYS.AIT_USA;
  const formSchoolLocationOptions = schoolLocationOptions(form.address);

  if (!loaded) return <div className="empty-state">Loading...</div>;

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
          searchPlaceholder={`Search ${pluralLabel.toLowerCase()}...`}
          toolbarAfterColumns={(
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

              {filterMenuOpen && (
                <div className="contacts-filter-menu" role="dialog" aria-label="Contact filters">
                  <div className="contacts-filter-menu-header">
                    <div className="contacts-filter-title">
                      <span className="contacts-filter-title-icon"><ListFilter size={18} /></span>
                      <div>
                        <strong>Filters</strong>
                        <span>Refine {pluralLabel.toLowerCase()}</span>
                      </div>
                      {activeFilterCount > 0 && <em>{activeFilterCount}</em>}
                    </div>
                    <div className="contacts-filter-menu-actions">
                      {hasNonDefaultFilters && (
                        <button className="contacts-filter-reset" type="button" onClick={resetFilters}>
                          <RotateCcw size={13} />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="contacts-filter-summary-strip" aria-label="Selected contact filters">
                    {filterSummaryCards.length > 0 ? (
                      <>
                        {filterSummaryCards.map((chip) => (
                          <span key={chip.key} className="contacts-filter-summary-item">
                            <small>{CONTACT_FILTER_CHIP_LABELS[chip.key] || 'Filter'}</small>
                            <strong>{chip.label}</strong>
                          </span>
                        ))}
                        {activeFilterChips.length > filterSummaryCards.length && (
                          <span className="contacts-filter-summary-more">+{activeFilterChips.length - filterSummaryCards.length}</span>
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

                    <div className="contacts-filter-detail">
                      {activeFilterSection === 'timeframe' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Timeframe</div>
                          <div className="contacts-facet-pills">
                            {[
                              [DEFAULT_CONTACT_LEAD_DATE_SCOPE, 'Current Year', currentLeadCount],
                              [CONTACT_LEAD_DATE_SCOPE_ALL, 'All Leads', allDateLeadCount],
                              [CONTACT_LEAD_DATE_SCOPE_CUSTOM, 'Custom Time Frame', customLeadCount],
                            ].map(([id, label, count]) => (
                              <button
                                key={id}
                                type="button"
                                className={`contacts-facet-pill ${effectiveLeadDateScope === id ? 'active' : ''}`}
                                onClick={() => setLeadDateScope(id)}
                                aria-pressed={effectiveLeadDateScope === id}
                              >
                                <span>{label}</span>
                                <strong>{count}</strong>
                              </button>
                            ))}
                          </div>
                          <div className="contacts-date-range">
                            <label>
                              <span>From</span>
                              <input className="input" type="date" value={leadDateFrom} onChange={(event) => setLeadDateFrom(event.target.value)} />
                            </label>
                            <label>
                              <span>To</span>
                              <input className="input" type="date" value={leadDateTo} onChange={(event) => setLeadDateTo(event.target.value)} />
                            </label>
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'owner' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Owner</div>
                          <label className="contacts-filter-field">
                            <select
                              className="input select"
                              value={effectiveOwnerFilter}
                              disabled={coordinatorUiPolicy.ownerScoped}
                              onChange={(event) => setOwnerFilter(event.target.value)}
                            >
                              {coordinatorUiPolicy.ownerScoped ? (
                                <option value={coordinatorUiPolicy.lockedOwnerUserId}>My Contacts</option>
                              ) : (
                                <>
                                  <option value="all">All Owners</option>
                                  <option value="unassigned">Unassigned</option>
                                  {ownerOptions.map((owner) => (
                                    <option key={owner.id} value={owner.id}>{owner.label}</option>
                                  ))}
                                </>
                              )}
                            </select>
                          </label>
                        </section>
                      )}

                      {activeFilterSection === 'status' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Status</div>
                          <label className="contacts-filter-field">
                            <select className="input select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                              <option value={DEFAULT_CONTACT_STATUS_FILTER}>All Statuses</option>
                              {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </label>
                        </section>
                      )}

                      {activeFilterSection === 'source' && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Source</div>
                          <label className="contacts-filter-field">
                            <select className="input select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                              <option value={DEFAULT_CONTACT_SOURCE_FILTER}>All Sources</option>
                              {sourceFilterOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label} ({option.count})
                                </option>
                              ))}
                            </select>
                          </label>
                        </section>
                      )}

                      {activeFilterSection === 'course' && (courseFilterOptions.length > 0 || courseFilter !== DEFAULT_CONTACT_COURSE_FILTER) && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Course</div>
                          <label className="contacts-filter-field">
                            <select className="input select" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
                              <option value={DEFAULT_CONTACT_COURSE_FILTER}>All Courses</option>
                              {courseFilterOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label} ({option.count})
                                </option>
                              ))}
                            </select>
                          </label>
                        </section>
                      )}

                      {activeFilterSection === 'segments' && facetGroups.length > 0 && (
                        <section className="contacts-filter-block">
                          <div className="contacts-filter-heading">Segments</div>
                          <div className="contacts-facet-groups">
                            {facetGroups.map((group) => (
                              <div key={group.id} className="contacts-facet-group">
                                <div className="contacts-facet-label">{group.label}</div>
                                <div className="contacts-facet-pills">
                                  {group.facets
                                    .filter((facet) => facet.count > 0 || facet.id === 'all' || effectiveDirectoryFacet === facet.id)
                                    .map((facet) => (
                                      <button
                                        key={facet.id}
                                        type="button"
                                        className={`contacts-facet-pill ${effectiveDirectoryFacet === facet.id ? 'active' : ''} ${facet.count === 0 ? 'is-empty' : ''}`}
                                        onClick={() => setDirectoryFacet(facet.id)}
                                        disabled={facet.count === 0 && directoryFacet !== facet.id}
                                        aria-pressed={effectiveDirectoryFacet === facet.id}
                                      >
                                        <span>{facet.label}</span>
                                        <strong>{facet.count}</strong>
                                      </button>
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
                    <span>{filteredContacts.length} matching {pluralLabel.toLowerCase()}</span>
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
              .then(() => toast('Field updated'))
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
      </div>

      <Modal open={!!drawer} onClose={close} title={drawer === 'new' ? `New ${singularLabel}` : `Edit ${singularLabel}`}
        footer={<>
          {canWrite && drawer && drawer !== 'new' && (
            <button className="btn btn-danger" type="button" onClick={requestDelete}>
              {coordinatorUiPolicy.canArchiveContactsDirectly ? 'Delete' : 'Request Archive'}
            </button>
          )}
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>}>
        {formError && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: '8px 10px',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--danger)',
              background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {formError}
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="input" value={form.name} required onChange={e => setForm(f => ({...f, name: e.target.value}))} />
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
          <div className="form-group">
            <label className="form-label">Source</label>
            <select className="input select" value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
              {['Wix Historical Import','Website','Facebook Ads','Referral','Cold Call','Google Ads'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {coordinatorUiPolicy.canManageCoordinatorAssignments ? (
          <div className="form-group">
            <label className="form-label">Assigned To</label>
            <select className="input select" value={form.assignedTo || ''} onChange={e => setForm(f => ({...f, assignedTo: e.target.value}))}>
              <option value="">Unassigned</option>
              {ownerOptions.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" value={form.assignedTo || coordinatorUiPolicy.lockedOwnerUserId} readOnly />
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
        {isAitUsaForm ? (
          <div className="form-group">
            <label className="form-label">School Location</label>
            <select
              className="input select"
              value={form.address || ''}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            >
              <option value="">Select school location</option>
              {formSchoolLocationOptions.map((location) => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>
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
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="input" rows={3} 
            value={Array.isArray(form.notes) ? (form.notes[form.notes.length - 1]?.text || '') : form.notes} 
            onChange={e => {
              const text = e.target.value;
              setForm(f => {
                const newNotes = Array.isArray(f.notes) ? [...f.notes] : [{ text: f.notes, date: new Date().toISOString().slice(0,10) }];
                if (newNotes.length > 0) {
                  newNotes[newNotes.length - 1] = { ...newNotes[newNotes.length - 1], text, date: new Date().toISOString().slice(0,10) };
                } else {
                  newNotes.push({ text, date: new Date().toISOString().slice(0,10) });
                }
                return { ...f, notes: newNotes };
              });
            }} 
            style={{resize:'vertical'}} 
          />
          <div style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4}}>
            Editing the latest note. Full timeline available in Contact Details.
          </div>
        </div>
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
