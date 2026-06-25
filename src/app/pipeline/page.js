'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Clock3, ListFilter, RotateCcw, Search, UserPlus, UserRoundCheck, X } from 'lucide-react';
import KanbanBoard from '@/components/KanbanBoard';
import { useToast } from '@/components/Toast';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { useCRM } from '@/lib/store';
import {
  isPipelineNewLeadBucket,
  matchesPipelineQuickFilter,
} from '@/lib/contact-workflow-buckets';
import {
  contactMatchesLeadDateScope,
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_CUSTOM,
  DEFAULT_CONTACT_LEAD_DATE_FROM,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  DEFAULT_CONTACT_LEAD_DATE_TO,
  DEFAULT_PIPELINE_ACTIVITY_FILTER,
  DEFAULT_PIPELINE_COMPACT_MODE,
  DEFAULT_PIPELINE_OWNER_FILTER,
  DEFAULT_PIPELINE_SEARCH,
  DEFAULT_PIPELINE_SOURCE_FILTER,
  DEFAULT_PIPELINE_WORKFLOW_FILTER,
  pipelineFilterQuery,
  pipelineFilterStateFromParams,
} from '@/lib/contact-directory-filters';
import s from './PipelinePage.module.css';

const PIPELINE_BUCKET_OPTIONS = [
  ['all', 'All Active Cards'],
  ['new_leads', 'New Leads'],
  ['needs_first_outreach', 'Needs First Outreach'],
  ['active', 'Active Pipeline'],
];

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

