'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Clock3, Search, UserPlus, UserRoundCheck } from 'lucide-react';
import KanbanBoard from '@/components/KanbanBoard';
import { useToast } from '@/components/Toast';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { useCRM } from '@/lib/store';
import { isWorkflowStatusClosed } from '@/lib/sales-workflow';
import s from './PipelinePage.module.css';

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
  const { toast } = useToast();
  const [pipelineBusinessUnitId, setPipelineBusinessUnitId] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState(() => (
    currentUser?.id && !currentUser.canAccessAllBusinessUnits ? currentUser.id : 'all'
  ));
  const [search, setSearch] = useState('');
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
  const pipelineScopedRows = useMemo(
    () => scopedRows.filter((contact) => contact.isPipelineEligible !== false),
    [scopedRows],
  );

  const pipelineStats = useMemo(() => ({
    needsFirstOutreach: pipelineScopedRows.filter((contact) => contact.needsFirstOutreach).length,
    unassigned: pipelineScopedRows.filter((contact) => !contact.assignedTo).length,
    active: pipelineScopedRows.filter((contact) => {
      const businessUnit = businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
      return !isWorkflowStatusClosed(contact.status, businessUnit);
    }).length,
  }), [businessUnitById, pipelineScopedRows]);

  const normalizedSearch = search.trim().toLowerCase();
  const pipelineRows = pipelineScopedRows.filter((contact) => {
    const businessUnit = businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
    const workflowMatch =
      workflowFilter === 'all' ||
      (workflowFilter === 'needs_first_outreach' && contact.needsFirstOutreach) ||
      (workflowFilter === 'active' && !isWorkflowStatusClosed(contact.status, businessUnit)) ||
      (workflowFilter === 'unassigned' && !contact.assignedTo);
    const ownerMatch =
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' && !contact.assignedTo) ||
      contact.assignedTo === ownerFilter;
    return workflowMatch && ownerMatch && matchesSearch(contact, normalizedSearch);
  });

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className={`page-header ${s.pipelineHeader}`}>
        <div className={s.headerCopy}>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">
            {activeWorkflow.label} · {pipelineBusinessUnit?.name || currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}
          </p>
        </div>
        <div className={s.pipelineActions}>
          {currentUser?.id && (
            <button className="btn" onClick={() => setOwnerFilter(currentUser.id)}>
              <UserRoundCheck size={14} /> My Pipeline
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

      <div className={s.scopeBar}>
        <div className={s.scopeTitle}>
          <strong>{activeWorkflow.label}</strong>
          <span>{pipelineBusinessUnit?.name || currentBusinessUnit?.name || 'Selected division'} · {pipelineRows.length} shown of {pipelineScopedRows.length}</span>
        </div>
        {!currentScopedBusinessUnitId && accessibleBusinessUnits.length > 1 && (
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
        )}
      </div>

      <div className={s.filterBar}>
        <select className="input select" value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}>
          <option value="all">All Pipeline Cards</option>
          <option value="needs_first_outreach">Needs First Outreach</option>
          <option value="active">Active Pipeline</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select className="input select" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
          <option value="all">{canUseConsolidatedScope ? 'Team Pipeline' : 'All Owners'}</option>
          {currentUser?.id && <option value={currentUser.id}>My Pipeline</option>}
          <option value="unassigned">Unassigned</option>
          {employees
            .filter((employee) => employee.id !== currentUser?.id)
            .map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
        <div className={s.searchBox}>
          <Search size={14} />
          <input
            className={`input ${s.searchInput}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pipeline..."
          />
        </div>
      </div>

      <KanbanBoard
        data={pipelineRows}
        columns={pipelineColumns}
        onMove={canWrite ? (id, status, column) => {
          if (column?.isOperational) {
            toast('Open the contact to update linked estimate, work order, fulfillment, or payment records.', 'error');
            return;
          }
          updateContact(id, { status })
            .then(() => toast('Stage updated'))
            .catch((error) => toast(error?.message || 'Stage update failed.', 'error'));
        } : undefined}
        onEdit={(item) => router.push(`/contacts/${item.id}`)}
      />
    </div>
  );
}
