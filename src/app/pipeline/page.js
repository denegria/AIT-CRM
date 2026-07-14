'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ListFilter, RotateCcw, Search, UserPlus, UserRoundCheck, X } from 'lucide-react';
import KanbanBoard from '@/components/KanbanBoard';
import PageState from '@/components/PageState';
import { useToast } from '@/components/Toast';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { useCRM } from '@/lib/store';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import {
  isPipelineNewLeadBucket,
  matchesPipelineQuickFilter,
} from '@/lib/contact-workflow-buckets';
import { mobilePipelineTriageItems } from '@/lib/pipeline-mobile-triage.js';
import {
  buildCourseFilterOptions,
  buildSchoolLocationFilterOptions,
  contactMatchesLeadDateScope,
  contactMatchesSchoolLocation,
  contactMatchesStatusOwnerCourse,
  effectiveLeadDateScopeForDirectory,
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_CUSTOM,
  CONTACT_LEAD_DATE_SCOPE_QUARTER,
  DEFAULT_CONTACT_LEAD_DATE_FROM,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  DEFAULT_CONTACT_LEAD_DATE_TO,
  DEFAULT_PIPELINE_ACTIVITY_FILTER,
  DEFAULT_PIPELINE_COMPACT_MODE,
  DEFAULT_PIPELINE_COURSE_FILTER,
  DEFAULT_PIPELINE_LOCATION_FILTER,
  DEFAULT_PIPELINE_OWNER_FILTER,
  DEFAULT_PIPELINE_SEARCH,
  DEFAULT_PIPELINE_SOURCE_FILTER,
  DEFAULT_PIPELINE_STATUS_FILTER,
  pipelineFilterQuery,
  pipelineFilterStateFromParams,
} from '@/lib/contact-directory-filters';
import { schoolLocationForContact } from '@/lib/school-locations';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import TimeframeFilterPanel from '@/components/TimeframeFilterPanel';
import s from './PipelinePage.module.css';

const AIT_USA_CLOSED_OUTCOME_ORDER = new Map([
  ['Course Completed', 0],
  ['Dropped / Quit', 1],
  ['Retargeting', 2],
  ['Not Interested', 3],
]);

const PIPELINE_ACTIVITY_OPTIONS = [
  ['all', 'Any Activity'],
  ['recent_7', 'Touched Last 7 Days'],
  ['stale_30', 'No Touch 30+ Days'],
  ['no_touch', 'No Touch Recorded'],
];