function matchesSearch(contact, query) {
  if (!query) return true;
  const haystack = [
    contact.name,
    contact.email,
    contact.phone,
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
    contact.enrollmentSignals?.inquiry?.location,
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
  if (contact.needsFirstOutreach) score += 100;
  if (!contact.assignedTo) score += 40;
  if (!contact.phone && !contact.email) score += 20;
  if (isPipelineNewLeadBucket(contact)) score += 15;
  score += Math.min(daysSince(contactTouchDate(contact)), 30);
  return score;
}

function optionLabel(options = [], value = '') {
  return options.find(([id]) => id === value)?.[1] || value;
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
  const [filterMenuTab, setFilterMenuTab] = useState('date');
  const [mobileStageFilter, setMobileStageFilter] = useState('all');
  const [mobileMoveCardId, setMobileMoveCardId] = useState('');
  const [bulkAssignMode, setBulkAssignMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const parsedFilters = useMemo(() => pipelineFilterStateFromParams(new URLSearchParams(pipelineSearchQuery)), [pipelineSearchQuery]);
  const ownerFilter = parsedFilters.ownerFilter === DEFAULT_PIPELINE_OWNER_FILTER &&
    currentUser?.id &&
    !currentUser.canAccessAllBusinessUnits
    ? 'unassigned'
    : parsedFilters.ownerFilter;
  const {
    workflowFilter,
    sourceFilter,
    activityFilter,
    search,
    leadDateScope,
    leadDateFrom,
    leadDateTo,
    compactMode,
  } = parsedFilters;
  const updatePipelineFilterQuery = (patch) => {
    const nextQuery = pipelineFilterQuery({
      ...parsedFilters,
      ownerFilter,
      ...patch,
    });
    router.replace(nextQuery ? `/pipeline?${nextQuery}` : '/pipeline', { scroll: false });
  };
  const setWorkflowFilter = (value) => updatePipelineFilterQuery({ workflowFilter: value });
  const setOwnerFilter = (value) => updatePipelineFilterQuery({ ownerFilter: value });
  const setSourceFilter = (value) => updatePipelineFilterQuery({ sourceFilter: value });
  const setActivityFilter = (value) => updatePipelineFilterQuery({ activityFilter: value });
  const setSearch = (value) => updatePipelineFilterQuery({ search: value });
  const setCompactMode = (value) => updatePipelineFilterQuery({ compactMode: value });
  const setLeadDateScope = (value) => updatePipelineFilterQuery({ leadDateScope: value });
  const setLeadDateFrom = (value) => updatePipelineFilterQuery({ leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM, leadDateFrom: value });
  const setLeadDateTo = (value) => updatePipelineFilterQuery({ leadDateScope: CONTACT_LEAD_DATE_SCOPE_CUSTOM, leadDateTo: value });
  const canWrite = access.canWriteCrm;
  const {
    activeWorkflow,
    businessUnitById,
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
  const scopedRows = useMemo(() => contactRows.filter((contact) => {
    if (!selectedBusinessUnitId) return true;
    return (contact.businessUnitId || contact.primaryBusinessUnitId) === selectedBusinessUnitId;
  }), [contactRows, selectedBusinessUnitId]);
  const eligibleScopedRows = useMemo(
    () => scopedRows.filter((contact) => contact.isPipelineEligible !== false),
    [scopedRows],
  );
  const pipelineScopedRows = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact, {
      leadDateScope,
      leadDateFrom,
      leadDateTo,
    })),
    [eligibleScopedRows, leadDateFrom, leadDateScope, leadDateTo],
  );
  const allPipelineCount = eligibleScopedRows.length;
  const currentPipelineCount = useMemo(
    () => eligibleScopedRows.filter((contact) => contactMatchesLeadDateScope(contact)).length,
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

  const pipelineStats = useMemo(() => ({
    needsFirstOutreach: pipelineScopedRows.filter((contact) => matchesPipelineQuickFilter(contact, 'needs_first_outreach')).length,
    unassigned: pipelineScopedRows.filter((contact) => matchesPipelineQuickFilter(contact, 'unassigned')).length,
    active: pipelineScopedRows.filter((contact) => matchesPipelineQuickFilter(contact, 'active', { businessUnitById })).length,
  }), [businessUnitById, pipelineScopedRows]);
  const sourceOptions = useMemo(() => {
    const values = [...new Set(pipelineScopedRows.map(sourceValue).filter(Boolean))];
    return values.sort((left, right) => left.localeCompare(right));
  }, [pipelineScopedRows]);
  const ownerOptions = useMemo(() => {
    return (employees || [])
      .filter((employee) => employee?.id && employee.id !== currentUser?.id)
      .map((employee) => ({
        id: employee.id,
        label: employee.name || employee.email || 'Unnamed User',
      }));
  }, [currentUser?.id, employees]);

  const normalizedSearch = search.trim().toLowerCase();
  const pipelineRows = useMemo(() => pipelineScopedRows.filter((contact) => {
    const workflowMatch = matchesPipelineQuickFilter(contact, workflowFilter, { businessUnitById });
    const ownerMatch =
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' && !contact.assignedTo) ||
      contact.assignedTo === ownerFilter;
    const sourceMatch = sourceFilter === 'all' || sourceValue(contact) === sourceFilter;
    const touchAge = daysSince(contactTouchDate(contact));
    const activityMatch =
      activityFilter === 'all' ||
      (activityFilter === 'no_touch' && !contactTouchDate(contact)) ||
      (activityFilter === 'stale_30' && touchAge > 30) ||
      (activityFilter === 'recent_7' && touchAge <= 7);
    return workflowMatch && ownerMatch && sourceMatch && activityMatch && matchesSearch(contact, normalizedSearch);
  }), [activityFilter, businessUnitById, normalizedSearch, ownerFilter, pipelineScopedRows, sourceFilter, workflowFilter]);
  const normalizedColumns = useMemo(() => normalizedPipelineColumns(pipelineColumns), [pipelineColumns]);
  const activePipelineColumns = useMemo(
    () => normalizedColumns.filter((column) => !column.isTerminal),
    [normalizedColumns],
  );
  const closedOutcomeColumns = useMemo(
    () => normalizedColumns.filter((column) => column.isTerminal && !column.isOperational).sort(closedOutcomeSort),
    [normalizedColumns],
  );
  const closedOutcomeCounts = useMemo(() => {
    const counts = new Map(closedOutcomeColumns.map((column) => [column.id, 0]));
    for (const contact of scopedRows) {
      if (!counts.has(contact.status)) continue;
      if (!contactMatchesLeadDateScope(contact, { leadDateScope, leadDateFrom, leadDateTo })) continue;
      counts.set(contact.status, (counts.get(contact.status) || 0) + 1);
    }
    return counts;
  }, [closedOutcomeColumns, leadDateFrom, leadDateScope, leadDateTo, scopedRows]);
  const mobileStageRows = mobileStageFilter === 'all'
    ? pipelineRows
    : pipelineRows.filter((contact) => contact.status === mobileStageFilter);
  const nextLead = useMemo(() => (
    [...pipelineRows]
      .filter((contact) => (
        isPipelineNewLeadBucket(contact) ||
        matchesPipelineQuickFilter(contact, 'needs_first_outreach') ||
        matchesPipelineQuickFilter(contact, 'unassigned')
      ))
      .sort((left, right) => nextLeadScore(right) - nextLeadScore(left))[0] || null
  ), [pipelineRows]);
  const selectedRows = useMemo(() => pipelineRows.filter((contact) => selectedIds.includes(contact.id)), [pipelineRows, selectedIds]);
  const selectedOwnerLabel = useMemo(() => {
    if (ownerFilter === DEFAULT_PIPELINE_OWNER_FILTER) return '';
    if (ownerFilter === 'unassigned') return 'Unassigned';
    if (ownerFilter === currentUser?.id) return 'Me';
    return ownerOptions.find((owner) => owner.id === ownerFilter)?.label || 'Selected owner';
  }, [currentUser?.id, ownerFilter, ownerOptions]);
  const selectedDateLabel = dateScopeLabel(leadDateScope, leadDateFrom, leadDateTo);
  const dateFilterIsDefault = leadDateScope === DEFAULT_CONTACT_LEAD_DATE_SCOPE &&
    leadDateFrom === DEFAULT_CONTACT_LEAD_DATE_FROM &&
    leadDateTo === DEFAULT_CONTACT_LEAD_DATE_TO;
  const activeFilterChips = [
    {
      key: 'date',
      label: selectedDateLabel,
      primary: true,
      onRemove: dateFilterIsDefault
        ? null
        : () => updatePipelineFilterQuery({
          leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
          leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
          leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
        }),
    },
    workflowFilter !== DEFAULT_PIPELINE_WORKFLOW_FILTER ? {
      key: 'bucket',
      label: optionLabel(PIPELINE_BUCKET_OPTIONS, workflowFilter),
      onRemove: () => setWorkflowFilter(DEFAULT_PIPELINE_WORKFLOW_FILTER),
    } : null,
    selectedOwnerLabel ? {
      key: 'owner',
      label: selectedOwnerLabel,
      onRemove: () => setOwnerFilter(DEFAULT_PIPELINE_OWNER_FILTER),
    } : null,
    sourceFilter !== DEFAULT_PIPELINE_SOURCE_FILTER ? {
      key: 'source',
      label: sourceFilter,
      onRemove: () => setSourceFilter(DEFAULT_PIPELINE_SOURCE_FILTER),
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
  const hasNonDefaultFilters = leadDateScope !== DEFAULT_CONTACT_LEAD_DATE_SCOPE ||
    leadDateFrom !== DEFAULT_CONTACT_LEAD_DATE_FROM ||
    leadDateTo !== DEFAULT_CONTACT_LEAD_DATE_TO ||
    workflowFilter !== DEFAULT_PIPELINE_WORKFLOW_FILTER ||
    ownerFilter !== DEFAULT_PIPELINE_OWNER_FILTER ||
    sourceFilter !== DEFAULT_PIPELINE_SOURCE_FILTER ||
    activityFilter !== DEFAULT_PIPELINE_ACTIVITY_FILTER ||
    search !== DEFAULT_PIPELINE_SEARCH ||
    compactMode !== DEFAULT_PIPELINE_COMPACT_MODE;
  const pipelineScopeName = pipelineBusinessUnit?.name || currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`;
  const pipelineSummary = `${pipelineRows.length.toLocaleString()} matching pipeline cards in ${pipelineScopeName}`;
  const showPipelineScopeSelector = !currentScopedBusinessUnitId && accessibleBusinessUnits.length > 1;
  const resetFilters = () => {
    updatePipelineFilterQuery({
      workflowFilter: DEFAULT_PIPELINE_WORKFLOW_FILTER,
      ownerFilter: DEFAULT_PIPELINE_OWNER_FILTER,
      sourceFilter: DEFAULT_PIPELINE_SOURCE_FILTER,
      activityFilter: DEFAULT_PIPELINE_ACTIVITY_FILTER,
      search: DEFAULT_PIPELINE_SEARCH,
      leadDateScope: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
      leadDateFrom: DEFAULT_CONTACT_LEAD_DATE_FROM,
      leadDateTo: DEFAULT_CONTACT_LEAD_DATE_TO,
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
    if (!currentUser?.id || !selectedRows.length) return;
    Promise.all(selectedRows.map((contact) => updateContact(contact.id, { assignedTo: currentUser.id })))
      .then(() => {
        setSelectedIds([]);
        setBulkAssignMode(false);
        toast(`Assigned ${selectedRows.length} pipeline cards to you`);
      })
      .catch((error) => toast(error?.message || 'Bulk assignment failed.', 'error'));
  };
  const toggleBulkAssignMode = () => {
    if (bulkAssignMode) setSelectedIds([]);
    setBulkAssignMode(!bulkAssignMode);
  };

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className={`page-header ${s.pipelineHeader}`}>
        <div className={s.headerCopy}>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">{pipelineSummary}</p>
        </div>
        <div className={s.pipelineActions}>
          <button className="btn" onClick={() => nextLead ? router.push(`/contacts/${nextLead.id}`) : toast('No lead matches the current filters.', 'error')}>
            <ArrowRight size={14} /> Work Next Lead
          </button>
          <button className="btn" onClick={() => setOwnerFilter('unassigned')}>
            <AlertCircle size={14} /> Unassigned
          </button>
          {canWrite && currentUser?.id && (
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

      <div className={s.statsGrid}>
        <div className={s.statCard}>
          <AlertCircle size={18} />
          <div><strong>{pipelineStats.needsFirstOutreach}</strong><span>need first outreach</span></div>
        </div>
        <div className={s.statCard}>
          <Clock3 size={18} />
          <div><strong>{pipelineStats.active}</strong><span>active pipeline</span></div>
        </div>
        <div className={s.statCard}>
          <UserRoundCheck size={18} />
          <div><strong>{pipelineStats.unassigned}</strong><span>unassigned contacts</span></div>
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
          <div className={s.filterSummary}>
            <div className={s.activeChips} aria-label="Active pipeline filter summary">
              {activeFilterChips.map((chip) => {
                const chipClass = `${s.activeChip} ${chip.primary ? s.primary : ''} ${chip.onRemove ? s.removable : ''}`;
                return chip.onRemove ? (
                  <button key={chip.key} type="button" className={chipClass} onClick={chip.onRemove} title={`Remove ${chip.label}`}>
                    <span>{chip.label}</span>
                    <X size={12} />
                  </button>
                ) : (
                  <span key={chip.key} className={chipClass}>{chip.label}</span>
                );
              })}
            </div>
          </div>
          <div className={s.filterToolbar}>
            <div className={s.filterPopoverAnchor}>
              <button
                className={`${s.filterMenuButton} ${filterMenuOpen ? s.active : ''}`}
                type="button"
                onClick={() => setFilterMenuOpen((open) => !open)}
                aria-expanded={filterMenuOpen}
              >
                <ListFilter size={15} />
                Filters
                {hasNonDefaultFilters && <strong>{activeFilterChips.filter((chip) => chip.onRemove).length}</strong>}
              </button>

              {filterMenuOpen && (
                <div className={s.filterMenu} role="dialog" aria-label="Pipeline filters">
                  <div className={s.filterTabs} role="tablist" aria-label="Pipeline filter sections">
                    {[
                      ['date', 'Date'],
                      ['filters', 'Details'],
                      ['buckets', 'Active Board'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`${s.filterTab} ${filterMenuTab === id ? s.active : ''}`}
                        onClick={() => setFilterMenuTab(id)}
                        role="tab"
                        aria-selected={filterMenuTab === id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className={s.filterBody}>
                    {filterMenuTab === 'date' && (
                      <div className={s.filterSection}>
                        <div className={s.filterPills}>
                          {[
                            [DEFAULT_CONTACT_LEAD_DATE_SCOPE, 'Current Year', currentPipelineCount],
                            [CONTACT_LEAD_DATE_SCOPE_ALL, 'All Leads', allPipelineCount],
                            [CONTACT_LEAD_DATE_SCOPE_CUSTOM, 'Custom Time Frame', customPipelineCount],
                          ].map(([id, label, count]) => (
                            <button
                              key={id}
                              type="button"
                              className={`${s.filterPill} ${leadDateScope === id ? s.active : ''}`}
                              onClick={() => setLeadDateScope(id)}
                              aria-pressed={leadDateScope === id}
                            >
                              <span>{label}</span>
                              <strong>{count}</strong>
                            </button>
                          ))}
                        </div>
                        <div className={s.dateRange}>
                          <label>
                            <span>From</span>
                            <input className="input" type="date" value={leadDateFrom} onChange={(event) => setLeadDateFrom(event.target.value)} />
                          </label>
                          <label>
                            <span>To</span>
                            <input className="input" type="date" value={leadDateTo} onChange={(event) => setLeadDateTo(event.target.value)} />
                          </label>
                        </div>
                      </div>
                    )}

                    {filterMenuTab === 'filters' && (
                      <div className={s.filterGrid}>
                        <label className={s.filterField}>
                          <span>Owner</span>
                          <select className="input select" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                            <option value="all">{canUseConsolidatedScope ? 'Team Pipeline' : 'All Owners'}</option>
                            <option value="unassigned">Unassigned</option>
                            {currentUser?.id && <option value={currentUser.id}>Me</option>}
                            {ownerOptions.map((owner) => (
                              <option key={owner.id} value={owner.id}>{owner.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className={s.filterField}>
                          <span>Source</span>
                          <select className="input select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                            <option value="all">All Sources</option>
                            {sourceOptions.map((source) => (
                              <option key={source} value={source}>{source}</option>
                            ))}
                          </select>
                        </label>
                        <label className={s.filterField}>
                          <span>Activity</span>
                          <select className="input select" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                            {PIPELINE_ACTIVITY_OPTIONS.map(([id, label]) => (
                              <option key={id} value={id}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className={`${s.filterField} ${s.searchField}`}>
                          <span>Search</span>
                          <div className={s.searchBox}>
                            <Search size={14} />
                            <input
                              className={`input ${s.searchInput}`}
                              value={search}
                              onChange={(event) => setSearch(event.target.value)}
                              placeholder="Search pipeline..."
                            />
                          </div>
                        </label>
                        <label className={`${s.compactToggle} ${s.filterDensity}`}>
                          <input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} />
                          Compact cards
                        </label>
                      </div>
                    )}

                    {filterMenuTab === 'buckets' && (
                      <div className={s.filterPills}>
                        {PIPELINE_BUCKET_OPTIONS.map(([id, label]) => {
                          const count = pipelineScopedRows.filter((contact) => matchesPipelineQuickFilter(contact, id, { businessUnitById })).length;
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`${s.filterPill} ${workflowFilter === id ? s.active : ''}`}
                              onClick={() => setWorkflowFilter(id)}
                              aria-pressed={workflowFilter === id}
                            >
                              <span>{label}</span>
                              <strong>{count}</strong>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className={s.filterFooter}>
                    <span>{pipelineRows.length} shown of {pipelineScopedRows.length}</span>
                    {hasNonDefaultFilters && (
                      <button className={s.filterReset} type="button" onClick={resetFilters}>
                        <RotateCcw size={13} />
                        Reset all
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {bulkAssignMode && (
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
                      <span>Drop to remove from active pipeline</span>
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
                  <span className={s.mobileCardStage}>{contact.currentStage || contact.status}</span>
                  <strong>{contact.name}</strong>
                  <small>{mobileCardMeta(contact)}</small>
                  {contact.nextAction && <span className={s.mobileCardAction}>{contact.nextAction}</span>}
                </button>
                {canWrite && (
                  <div className={s.mobileCardTools}>
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setMobileMoveCardId(isMoving ? '' : contact.id)}
                      aria-expanded={isMoving}
                    >
                      <ArrowRight size={14} /> Move
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
            <div className={s.mobileEmpty}>No pipeline cards match this view.</div>
          )}
        </div>
      </div>
    </div>
  );
}
