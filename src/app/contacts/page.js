'use client';
import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { validateManualContactIdentity } from '@/lib/crm/contact-input';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import {
  buildContactDirectoryFacetGroups,
  contactDirectorySignalLabels,
  filterContactsByDirectoryFacet,
} from '@/lib/contact-directory-facets';
import {
  clientDirectoryColumnMode,
  directorySourceText,
  enrollmentSourceText,
  enrollmentStageText,
  isCurrentLeadDateScope,
  lifecycleBucket,
} from '@/lib/contact-directory-view';
import { workflowForBusinessUnit } from '@/lib/sales-workflow';
import { schoolLocationOptions } from '@/lib/school-locations';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { AlertCircle, RotateCcw, UserRoundCheck } from 'lucide-react';

const empty = {
  name: '',
  email: '',
  phone: '',
  address: '',
  status: 'New Lead',
  currentStage: 'Needs First Outreach',
  source: 'Wix Historical Import',
  assignedTo: '',
  tags: [],
  nextAction: '',
  notes: [],
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
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        {row.needsFirstOutreach ? <AlertCircle size={13} /> : <UserRoundCheck size={13} />}
        <span>{row.currentStage || row.status}</span>
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
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        <UserRoundCheck size={13} />
        <span>{enrollmentStageText(row)}</span>
      </div>
      {row.nextAction && <div className="workflow-next">{row.nextAction}</div>}
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
  const [statusFilter, setStatusFilter] = useState('All');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [directoryFacet, setDirectoryFacet] = useState(() => searchParams.get('facet') || searchParams.get('directoryFacet') || 'all');
  const [leadDateScope, setLeadDateScope] = useState(() => {
    const param = searchParams.get('leadDateScope');
    return param === 'all' ? 'all' : 'current';
  });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formError, setFormError] = useState('');
  const [facetNow] = useState(() => Date.now());
  const isClientsMode = mode === 'clients';
  const singularLabel = isClientsMode ? 'Client' : 'Contact';
  const pluralLabel = isClientsMode ? 'Clients' : 'Contacts';
  const routeBase = isClientsMode ? '/clients' : '/contacts';
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
    deleteContact(deleteTarget.id)
      .then(() => {
        toast(`${singularLabel} deleted`);
        setDeleteTarget(null);
        close();
      })
      .catch((error) => toast(error?.message || 'Delete failed.', 'error'));
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
    if (drawer === 'new') {
      addContact(form)
        .then(() => {
          toast(`${singularLabel} created successfully`);
          close();
        })
        .catch((error) => toast(error?.message || `${singularLabel} create failed.`, 'error'));
    } else {
      updateContact(drawer.id, form)
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
    if (leadDateScope === 'all') return directoryRows;
    return directoryRows.filter((contact) => isCurrentLeadDateScope(contact));
  }, [directoryRows, leadDateScope]);
  const allDateLeadCount = directoryRows.length;
  const currentLeadCount = useMemo(
    () => directoryRows.filter((contact) => isCurrentLeadDateScope(contact)).length,
    [directoryRows],
  );
  const baseFilteredContacts = useMemo(() => dateScopedRows.filter((contact) => {
    const statusMatch = statusFilter === 'All' || contact.status === statusFilter;
    const ownerMatch =
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' && !contact.assignedTo) ||
      contact.assignedTo === ownerFilter;
    return statusMatch && ownerMatch;
  }), [dateScopedRows, ownerFilter, statusFilter]);
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
    if (ownerFilter === 'all') return '';
    if (ownerFilter === 'unassigned') return 'Unassigned';
    return ownerOptions.find((owner) => owner.id === ownerFilter)?.label || 'Selected owner';
  }, [ownerFilter, ownerOptions]);
  const activeFilterChips = useMemo(() => [
    leadDateScope === 'all' ? { key: 'leadDateScope', label: 'All date leads' } : null,
    statusFilter !== 'All' ? { key: 'status', label: statusFilter } : null,
    selectedOwnerLabel ? { key: 'owner', label: selectedOwnerLabel } : null,
    selectedFacetLabel ? { key: 'facet', label: selectedFacetLabel } : null,
  ].filter(Boolean), [leadDateScope, selectedFacetLabel, selectedOwnerLabel, statusFilter]);
  const hasActiveFilters = activeFilterChips.length > 0;
  const filterSummaryText = hasActiveFilters
    ? activeFilterChips.map((chip) => chip.label).join(' / ')
    : 'Default contact view';
  const resetFilters = () => {
    setLeadDateScope('current');
    setStatusFilter('All');
    setOwnerFilter('all');
    setDirectoryFacet('all');
  };
  const invalidPhoneScopeSummary = useMemo(() => {
    if (effectiveDirectoryFacet !== 'invalid_phone') return '';
    const counts = new Map();
    for (const contact of filteredContacts) {
      const label = contact.divisionLabel || businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId)?.name || 'Unassigned';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${label}: ${count}`)
      .join(' · ');
  }, [businessUnitById, effectiveDirectoryFacet, filteredContacts]);
  const mobileFieldKeys = columnMode === 'ait_signs'
    ? ['phone', 'sourceCategoryText', 'linkedPeopleSummary', 'accountSnapshotText', 'assignedLabel', 'lastTouch', 'lastEdited']
    : columnMode === 'ait_usa'
      ? ['phone', 'enrollmentStage', 'inquirySource', 'assignedLabel', 'lastTouch', 'lastEdited']
      : ['phone', 'workflow', 'signalText', 'assignedLabel', 'divisionLabel', 'lastTouch', 'lastEdited'];
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
          <p className="page-subtitle">{directoryContacts.length} {pluralLabel.toLowerCase()} in {directoryBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <div className="flex-gap contacts-header-actions">
          <select className="input select contacts-filter" style={{width:130, padding:'4px 8px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            {statusOptions.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input select contacts-filter" style={{width:150, padding:'4px 8px'}} value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}>
            <option value="all">All Owners</option>
            <option value="unassigned">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.label}</option>
            ))}
          </select>
          {canWrite && <button className="btn btn-primary" onClick={openNew}>+ Add {singularLabel}</button>}
        </div>
      </div>

      <div className="contacts-facet-panel" aria-label="Contact quick filters">
        <div className="contacts-facet-summary">
          <strong>{filteredContacts.length}</strong>
          <span>matching {pluralLabel.toLowerCase()}</span>
          <small>{filterSummaryText}</small>
          {invalidPhoneScopeSummary && (
            <small>{invalidPhoneScopeSummary}</small>
          )}
          {hasActiveFilters && (
            <button className="contacts-filter-reset" type="button" onClick={resetFilters}>
              <RotateCcw size={13} />
              Reset filters
            </button>
          )}
        </div>
        <div className="contacts-facet-groups">
          <div className="contacts-facet-group">
            <div className="contacts-facet-label">Lead dates</div>
            <div className="contacts-facet-pills">
              {[
                ['current', 'Current Leads', currentLeadCount],
                ['all', 'All Date Leads', allDateLeadCount],
              ].map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  className={`contacts-facet-pill ${leadDateScope === id ? 'active' : ''}`}
                  onClick={() => setLeadDateScope(id)}
                  aria-pressed={leadDateScope === id}
                >
                  <span>{label}</span>
                  <strong>{count}</strong>
                </button>
              ))}
            </div>
          </div>
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
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filteredContacts}
          searchPlaceholder={`Search ${pluralLabel.toLowerCase()}...`}
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
            <button className="btn btn-danger" type="button" onClick={requestDelete}>Delete</button>
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
        <div className="form-group">
          <label className="form-label">Assigned To</label>
          <select className="input select" value={form.assignedTo || ''} onChange={e => setForm(f => ({...f, assignedTo: e.target.value}))}>
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.label}</option>
            ))}
          </select>
        </div>
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
        title={`Delete ${singularLabel}`}
        message={`Delete ${deleteTarget?.name || `this ${singularLabel.toLowerCase()}`}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