const PIPELINE_FILTER_CHIP_LABELS = {
  date: 'Timeframe',
  owner: 'Owner',
  status: 'Status',
  source: 'Source',
  course: 'Course',
  location: 'Location',
  activity: 'Activity',
  search: 'Search',
  cards: 'Cards',
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

function matchesSearch(contact, query) {
  if (!query) return true;
  const haystack = [
    contact.name,
    contact.email,
    contact.phone,
    schoolLocationForContact(contact),
    contact.source,
    contact.latestComment,
    contact.assignedLabel,
    contact.divisionLabel,
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function normalizedPipelineColumns(columns = []) {
  return columns.map((column) => {
    if (typeof column === 'string') {
      return {
        id: column,
        label: column,
        isTerminal: false,
        isOperational: false,
      };
    }
    return {
      id: column.id || column.status || column.label,
      label: column.label || column.id || column.status,
      isTerminal: Boolean(column.isTerminal),
      isOperational: Boolean(column.isOperational),
    };
  });
}

function closedOutcomeSort(left, right) {
  const leftOrder = AIT_USA_CLOSED_OUTCOME_ORDER.has(left.id)
    ? AIT_USA_CLOSED_OUTCOME_ORDER.get(left.id)
    : 100;
  const rightOrder = AIT_USA_CLOSED_OUTCOME_ORDER.has(right.id)
    ? AIT_USA_CLOSED_OUTCOME_ORDER.get(right.id)
    : 100;
  return leftOrder - rightOrder || left.label.localeCompare(right.label);
}

function mobileCardMeta(contact) {
  return [
    contact.enrollmentSignals?.inquiry?.programInterest || contact.programInterest,
    contact.enrollmentSignals?.inquiry?.age ? `Age ${contact.enrollmentSignals.inquiry.age}` : '',
    schoolLocationForContact(contact) || contact.enrollmentSignals?.inquiry?.location,
    contact.phone || contact.email || 'No contact channel',
  ].filter(Boolean).join(' · ');
}

function contactTouchDate(contact = {}) {
  return contact.lastTouch || contact.lastContact || contact.lastEdited || contact.sourceActivityDate || '';
}

function daysSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function sourceValue(contact = {}) {
  return contact.inquirySource || contact.sourceCategoryText || contact.source || 'Unknown Source';
}

function nextLeadScore(contact = {}) {
  let score = 0;
  if (isPipelineNewLeadBucket(contact)) score += 100;
  if (!contact.assignedTo) score += 40;
  if (!contact.phone && !contact.email) score += 20;
  score += Math.min(daysSince(contactTouchDate(contact)), 30);
  return score;
}

function optionLabel(options = [], value = '') {
  return options.find(([id]) => id === value)?.[1] || value;
}

function dateScopeLabel(scope = DEFAULT_CONTACT_LEAD_DATE_SCOPE, from = '', to = '') {
  if (scope === CONTACT_LEAD_DATE_SCOPE_QUARTER) return 'This Quarter';
  if (scope === CONTACT_LEAD_DATE_SCOPE_ALL) return 'All Leads';
  if (scope === CONTACT_LEAD_DATE_SCOPE_CUSTOM) {
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    if (to) return `Through ${to}`;
    return 'Custom time frame';
  }
  return 'Current Year';
}

export default function PipelinePage() {
  const {
    contacts,
    workOrders,
    financials,
    updateContact,
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const pipelineSearchQuery = searchParams.toString();
  const [pipelineBusinessUnitId, setPipelineBusinessUnitId] = useState('');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeFilterSection, setActiveFilterSection] = useState('timeframe');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [mobileStageFilter, setMobileStageFilter] = useState('all');
  const [mobileMoveCardId, setMobileMoveCardId] = useState('');
  const [bulkAssignMode, setBulkAssignMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const parsedFilters = useMemo(() => pipelineFilterStateFromParams(new URLSearchParams(pipelineSearchQuery)), [pipelineSearchQuery]);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const ownerFilter = coordinatorUiPolicy.lockedOwnerUserId || parsedFilters.ownerFilter;
  const {
    statusFilter,
    sourceFilter,
    courseFilter,
    locationFilter,
    activityFilter,
    search,
    leadDateScope,
    leadDateFrom,
    leadDateTo,
    compactMode,
  } = parsedFilters;
  const hasExplicitLeadDateFilter =
    searchParams.has('leadDateScope') ||
    searchParams.has('leadDateFrom') ||
    searchParams.has('leadDateTo');
  const ownerFilterImpliesAllLeadDates =
    !coordinatorUiPolicy.ownerScoped &&
    ownerFilter !== DEFAULT_PIPELINE_OWNER_FILTER &&
    !hasExplicitLeadDateFilter;
  const effectiveLeadDateScope = effectiveLeadDateScopeForDirectory({
    leadDateScope,
    hasExplicitLeadDateFilter: hasExplicitLeadDateFilter || ownerFilterImpliesAllLeadDates,
  });
  const updatePipelineFilterQuery = useCallback((patch) => {
    const patchHasLeadDateScope =
      Object.prototype.hasOwnProperty.call(patch, 'leadDateScope') ||
      Object.prototype.hasOwnProperty.call(patch, 'leadDateFrom') ||
      Object.prototype.hasOwnProperty.call(patch, 'leadDateTo');
    const includeLeadDateScope = Object.prototype.hasOwnProperty.call(patch, 'includeLeadDateScope')
      ? patch.includeLeadDateScope
      : hasExplicitLeadDateFilter || patchHasLeadDateScope;
    const nextQuery = pipelineFilterQuery({
      ...parsedFilters,
      ownerFilter: coordinatorUiPolicy.ownerScoped ? DEFAULT_PIPELINE_OWNER_FILTER : ownerFilter,
      includeLeadDateScope,
      ...patch,
    });
    router.replace(nextQuery ? `/pipeline?${nextQuery}` : '/pipeline', { scroll: false });
  }, [coordinatorUiPolicy.ownerScoped, hasExplicitLeadDateFilter, ownerFilter, parsedFilters, router]);
  useEffect(() => {
    const hasLegacyWorkflowParam = searchParams.has('workflow');
    const hasLockedOwnerParam = coordinatorUiPolicy.ownerScoped && (searchParams.has('owner') || searchParams.has('ownerUserId'));
    if (!hasLegacyWorkflowParam && !hasLockedOwnerParam) return;
    updatePipelineFilterQuery({
      ownerFilter: coordinatorUiPolicy.ownerScoped ? DEFAULT_PIPELINE_OWNER_FILTER : parsedFilters.ownerFilter,
    });
  }, [coordinatorUiPolicy.ownerScoped, parsedFilters.ownerFilter, searchParams, updatePipelineFilterQuery]);
  const setStatusFilter = (value) => updatePipelineFilterQuery({ statusFilter: value });
  const setOwnerFilter = (value) => {
    if (coordinatorUiPolicy.ownerScoped) return;
    updatePipelineFilterQuery({
      ownerFilter: value,
      ...(!hasExplicitLeadDateFilter && value !== DEFAULT_PIPELINE_OWNER_FILTER ? {
        leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
        leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
        leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
      } : {}),
    });
  };
  const setSourceFilter = (value) => updatePipelineFilterQuery({ sourceFilter: value });
  const setCourseFilter = (value) => updatePipelineFilterQuery({ courseFilter: value });
  const setLocationFilter = (value) => updatePipelineFilterQuery({ locationFilter: value });
  const setActivityFilter = (value) => updatePipelineFilterQuery({ activityFilter: value });
  const setSearch = (value) => updatePipelineFilterQuery({ search: value });
  const setCompactMode = (value) => updatePipelineFilterQuery({ compactMode: value });
  const setLeadDateScope = (value) => updatePipelineFilterQuery({ leadDateScope: value });
  const setLeadDateRange = (from, to) => updatePipelineFilterQuery({
    leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM,
    leadDateFrom: from,
    leadDateTo: to,
  });
  const canWrite = access.canWriteCrm;
  const {
    activeWorkflow,
    contactRows,
    currentScopedBusinessUnitId,
    pipelineBusinessUnit,
    pipelineColumns,
    resolvedPipelineBusinessUnitId,
  } = useContactWorkflowView({
    contacts,
    workOrders,
    financials,
    employees,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    pipelineBusinessUnitId,
  });

  const selectedBusinessUnitId = resolvedPipelineBusinessUnitId || currentScopedBusinessUnitId;
  const isAitUsaPipeline = activeWorkflow?.key === WORKFLOW_KEYS.AIT_USA;
  const effectiveLocationFilter = isAitUsaPipeline ? locationFilter : DEFAULT_PIPELINE_LOCATION_FILTER;
  const scopedRows = useMemo(() => contactRows.filter((contact) => {
    if (!selectedBusinessUnitId) return true;
    return (contact.businessUnitId || contact.primaryBusinessUnitId) === selectedBusinessUnitId;
  }), [contactRows, selectedBusinessUnitId]);
  const eligibleScopedRows = useMemo(
    () => scopedRows.filter((contact) => contact.isPipelineEligible !== false),
    [scopedRows],
  );
  const normalizedColumns = useMemo(() => normalizedPipelineColumns(pipelineColumns), [pipelineColumns]);
  const activePipelineColumns = useMemo(
    () => normalizedColumns.filter((column) => !column.isTerminal),
    [normalizedColumns],
  );
  const pipelineStatusOptions = useMemo(
    () => activePipelineColumns.map((column) => ({ value: column.id, label: column.label })),
    [activePipelineColumns],
  );
  const pipelineScopedRows = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: effectiveLeadDateScope,
      leadDateFrom,
      leadDateTo,
    })),
    [effectiveLeadDateScope, eligibleScopedRows, leadDateFrom, leadDateTo],
  );
  const allPipelineCount = eligibleScopedRows.length;
  const currentPipelineCount = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact)).length,
    [eligibleScopedRows],
  );
  const quarterPipelineCount = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_QUARTER,
    })).length,
    [eligibleScopedRows],
  );
  const customPipelineCount = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM,
      leadDateFrom,
      leadDateTo,
    })).length,
    [eligibleScopedRows, leadDateFrom, leadDateTo],
  );

  const sourceOptions = useMemo(() => {
    const values = [...new Set(pipelineScopedRows.map(sourceValue).filter(Boolean))];
    return values.sort((left, right) => left.localeCompare(right));
  }, [pipelineScopedRows]);
  const courseFilterOptions = useMemo(
    () => buildCourseFilterOptions(pipelineScopedRows),
    [pipelineScopedRows],
  );
  const locationFilterOptions = useMemo(
    () => isAitUsaPipeline ? buildSchoolLocationFilterOptions(pipelineScopedRows) : [],
    [isAitUsaPipeline, pipelineScopedRows],
  );
  const ownerOptions = useMemo(() => {
    return (employees || [])
      .filter((employee) => employee?.id && employee.id !== currentUser?.id)
      .map((employee) => ({
        id: employee.id,
        label: employee.name || employee.email || 'Unnamed User',
        email: employee.email || '',
        initials: ownerInitials(employee.name || employee.email || 'Unnamed User'),
        meta: ownerMeta(employee),
      }));
  }, [currentUser?.id, employees]);
  const visibleOwnerOptions = useMemo(
    () => ownerOptions.filter((owner) => matchesOwnerSearch(owner, ownerSearch)),
    [ownerOptions, ownerSearch],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const pipelineRows = useMemo(() => pipelineScopedRows.filter((contact) => {
    const statusOwnerCourseMatch = contactMatchesStatusOwnerCourse(contact, {
      statusFilter,
      ownerFilter,
      courseFilter,
    });
    const sourceMatch = sourceFilter === 'all' || sourceValue(contact) === sourceFilter;
    const locationMatch = contactMatchesSchoolLocation(contact, { locationFilter: effectiveLocationFilter });
    const touchAge = daysSince(contactTouchDate(contact));
    const activityMatch =
      activityFilter === 'all' ||
      (activityFilter === 'no_touch' && !contactTouchDate(contact)) ||
      (activityFilter === 'stale_30' && touchAge > 30) ||
      (activityFilter === 'recent_7' && touchAge <= 7);
    return statusOwnerCourseMatch && sourceMatch && locationMatch && activityMatch && matchesSearch(contact, normalizedSearch);
  }), [activityFilter, courseFilter, effectiveLocationFilter, normalizedSearch, ownerFilter, pipelineScopedRows, sourceFilter, statusFilter]);
  const closedOutcomeColumns = useMemo(
    () => normalizedColumns.filter((column) => column.isTerminal && !column.isOperational).sort(closedOutcomeSort),
    [normalizedColumns],
  );
  const closedOutcomeCounts = useMemo(() => {
    const counts = new Map(closedOutcomeColumns.map((column) => [column.id, 0]));
    for (const contact of scopedRows) {
      if (!counts.has(contact.status)) continue;
      if (!contactMatchesLeadDateScope(contact, {
        leadDateScope: effectiveLeadDateScope,
        leadDateFrom,
        leadDateTo,
      })) continue;
      counts.set(contact.status, (counts.get(contact.status) || 0) + 1);
    }
    return counts;
  }, [closedOutcomeColumns, effectiveLeadDateScope, leadDateFrom, leadDateTo, scopedRows]);
  const mobileStageRows = mobileStageFilter === 'all'
    ? pipelineRows
    : pipelineRows.filter((contact) => contact.status === mobileStageFilter);
  const nextLead = useMemo(() => (
    [...pipelineRows]
      .filter((contact) => (
        isPipelineNewLeadBucket(contact) ||
        matchesPipelineQuickFilter(contact, 'unassigned')
      ))
      .sort((left, right) => nextLeadScore(right) - nextLeadScore(left))[0] || null
  ), [pipelineRows]);
  const selectedRows = useMemo(() => pipelineRows.filter((contact) => selectedIds.includes(contact.id)), [pipelineRows, selectedIds]);
  const selectedOwnerLabel = useMemo(() => {
    if (coordinatorUiPolicy.ownerScoped) return 'My Pipeline';
    if (ownerFilter === DEFAULT_PIPELINE_OWNER_FILTER) return '';
    if (ownerFilter === 'unassigned') return 'Unassigned';
    if (ownerFilter === currentUser?.id) return 'Me';
    return ownerOptions.find((owner) => owner.id === ownerFilter)?.label || 'Selected owner';
  }, [coordinatorUiPolicy.ownerScoped, currentUser?.id, ownerFilter, ownerOptions]);
  const selectedStatusLabel = statusFilter === DEFAULT_PIPELINE_STATUS_FILTER ? '' :
    pipelineStatusOptions.find((option) => option.value === statusFilter)?.label || statusFilter;
  const selectedCourseLabel = courseFilter === DEFAULT_PIPELINE_COURSE_FILTER ? '' :
    courseFilterOptions.find((option) => option.value === courseFilter)?.label || courseFilter;
  const selectedLocationLabel = !isAitUsaPipeline || effectiveLocationFilter === DEFAULT_PIPELINE_LOCATION_FILTER ? '' :
    locationFilterOptions.find((option) => option.value === effectiveLocationFilter)?.label || effectiveLocationFilter;
  const selectedDateLabel = dateScopeLabel(effectiveLeadDateScope, leadDateFrom, leadDateTo);
  const implicitLeadDate = (coordinatorUiPolicy.ownerScoped && !hasExplicitLeadDateFilter) || ownerFilterImpliesAllLeadDates;
  const dateFilterIsDefault = !hasExplicitLeadDateFilter || implicitLeadDate;
  const activeFilterChips = [
    !hasExplicitLeadDateFilter || (coordinatorUiPolicy.ownerScoped && implicitLeadDate) ? null : {
      key: 'date',
      label: selectedDateLabel,
      primary: !coordinatorUiPolicy.ownerScoped,
      onRemove: dateFilterIsDefault
        ? () => updatePipelineFilterQuery({
          leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
          leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
          leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
        })
        : () => updatePipelineFilterQuery({
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
      onRemove: coordinatorUiPolicy.ownerScoped ? null : () => setOwnerFilter(DEFAULT_PIPELINE_OWNER_FILTER),
    } : null,
    selectedStatusLabel ? {
      key: 'status',
      label: selectedStatusLabel,
      onRemove: () => setStatusFilter(DEFAULT_PIPELINE_STATUS_FILTER),
    } : null,
    sourceFilter !== DEFAULT_PIPELINE_SOURCE_FILTER ? {
      key: 'source',
      label: sourceFilter,
      onRemove: () => setSourceFilter(DEFAULT_PIPELINE_SOURCE_FILTER),
    } : null,
    selectedCourseLabel ? {
      key: 'course',
      label: selectedCourseLabel,
      onRemove: () => setCourseFilter(DEFAULT_PIPELINE_COURSE_FILTER),
    } : null,
    selectedLocationLabel ? {
      key: 'location',
      label: selectedLocationLabel,
      onRemove: () => setLocationFilter(DEFAULT_PIPELINE_LOCATION_FILTER),
    } : null,
    activityFilter !== DEFAULT_PIPELINE_ACTIVITY_FILTER ? {
      key: 'activity',
      label: optionLabel(PIPELINE_ACTIVITY_OPTIONS, activityFilter),
      onRemove: () => setActivityFilter(DEFAULT_PIPELINE_ACTIVITY_FILTER),
    } : null,
    search !== DEFAULT_PIPELINE_SEARCH ? {
      key: 'search',
      label: `Search: ${search}`,
      onRemove: () => setSearch(DEFAULT_PIPELINE_SEARCH),
    } : null,
    compactMode !== DEFAULT_PIPELINE_COMPACT_MODE ? {
      key: 'cards',
      label: 'Comfort cards',
      onRemove: () => setCompactMode(DEFAULT_PIPELINE_COMPACT_MODE),
    } : null,
  ].filter(Boolean);
  const activeFilterCount = activeFilterChips.filter((chip) => chip.onRemove).length;
  const filterSummaryChips = activeFilterChips.filter((chip) => chip.onRemove).slice(0, 3);
  const visibleActiveFilterChips = activeFilterChips.filter((chip) => chip.onRemove);
  const hasNonDefaultLeadDateFilter = hasExplicitLeadDateFilter;
  const hasNonDefaultFilters = hasNonDefaultLeadDateFilter ||
    (!coordinatorUiPolicy.ownerScoped && ownerFilter !== DEFAULT_PIPELINE_OWNER_FILTER) ||
    statusFilter !== DEFAULT_PIPELINE_STATUS_FILTER ||
    sourceFilter !== DEFAULT_PIPELINE_SOURCE_FILTER ||
    courseFilter !== DEFAULT_PIPELINE_COURSE_FILTER ||
    effectiveLocationFilter !== DEFAULT_PIPELINE_LOCATION_FILTER ||
    activityFilter !== DEFAULT_PIPELINE_ACTIVITY_FILTER ||
    search !== DEFAULT_PIPELINE_SEARCH ||
    compactMode !== DEFAULT_PIPELINE_COMPACT_MODE;
  const filterSections = [
    {
      id: 'timeframe',
      label: 'Timeframe',
      summary: coordinatorUiPolicy.ownerScoped && implicitLeadDate ? 'All owned cards' : selectedDateLabel,
    },
    {
      id: 'owner',
      label: 'Owner',
      summary: selectedOwnerLabel || (canUseConsolidatedScope ? 'Team Pipeline' : 'All Owners'),
    },
    {
      id: 'status',
      label: 'Status',
      summary: selectedStatusLabel || 'All Statuses',
    },
    {
      id: 'source',
      label: 'Source',
      summary: sourceFilter === DEFAULT_PIPELINE_SOURCE_FILTER ? 'All Sources' : sourceFilter,
    },
    (courseFilterOptions.length > 0 || courseFilter !== DEFAULT_PIPELINE_COURSE_FILTER) ? {
      id: 'course',
      label: 'Course',
      summary: selectedCourseLabel || 'All Courses',
    } : null,
    isAitUsaPipeline ? {
      id: 'location',
      label: 'Location',
      summary: selectedLocationLabel || 'All Locations',
    } : null,
    {
      id: 'activity',
      label: 'Activity',
      summary: optionLabel(PIPELINE_ACTIVITY_OPTIONS, activityFilter),
    },
  ].filter(Boolean);
  const pipelineScopeName = pipelineBusinessUnit?.name || currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`;
  const pipelineSummary = `${pipelineRows.length.toLocaleString()} matching pipeline cards in ${pipelineScopeName}`;
  const showPipelineScopeSelector = !currentScopedBusinessUnitId && accessibleBusinessUnits.length > 1;
  const resetFilters = () => {
    updatePipelineFilterQuery({
      ownerFilter: DEFAULT_PIPELINE_OWNER_FILTER,
      statusFilter: DEFAULT_PIPELINE_STATUS_FILTER,
      sourceFilter: DEFAULT_PIPELINE_SOURCE_FILTER,
      courseFilter: DEFAULT_PIPELINE_COURSE_FILTER,
      locationFilter: DEFAULT_PIPELINE_LOCATION_FILTER,
      activityFilter: DEFAULT_PIPELINE_ACTIVITY_FILTER,
      search: DEFAULT_PIPELINE_SEARCH,
      leadDateScope: CONTACT_LEAD_DATE_SCOPE_ALL,
      leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
      leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
      includeLeadDateScope: false,
      compactMode: DEFAULT_PIPELINE_COMPACT_MODE,
    });
  };

  const movePipelineCard = (id, status, column) => {
    if (column?.isOperational) {
      toast('Open the contact to update linked estimate, work order, fulfillment, or payment records.', 'error');
      return;
    }
    updateContact(id, { status })
      .then(() => {
        setMobileMoveCardId('');
        toast('Stage updated');
      })
      .catch((error) => toast(error?.message || 'Stage update failed.', 'error'));
  };
  const assignSelectedToMe = () => {
    if (!currentUser?.id || !selectedRows.length || !coordinatorUiPolicy.canManageCoordinatorAssignments) return;
    Promise.all(selectedRows.map((contact) => updateContact(contact.id, { assignedTo: currentUser.id })))
      .then(() => {
        setSelectedIds([]);
        setBulkAssignMode(false);
        toast(`Assigned ${selectedRows.length} pipeline cards to you`);
      })
      .catch((error) => toast(error?.message || 'Bulk assignment failed.', 'error'));
  };
  const toggleBulkAssignMode = () => {
    if (!coordinatorUiPolicy.canManageCoordinatorAssignments) return;
    if (bulkAssignMode) setSelectedIds([]);
    setBulkAssignMode(!bulkAssignMode);
  };

  if (!loaded) {
    return <PageState tone="loading" title="Loading pipeline" copy="Preparing lead stages and workflow filters for your current division." />;
  }

  return (
    <div className="fade-in">
      <div className={`page-header ${s.pipelineHeader}`}>
        <div className={s.headerCopy}>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">{pipelineSummary}</p>
        </div>
      </div>

      {showPipelineScopeSelector && (
        <div className={s.scopeBar}>
          <div className={s.scopeTitle}>
            <strong>Pipeline division</strong>
            <span>{activeWorkflow.label}</span>
          </div>
          <select
            className={`input select ${s.scopeSelect}`}
            value={resolvedPipelineBusinessUnitId}
            onChange={(event) => setPipelineBusinessUnitId(event.target.value)}
            aria-label="Pipeline division"
          >
            {accessibleBusinessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
        </div>
      )}

      <section className={s.filterSurface} aria-label="Pipeline filters">
        <div className={s.filterTopline}>
          <div className={s.pipelineFilterLead}>
            <label className={s.toolbarSearchBox}>
              <Search size={14} />
              <input
                className={`input ${s.toolbarSearchInput}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search pipeline..."
                aria-label="Search pipeline"
              />
            </label>
            <div className={s.filterPopoverAnchor}>
              <button
                className={`${s.filterMenuButton} ${filterMenuOpen ? s.active : ''}`}
                type="button"
                onClick={() => setFilterMenuOpen((open) => !open)}
                aria-expanded={filterMenuOpen}
              >
                <ListFilter size={15} />
                Filters
                {hasNonDefaultFilters && <strong>{activeFilterCount}</strong>}
              </button>

              {filterMenuOpen && (
                <div className={s.filterMenu} role="dialog" aria-label="Pipeline filters">
                  <div className={s.filterSummaryStrip} aria-label="Selected pipeline filters">
                    {filterSummaryChips.length > 0 ? (
                      <>
                        {filterSummaryChips.map((chip) => (
                          <span key={chip.key} className={s.filterSummaryItem}>
                            <small>{PIPELINE_FILTER_CHIP_LABELS[chip.key] || 'Filter'}</small>
                            <strong>{chip.label}</strong>
                          </span>
                        ))}
                        {activeFilterCount > filterSummaryChips.length && (
                          <span className={s.filterSummaryMore}>+{activeFilterCount - filterSummaryChips.length}</span>
                        )}
                      </>
                    ) : (
                      <span className={s.filterSummaryEmpty}>Default pipeline view</span>
                    )}
                  </div>

                  <div className={s.filterShell}>
                    <div className={s.filterSectionList} role="tablist" aria-label="Pipeline filter sections">
                      {filterSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          className={`${s.filterSectionButton} ${activeFilterSection === section.id ? s.active : ''}`}
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

                    <div className={`${s.filterDetail} ${['timeframe', 'owner', 'status', 'source', 'course', 'location', 'activity'].includes(activeFilterSection) ? s.filterDetailCompact : ''}`}>
                      {activeFilterSection === 'timeframe' && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Timeframe</div>
                          <TimeframeFilterPanel
                            activeScope={effectiveLeadDateScope}
                            counts={{
                              quarter: quarterPipelineCount,
                              current: currentPipelineCount,
                              all: allPipelineCount,
                              custom: customPipelineCount,
                            }}
                            leadDateFrom={leadDateFrom}
                            leadDateTo={leadDateTo}
                            onDateRangeChange={setLeadDateRange}
                            onScopeChange={setLeadDateScope}
                          />
                        </section>
                      )}

                      {activeFilterSection === 'owner' && (
                        <section className={`${s.filterBlock} ${s.ownerFilter}`}>
                          <div className={s.filterHeading}>Owner</div>
                          <div className={s.ownerScopeGrid} aria-label="Pipeline owner scope">
                            <button
                              type="button"
                              className={`${s.ownerTile} ${ownerFilter === DEFAULT_PIPELINE_OWNER_FILTER && !coordinatorUiPolicy.ownerScoped ? s.active : ''}`}
                              disabled={coordinatorUiPolicy.ownerScoped}
                              onClick={() => setOwnerFilter(DEFAULT_PIPELINE_OWNER_FILTER)}
                              aria-pressed={ownerFilter === DEFAULT_PIPELINE_OWNER_FILTER && !coordinatorUiPolicy.ownerScoped}
                            >
                              <span>{canUseConsolidatedScope ? 'Team Pipeline' : 'All Owners'}</span>
                              <small>Full owner view</small>
                            </button>
                            <button
                              type="button"
                              className={`${s.ownerTile} ${coordinatorUiPolicy.ownerScoped || ownerFilter === currentUser?.id ? s.active : ''}`}
                              disabled={!currentUser?.id || (coordinatorUiPolicy.ownerScoped && !coordinatorUiPolicy.lockedOwnerUserId)}
                              onClick={() => currentUser?.id && setOwnerFilter(currentUser.id)}
                              aria-pressed={coordinatorUiPolicy.ownerScoped || ownerFilter === currentUser?.id}
                            >
                              <span>My Pipeline</span>
                              <small>{coordinatorUiPolicy.ownerScoped ? 'Role default' : 'Assigned to me'}</small>
                            </button>
                            <button
                              type="button"
                              className={`${s.ownerTile} ${ownerFilter === 'unassigned' ? s.active : ''}`}
                              disabled={coordinatorUiPolicy.ownerScoped}
                              onClick={() => setOwnerFilter('unassigned')}
                              aria-pressed={ownerFilter === 'unassigned'}
                            >
                              <span>Unassigned</span>
                              <small>Needs owner</small>
                            </button>
                          </div>

                          {coordinatorUiPolicy.ownerScoped ? (
                            <p className={s.ownerNote}>Locked to your assigned pipeline.</p>
                          ) : (
                            <div className={s.ownerStaff}>
                              <label className={s.ownerSearch}>
                                <span>Specific staff</span>
                                <input
                                  className="input"
                                  type="search"
                                  value={ownerSearch}
                                  onChange={(event) => setOwnerSearch(event.target.value)}
                                  placeholder="Search staff..."
                                />
                              </label>
                              <div className={s.ownerList} role="listbox" aria-label="Staff pipeline owner filters">
                                {visibleOwnerOptions.length > 0 ? (
                                  visibleOwnerOptions.map((owner) => (
                                    <button
                                      key={owner.id}
                                      type="button"
                                      className={`${s.ownerRow} ${ownerFilter === owner.id ? s.active : ''}`}
                                      onClick={() => setOwnerFilter(owner.id)}
                                      aria-selected={ownerFilter === owner.id}
                                      role="option"
                                    >
                                      <span className={s.ownerAvatar} aria-hidden="true">{owner.initials}</span>
                                      <span className={s.ownerCopy}>
                                        <strong>{owner.label}</strong>
                                        <small>{owner.meta}</small>
                                      </span>
                                    </button>
                                  ))
                                ) : (
                                  <span className={s.ownerEmpty}>No matching staff</span>
                                )}
                              </div>
                            </div>
                          )}
                        </section>
                      )}

                      {activeFilterSection === 'status' && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Status</div>
                          <div className={s.optionList} role="listbox" aria-label="Pipeline status filters">
                            <button
                              type="button"
                              className={`${s.optionTile} ${statusFilter === DEFAULT_PIPELINE_STATUS_FILTER ? s.active : ''}`}
                              onClick={() => setStatusFilter(DEFAULT_PIPELINE_STATUS_FILTER)}
                              aria-selected={statusFilter === DEFAULT_PIPELINE_STATUS_FILTER}
                              role="option"
                            >
                              <span>All Statuses</span>
                              <small>All active stages</small>
                            </button>
                            {pipelineStatusOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`${s.optionTile} ${statusFilter === option.value ? s.active : ''}`}
                                onClick={() => setStatusFilter(option.value)}
                                aria-selected={statusFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                <small>Only this stage</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'source' && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Source</div>
                          <div className={s.optionList} role="listbox" aria-label="Pipeline source filters">
                            <button
                              type="button"
                              className={`${s.optionTile} ${sourceFilter === DEFAULT_PIPELINE_SOURCE_FILTER ? s.active : ''}`}
                              onClick={() => setSourceFilter(DEFAULT_PIPELINE_SOURCE_FILTER)}
                              aria-selected={sourceFilter === DEFAULT_PIPELINE_SOURCE_FILTER}
                              role="option"
                            >
                              <span>All Sources</span>
                              <strong>{pipelineScopedRows.length}</strong>
                            </button>
                            {sourceOptions.map((source) => (
                              <button
                                key={source}
                                type="button"
                                className={`${s.optionTile} ${sourceFilter === source ? s.active : ''}`}
                                onClick={() => setSourceFilter(source)}
                                aria-selected={sourceFilter === source}
                                role="option"
                              >
                                <span>{source}</span>
                                <strong>{pipelineScopedRows.filter((contact) => sourceValue(contact) === source).length}</strong>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'course' && (courseFilterOptions.length > 0 || courseFilter !== DEFAULT_PIPELINE_COURSE_FILTER) && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Course</div>
                          <div className={s.optionList} role="listbox" aria-label="Pipeline course filters">
                            <button
                              type="button"
                              className={`${s.optionTile} ${courseFilter === DEFAULT_PIPELINE_COURSE_FILTER ? s.active : ''}`}
                              onClick={() => setCourseFilter(DEFAULT_PIPELINE_COURSE_FILTER)}
                              aria-selected={courseFilter === DEFAULT_PIPELINE_COURSE_FILTER}
                              role="option"
                            >
                              <span>All Courses</span>
                              <strong>{pipelineScopedRows.length}</strong>
                            </button>
                            {courseFilterOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`${s.optionTile} ${courseFilter === option.value ? s.active : ''}`}
                                onClick={() => setCourseFilter(option.value)}
                                aria-selected={courseFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                <strong>{option.count}</strong>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'location' && isAitUsaPipeline && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Location</div>
                          <div className={s.optionList} role="listbox" aria-label="AIT USA pipeline location filters">
                            <button
                              type="button"
                              className={`${s.optionTile} ${effectiveLocationFilter === DEFAULT_PIPELINE_LOCATION_FILTER ? s.active : ''}`}
                              onClick={() => setLocationFilter(DEFAULT_PIPELINE_LOCATION_FILTER)}
                              aria-selected={effectiveLocationFilter === DEFAULT_PIPELINE_LOCATION_FILTER}
                              role="option"
                            >
                              <span>All Locations</span>
                              <strong>{pipelineScopedRows.length}</strong>
                            </button>
                            {locationFilterOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`${s.optionTile} ${effectiveLocationFilter === option.value ? s.active : ''}`}
                                onClick={() => setLocationFilter(option.value)}
                                aria-selected={effectiveLocationFilter === option.value}
                                role="option"
                              >
                                <span>{option.label}</span>
                                <strong>{option.count}</strong>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}

                      {activeFilterSection === 'activity' && (
                        <section className={s.filterBlock}>
                          <div className={s.filterHeading}>Activity</div>
                          <div className={s.optionList} role="listbox" aria-label="Pipeline activity filters">
                            {PIPELINE_ACTIVITY_OPTIONS.map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                className={`${s.optionTile} ${activityFilter === id ? s.active : ''}`}
                                onClick={() => setActivityFilter(id)}
                                aria-selected={activityFilter === id}
                                role="option"
                              >
                                <span>{label}</span>
                                <small>{id === DEFAULT_PIPELINE_ACTIVITY_FILTER ? 'No activity filter' : 'Activity-based view'}</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>

                  <div className={s.filterFooter}>
                    <div className={s.filterFooterMeta}>
                      <span>{pipelineRows.length.toLocaleString()} shown of {pipelineScopedRows.length.toLocaleString()}</span>
                      <div className={s.filterFooterActions}>
                        {hasNonDefaultFilters && (
                          <button className={s.filterReset} type="button" onClick={resetFilters}>
                            <RotateCcw size={13} />
                            Reset
                          </button>
                        )}
                        <label className={`${s.compactToggle} ${s.footerToggle}`}>
                          <input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} />
                          Compact cards
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {visibleActiveFilterChips.length > 0 && (
              <div className={s.filterPills} aria-label="Active pipeline filters">
                {visibleActiveFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={s.filterPill}
                    onClick={chip.onRemove}
                    aria-label={`Remove ${PIPELINE_FILTER_CHIP_LABELS[chip.key] || 'filter'}: ${chip.label}`}
                  >
                    <span>{PIPELINE_FILTER_CHIP_LABELS[chip.key] || 'Filter'}: {chip.label}</span>
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={s.pipelineActions}>
            <button className="btn" onClick={() => nextLead ? router.push(`/contacts/${nextLead.id}`) : toast('No lead matches the current filters.', 'error')}>
              <ArrowRight size={14} /> Work Next Lead
            </button>
            {canWrite && currentUser?.id && coordinatorUiPolicy.canManageCoordinatorAssignments && (
              <button className={`btn ${bulkAssignMode ? 'btn-primary' : ''}`} type="button" onClick={toggleBulkAssignMode}>
                <UserRoundCheck size={14} /> Bulk Assign
              </button>
            )}
            {canWrite && (
              <button className="btn btn-primary" onClick={() => router.push('/contacts')}>
                <UserPlus size={14} /> Add Contact
              </button>
            )}
          </div>
        </div>
      </section>

      {bulkAssignMode && coordinatorUiPolicy.canManageCoordinatorAssignments && (
        <div className={s.bulkBar}>
          <div>
            <ListFilter size={14} />
            <strong>{selectedRows.length}</strong>
            <span>{selectedRows.length === 1 ? 'card selected' : 'cards selected'} for assignment</span>
          </div>
          {canWrite && currentUser?.id && (
            <button className="btn btn-sm btn-primary" type="button" onClick={assignSelectedToMe} disabled={selectedRows.length === 0}>Assign to me</button>
          )}
          <button className="btn btn-sm" type="button" onClick={() => setSelectedIds([])} disabled={selectedRows.length === 0}>Clear</button>
          <button className="btn btn-sm" type="button" onClick={toggleBulkAssignMode}>Done</button>
        </div>
      )}

      <div className={s.desktopBoard}>
        {closedOutcomeColumns.length > 0 ? (
          <div className={s.boardWithClosers}>
            <KanbanBoard
              data={pipelineRows}
              columns={activePipelineColumns}
              onMove={canWrite ? movePipelineCard : undefined}
              onEdit={(item) => router.push(`/contacts/${item.id}`)}
              showMobileMoveControls={false}
              compact={compactMode}
              fitColumns
              selectedIds={selectedIds}
              onSelect={bulkAssignMode ? setSelectedIds : undefined}
            />
            <aside className={s.closedRail} aria-label="Closed pipeline outcomes">
              <div className={s.closedRailHeader}>
                <strong>Close lead</strong>
                <span>Drop active cards here</span>
              </div>
              <div
                className={s.closedDropList}
                style={{ '--closed-outcome-count': String(closedOutcomeColumns.length) }}
              >
                {closedOutcomeColumns.map((column) => (
                  <div
                    key={column.id}
                    className={`${s.closedDropZone} ${!canWrite ? s.disabled : ''}`}
                    onDragOver={canWrite ? (event) => event.preventDefault() : undefined}
                    onDrop={canWrite ? (event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData('id');
                      if (!id) return;
                      movePipelineCard(id, column.id, column);
                    } : undefined}
                  >
                    <div>
                      <strong>{column.label}</strong>
                      <span>Drop to mark closed</span>
                    </div>
                    <em>{closedOutcomeCounts.get(column.id) || 0}</em>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        ) : (
          <KanbanBoard
            data={pipelineRows}
            columns={activePipelineColumns}
            onMove={canWrite ? movePipelineCard : undefined}
            onEdit={(item) => router.push(`/contacts/${item.id}`)}
            showMobileMoveControls={false}
            compact={compactMode}
            selectedIds={selectedIds}
            onSelect={bulkAssignMode ? setSelectedIds : undefined}
          />
        )}
      </div>

      <div className={s.mobilePipeline} aria-label="Mobile pipeline list">
        <div className={s.mobileStageTabs}>
          <button
            className={`${s.mobileStageTab} ${mobileStageFilter === 'all' ? s.active : ''}`}
            type="button"
            onClick={() => setMobileStageFilter('all')}
          >
            <span>All</span>
            <strong>{pipelineRows.length}</strong>
          </button>
          {activePipelineColumns.map((column) => {
            const count = pipelineRows.filter((contact) => contact.status === column.id).length;
            return (
              <button
                key={column.id}
                className={`${s.mobileStageTab} ${mobileStageFilter === column.id ? s.active : ''}`}
                type="button"
                onClick={() => setMobileStageFilter(column.id)}
              >
                <span>{column.label}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>
        <div className={s.mobileCardList}>
          {mobileStageRows.map((contact) => {
            const isMoving = mobileMoveCardId === contact.id;
            return (
              <article key={contact.id} className={s.mobilePipelineCard}>
                {bulkAssignMode && (
                  <label className={s.mobileSelect} onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(contact.id)}
                      onChange={(event) => {
                        const next = new Set(selectedIds);
                        if (event.target.checked) next.add(contact.id);
                        else next.delete(contact.id);
                        setSelectedIds([...next]);
                      }}
                    />
                    Select
                  </label>
                )}
                <button className={s.mobileCardMain} type="button" onClick={() => router.push(`/contacts/${contact.id}`)}>
                  <span className={s.mobileCardStage}>{contact.needsFirstOutreach && contact.status ? contact.status : (contact.currentStage || contact.status)}</span>
                  <strong>{contact.name}</strong>
                  <small>{mobileCardMeta(contact)}</small>
                  <span className={s.mobileTriageGrid} aria-label={`Triage context for ${contact.name}`}>
                    {mobilePipelineTriageItems(contact).map((item) => (
                      <span key={item.label} className={`${s.mobileTriageItem} ${item.tone === 'stale' ? s.mobileTriageStale : ''}`}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </span>
                    ))}
                  </span>
                  {contact.nextAction && (
                    <span className={s.mobileCardAction}>
                      <span>Next</span>
                      <strong>{contact.nextAction}</strong>
                    </span>
                  )}
                </button>
                {canWrite && (
                  <div className={s.mobileCardTools}>
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setMobileMoveCardId(isMoving ? '' : contact.id)}
                      aria-expanded={isMoving}
                    >
                      <ArrowRight size={14} /> Change Stage
                    </button>
                    {isMoving && (
                      <select
                        className={`input select ${s.mobileMoveSelect}`}
                        value={contact.status}
                        onChange={(event) => {
                          const nextColumn = normalizedColumns.find((column) => column.id === event.target.value);
                          if (!nextColumn || nextColumn.id === contact.status) return;
                          movePipelineCard(contact.id, nextColumn.id, nextColumn);
                        }}
                        aria-label={`Move ${contact.name}`}
                      >
                        {normalizedColumns.map((column) => (
                          <option key={column.id} value={column.id}>{column.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {mobileStageRows.length === 0 && (
            <div className={s.mobileEmpty}>No pipeline cards match the current filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}
